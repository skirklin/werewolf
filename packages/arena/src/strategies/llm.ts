import Anthropic from "@anthropic-ai/sdk";
import { ROLES, type ClientMessage, type PlayerId, type PlayerView } from "@werewolf/shared";
import { nameOf, nightMessage, otherLiving, picksNeeded, type Strategy } from "../strategy.js";
import { RandomStrategy } from "./random.js";
import { BASELINE, adviceFor, type Playbook } from "../playbooks.js";

/**
 * The user picked Haiku 4.5 as the default: the point of the arena is sample
 * size, and a seven-player game is easily fifty calls. Override per strategy to
 * pit one tier against another.
 */
export const DEFAULT_MODEL = "claude-haiku-4-5";

/** Published $/MTok, for the run's cost estimate. Unknown models just report tokens. */
const PRICES: Record<string, { input: number; output: number }> = {
  "claude-haiku-4-5": { input: 1, output: 5 },
  "claude-sonnet-5": { input: 3, output: 15 },
  "claude-opus-5": { input: 5, output: 25 },
};

/** Running totals for a whole run, summed across every seat and game. */
export interface Spend {
  calls: number;
  inputTokens: number;
  outputTokens: number;
  failures: number;
  /** Replies that read as notes rather than speech. */
  leaks: number;
  /** Null when any model in the run has no published price here. */
  dollars: number | null;
}

export function totalSpend(strategies: readonly LlmStrategy[]): Spend {
  const spend: Spend = { calls: 0, inputTokens: 0, outputTokens: 0, failures: 0, leaks: 0, dollars: 0 };
  for (const s of strategies) {
    spend.calls += s.calls;
    spend.inputTokens += s.inputTokens;
    spend.outputTokens += s.outputTokens;
    spend.failures += s.failures;
    spend.leaks += s.leaks;
    const price = PRICES[s.modelId];
    if (!price || spend.dollars === null) spend.dollars = null;
    else
      spend.dollars +=
        (s.inputTokens / 1e6) * price.input + (s.outputTokens / 1e6) * price.output;
  }
  return spend;
}

export interface LlmOptions {
  model?: string;
  /** Label used in the results table. Defaults to `llm:<model>`. */
  name?: string;
  client?: Anthropic;
  /**
   * Which prompt variant this seat plays. Either a fixed playbook, or a choice
   * made from the seat's OWN role once it is dealt — which is how a tournament
   * assigns playbooks by team without anyone learning anyone else's role.
   */
  playbook?: Playbook | PlaybookChoice;
}

/** Picks a playbook from the seat's own role. Never sees another seat's. */
export type PlaybookChoice = (team: string, roleId: string | null) => Playbook;

/** How many messages of backchat to hand the model. Keeps input tokens bounded. */
const CHAT_WINDOW = 30;
const LOG_WINDOW = 20;

/**
 * The rules everyone gets. Deliberately free of strategy advice — that lives in
 * the playbook, so variants differ only in the part being tested.
 */
const RULES = `You are playing Werewolf (also called Mafia), a social deduction game.

How it works:
- Each night the werewolves secretly agree on one player to kill. Special roles
  (Seer, Doctor and others) also act at night.
- Each day everyone talks, then the town votes. The player with the most votes
  is eliminated. A tie eliminates nobody.
- The village wins when every werewolf is gone. The werewolves win the moment
  they equal the number of surviving players.
- Dead players cannot speak or vote.
- You only know what you have personally seen. Anyone may lie about anything,
  including their own role.`;

/**
 * An LLM plays one seat. Every prompt is built from this seat's redacted view
 * and nothing else — the model literally cannot be told another player's role,
 * because the process running it was never sent one.
 *
 * Any API trouble falls back to a random legal move so a run of games can't be
 * killed by one hiccup.
 */
export class LlmStrategy implements Strategy {
  /** The model this seat is running, exposed so a run can price itself. */
  readonly modelId: string;
  private readonly client: Anthropic;
  private readonly choose_playbook: Playbook | PlaybookChoice;
  private resolved: Playbook | null = null;
  private readonly label: string | undefined;
  private readonly pinnedModel: boolean;
  private readonly fallback = new RandomStrategy();
  /** Rough running totals, reported at the end of a run. */
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;
  failures = 0;
  /** Replies that read as notes rather than speech, and had to be redone or dropped. */
  leaks = 0;

  constructor(opts: LlmOptions = {}) {
    this.modelId = opts.model ?? DEFAULT_MODEL;
    this.choose_playbook = opts.playbook ?? BASELINE;
    this.client = opts.client ?? new Anthropic();
    this.label = opts.name;
    this.pinnedModel = !!opts.model;
  }

  /**
   * The playbook actually in force. When the choice depends on the role, it is
   * fixed the first time this seat sees its own view and never changes after —
   * so the results table labels the seat by what it really played.
   */
  get playbook(): Playbook {
    if (this.resolved) return this.resolved;
    return typeof this.choose_playbook === "function" ? BASELINE : this.choose_playbook;
  }

  /**
   * The label used in results. The playbook carries the variation a run is
   * testing; the model only appears when it was pinned explicitly.
   */
  get name(): string {
    return this.label ?? `llm:${this.playbook.name}${this.pinnedModel ? `@${this.modelId}` : ""}`;
  }

  // -- prompt building ------------------------------------------------------

  /**
   * Settle which playbook this seat plays, from its own role. Called at role
   * reveal so that a seat killed before it ever speaks is still attributed
   * correctly — without this, quiet early deaths all counted as the control.
   */
  observe(view: PlayerView): void {
    if (this.resolved) return;
    const team = view.you.roleId ? (ROLES[view.you.roleId]?.team ?? "village") : "village";
    this.resolved =
      typeof this.choose_playbook === "function"
        ? this.choose_playbook(team, view.you.roleId)
        : this.choose_playbook;
  }

  private system(view: PlayerView): string {
    const role = view.you.roleId ? ROLES[view.you.roleId] : null;
    this.observe(view);
    const mates = view.packmates.map((id) => nameOf(view, id));
    const lines = [
      RULES,
      "",
      `You are ${view.you.name}.`,
      role ? `Your role: ${role.name} (${role.team} team). ${role.blurb}` : "",
      mates.length ? `Your fellow werewolves: ${mates.join(", ")}. Never betray them.` : "",
      role?.team === "werewolf"
        ? "You win with the werewolves."
        : role?.team === "solo"
          ? "You win alone, on your own terms."
          : "You win when every werewolf is eliminated.",
      "",
      adviceFor(this.playbook, view.you.roleId, role?.team ?? "village"),
    ];
    return lines.filter(Boolean).join("\n");
  }

  private situation(view: PlayerView): string {
    const alive = view.players.filter((p) => p.alive).map((p) => p.name);
    const dead = view.players.filter((p) => !p.alive).map((p) => p.name);
    const parts = [
      `Day ${view.round}. Still alive: ${alive.join(", ")}.`,
      dead.length ? `Already out: ${dead.join(", ")}.` : "",
    ];

    if (view.myInspects.length) {
      const reads = view.myInspects.map((r) => {
        const what =
          r.reveal === "werewolf"
            ? "IS a werewolf"
            : r.reveal === "not-werewolf"
              ? "is NOT a werewolf"
              : `is the ${ROLES[r.reveal]?.name ?? r.reveal}`;
        return `night ${r.round}: ${nameOf(view, r.targetId)} ${what}`;
      });
      parts.push(`What you have seen yourself (nobody else knows this): ${reads.join("; ")}.`);
    }
    if (view.myDetections.length) {
      const reads = view.myDetections.map(
        (d) =>
          `night ${d.round}: ${nameOf(view, d.aId)} and ${nameOf(view, d.bId)} are ${
            d.sameTeam ? "on the same team" : "on different teams"
          }`
      );
      parts.push(`Your investigations: ${reads.join("; ")}.`);
    }

    const chat = view.chat.slice(-CHAT_WINDOW);
    if (chat.length) {
      const said = chat.map((m) => `${nameOf(view, m.playerId)}: ${m.text}`);
      parts.push(`What has been said:\n${said.join("\n")}`);
    }
    const events = view.log.slice(-LOG_WINDOW).map((e) => summarize(e, view));
    if (events.filter(Boolean).length)
      parts.push(`Recent events: ${events.filter(Boolean).join("; ")}.`);
    return parts.filter(Boolean).join("\n");
  }

  /** Ask for one of a numbered list, and get back the index — the cheapest reliable shape. */
  private async choose(
    view: PlayerView,
    question: string,
    options: PlayerId[]
  ): Promise<PlayerId> {
    const menu = options.map((id, i) => `${i + 1}. ${nameOf(view, id)}`).join("\n");
    const text = await this.ask(
      view,
      `${this.situation(view)}\n\n${question}\n${menu}\n\nReply with only the number.`,
      8
    );
    const n = Number.parseInt(text.match(/\d+/)?.[0] ?? "", 10);
    return Number.isInteger(n) && n >= 1 && n <= options.length
      ? options[n - 1]
      : options[Math.floor(Math.random() * options.length)];
  }

  private async ask(view: PlayerView, prompt: string, maxTokens: number): Promise<string> {
    const response = await this.client.messages.create({
      model: this.modelId,
      max_tokens: maxTokens,
      // The rules and this seat's role never change during a game, so they sit
      // in a cacheable prefix ahead of the volatile situation.
      system: [{ type: "text", text: this.system(view), cache_control: { type: "ephemeral" } }],
      messages: [{ role: "user", content: prompt }],
    });
    this.calls++;
    this.inputTokens += response.usage.input_tokens + (response.usage.cache_read_input_tokens ?? 0);
    this.outputTokens += response.usage.output_tokens;
    return response.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join(" ")
      .trim();
  }

  // -- the Strategy surface -------------------------------------------------

  async night(view: PlayerView): Promise<ClientMessage> {
    const prompt = view.nightPrompt!;
    try {
      const need = picksNeeded(prompt.kind);
      const pool = prompt.targetIds;
      if (!pool.length) return nightMessage(prompt, []);

      if (prompt.kind === "witch") {
        // One cheap yes/no, then let the fallback decide about poison.
        const victim = prompt.witch?.victimId;
        const save =
          !!victim &&
          !!prompt.witch?.healAvailable &&
          (await this.yesNo(
            view,
            `The wolves are about to kill ${nameOf(view, victim)}. Use your one healing potion to save them?`
          ));
        return nightMessage(prompt, [], save);
      }

      const picks: PlayerId[] = [];
      const remaining = pool.slice();
      for (let i = 0; i < Math.max(need, 1) && remaining.length; i++) {
        const chosen = await this.choose(view, this.nightQuestion(prompt.kind, i), remaining);
        picks.push(chosen);
        remaining.splice(remaining.indexOf(chosen), 1);
      }
      return nightMessage(prompt, picks);
    } catch (err) {
      this.note(err);
      return this.fallback.night(view);
    }
  }

  private nightQuestion(kind: string, index: number): string {
    const nth = index === 0 ? "" : " (now pick a second, different player)";
    switch (kind) {
      case "kill":
        return `Which player should the pack kill tonight?${nth}`;
      case "protect":
        return `Which player will you protect tonight?${nth}`;
      case "inspect":
        return `Whose true role do you want to see tonight?${nth}`;
      case "silence":
        return `Whose vote will you silence tomorrow?${nth}`;
      case "convert":
        return `Which player will you turn into a werewolf?${nth}`;
      case "detect":
        return `Pick a player to compare${nth}.`;
      case "raise":
        return `Which dead player will you bring back?${nth}`;
      default:
        return `Choose a player.${nth}`;
    }
  }

  private async yesNo(view: PlayerView, question: string): Promise<boolean> {
    const answer = await this.ask(
      view,
      `${this.situation(view)}\n\n${question}\nAnswer with only YES or NO.`,
      6
    );
    return /yes/i.test(answer);
  }

  async speak(view: PlayerView): Promise<string | null> {
    try {
      let text = clean(await this.ask(view, this.speechPrompt(view), 150));
      // A model that writes its notes into the dialogue field will happily
      // announce its own packmates. That's a formatting failure, not a play, so
      // give it one sharper nudge before giving up on the turn.
      if (looksLikeNotes(text) || confesses(text)) {
        this.leaks++;
        text = clean(
          await this.ask(
            view,
            `${this.speechPrompt(view)}\n\nIMPORTANT: output ONLY the sentence you speak ` +
              `aloud, in quotes-free plain text. No notes, no lists, no reasoning, and ` +
              `nothing about your own role that you would not shout across the square.`,
            150
          )
        );
      }
      // Silence beats publishing a confession the player never meant to make.
      if (!text.length || looksLikeNotes(text) || confesses(text)) return null;
      return text.slice(0, 300);
    } catch (err) {
      this.note(err);
      return null;
    }
  }

  private speechPrompt(view: PlayerView): string {
    return (
      `${this.situation(view)}\n\nIt is your turn to speak to the town. Everyone hears ` +
      `this, including the werewolves. Say one or two sentences, in your own voice, as ` +
      `${view.you.name} — just the words you would say out loud, nothing else.`
    );
  }

  async vote(view: PlayerView): Promise<PlayerId | null> {
    const others = otherLiving(view);
    if (!others.length) return null;
    try {
      return await this.choose(view, "Who do you vote to eliminate?", others);
    } catch (err) {
      this.note(err);
      return this.fallback.vote(view);
    }
  }

  async shoot(view: PlayerView): Promise<PlayerId> {
    const targets = view.shootPrompt!.targetIds;
    try {
      return await this.choose(view, "You are dying. Who do you take with you?", targets);
    } catch (err) {
      this.note(err);
      return this.fallback.shoot(view);
    }
  }

  private note(err: unknown) {
    this.failures++;
    const detail =
      err instanceof Anthropic.APIError ? `${err.status} ${err.message}` : String(err);
    console.warn(`  ${this.name}: falling back to a random move (${detail})`);
  }
}

/** One log entry as a short clause, or "" for the ones nobody needs to hear about. */
function summarize(entry: PlayerView["log"][number], view: PlayerView): string {
  const who = "playerId" in entry ? nameOf(view, entry.playerId) : "";
  switch (entry.type) {
    case "death":
      return `${who} was killed by wolves on night ${entry.round}`;
    case "lynch":
      return `the town voted out ${who} on day ${entry.round}`;
    case "hunterShot":
      return `${who} was shot by a dying hunter`;
    case "poisoned":
      return `${who} was poisoned`;
    case "saved":
      return `someone was attacked on night ${entry.round} but survived`;
    case "raised":
      return `${who} came back from the dead`;
    case "noDeath":
      return `night ${entry.round} passed with nobody killed`;
    case "voteTie":
      return `the vote on day ${entry.round} was a tie, so nobody went`;
    default:
      return "";
  }
}

/** Strip surrounding quotes and whitespace a model likes to wrap speech in. */
function clean(text: string): string {
  return text.replace(/^["'\s]+|["'\s]+$/g, "");
}

/**
 * Scratchpad, not speech: bullet lists, or the deliberating tone of a model
 * narrating its plan instead of playing its part.
 */
function looksLikeNotes(text: string): boolean {
  return (
    /^\s*[-*•]\s/m.test(text) ||
    /^(okay|alright|let me think|looking at this|i need to be careful|my (?:strategy|plan|goal) (?:here )?is)\b/i.test(text)
  );
}

/**
 * Things no player would ever say aloud. A wolf naming its pack is the game
 * ending by accident, so this is the one case worth suppressing outright.
 */
function confesses(text: string): boolean {
  return /\b(my packmate|fellow (?:wolf|werewolf)|i(?:'m| am) (?:a|the) (?:wolf|werewolf))\b/i.test(text);
}
