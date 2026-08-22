import Anthropic from "@anthropic-ai/sdk";
import { ROLES, type ClientMessage, type PlayerId, type PlayerView } from "@werewolf/shared";
import { nameOf, nightMessage, otherLiving, picksNeeded, type Strategy } from "../strategy.js";
import { RandomStrategy } from "./random.js";

/**
 * The user picked Haiku 4.5 as the default: the point of the arena is sample
 * size, and a seven-player game is easily fifty calls. Override per strategy to
 * pit one tier against another.
 */
export const DEFAULT_MODEL = "claude-haiku-4-5";

export interface LlmOptions {
  model?: string;
  /** Label used in the results table. Defaults to `llm:<model>`. */
  name?: string;
  client?: Anthropic;
  /** Extra guidance appended to the system prompt — the knob for A/B-ing prompts. */
  persona?: string;
}

/** How many messages of backchat to hand the model. Keeps input tokens bounded. */
const CHAT_WINDOW = 30;
const LOG_WINDOW = 20;

const RULES = `You are playing Werewolf (also called Mafia), a social deduction game.

How it works:
- Each night the werewolves secretly agree on one player to kill. Special roles
  (Seer, Doctor and others) also act at night.
- Each day everyone talks, then the town votes. The player with the most votes
  is eliminated. A tie eliminates nobody.
- The village wins when every werewolf is gone. The werewolves win the moment
  they equal the number of surviving players.
- Dead players cannot speak or vote.

How to play well:
- You only know what you have personally seen. Other players lie, including
  about their roles.
- If you are a werewolf, you must blend in: sound like a villager, cast doubt on
  the innocent, and never reveal your packmates.
- If you have information (a Seer vision, for example), think about whether
  sharing it helps the village more than it paints a target on your back.
- Silence is suspicious, but so is talking too much. Be specific about who you
  suspect and why.`;

/**
 * An LLM plays one seat. Every prompt is built from this seat's redacted view
 * and nothing else — the model literally cannot be told another player's role,
 * because the process running it was never sent one.
 *
 * Any API trouble falls back to a random legal move so a run of games can't be
 * killed by one hiccup.
 */
export class LlmStrategy implements Strategy {
  readonly name: string;
  private readonly model: string;
  private readonly client: Anthropic;
  private readonly persona: string;
  private readonly fallback = new RandomStrategy();
  /** Rough running totals, reported at the end of a run. */
  calls = 0;
  inputTokens = 0;
  outputTokens = 0;
  failures = 0;

  constructor(opts: LlmOptions = {}) {
    this.model = opts.model ?? DEFAULT_MODEL;
    this.name = opts.name ?? `llm:${this.model}`;
    this.client = opts.client ?? new Anthropic();
    this.persona = opts.persona ?? "";
  }

  // -- prompt building ------------------------------------------------------

  private system(view: PlayerView): string {
    const role = view.you.roleId ? ROLES[view.you.roleId] : null;
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
      this.persona,
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
      model: this.model,
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
      const said = await this.ask(
        view,
        `${this.situation(view)}\n\nIt is your turn to speak to the town. Say one or two ` +
          `sentences, in your own voice, as ${view.you.name}. Do not describe what you are ` +
          `doing or mention that you are an AI — just say the words you would say out loud.`,
        150
      );
      const text = said.replace(/^["']|["']$/g, "").trim();
      return text.length ? text.slice(0, 300) : null;
    } catch (err) {
      this.note(err);
      return null;
    }
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
