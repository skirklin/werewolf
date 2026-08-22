import { ROLES, type ClientMessage, type PlayerId, type PlayerView } from "@werewolf/shared";
import { nameOf, nightMessage, otherLiving, picksNeeded, type Strategy } from "../strategy.js";

/**
 * A rules-of-thumb player, and the interesting baseline: it never reasons about
 * what anyone *said*, only about what it knows first-hand. Anything an LLM
 * strategy wins above this line is the value of actually talking.
 *
 * Village: keep your own seer reads, vote the worst-known player, protect
 * whoever looks most useful. Wolves: never eat the pack, and steer the day onto
 * someone outside it.
 */
export class HeuristicStrategy implements Strategy {
  readonly name: string;

  constructor(
    private readonly rng: () => number = Math.random,
    name = "heuristic"
  ) {
    this.name = name;
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rng() * items.length)];
  }

  /** Players this seat has personally confirmed as wolves (its own visions only). */
  private knownWolves(view: PlayerView): Set<PlayerId> {
    const wolves = new Set<PlayerId>();
    for (const r of view.myInspects) {
      if (r.reveal === "werewolf" || ROLES[r.reveal]?.team === "werewolf") wolves.add(r.targetId);
    }
    return wolves;
  }

  /** Players this seat has personally cleared. */
  private knownClear(view: PlayerView): Set<PlayerId> {
    const clear = new Set<PlayerId>();
    for (const r of view.myInspects) {
      if (r.reveal === "not-werewolf" || (ROLES[r.reveal] && ROLES[r.reveal].team !== "werewolf"))
        clear.add(r.targetId);
    }
    return clear;
  }

  private isWolf(view: PlayerView): boolean {
    return !!view.you.roleId && ROLES[view.you.roleId]?.team === "werewolf";
  }

  async night(view: PlayerView): Promise<ClientMessage> {
    const prompt = view.nightPrompt!;
    const pack = new Set(view.packmates);
    const wolves = this.knownWolves(view);
    const clear = this.knownClear(view);

    const rank = (ids: PlayerId[]): PlayerId[] => {
      const scored = ids.map((id) => {
        let score = this.rng(); // break ties differently every game
        if (prompt.kind === "kill" || prompt.kind === "convert") {
          // Wolves eat the players most likely to be dangerous — and never kin.
          if (pack.has(id)) score -= 100;
          score += clear.has(id) ? 1 : 0;
        } else if (prompt.kind === "inspect" || prompt.kind === "detect") {
          // No point re-reading someone already read.
          if (wolves.has(id) || clear.has(id)) score -= 10;
        } else if (prompt.kind === "protect") {
          // Shield the cleared — they're the town's known-good information.
          score += clear.has(id) ? 1 : 0;
        } else if (prompt.kind === "silence") {
          score += wolves.has(id) ? 2 : 0;
        }
        return { id, score };
      });
      return scored.sort((a, b) => b.score - a.score).map((s) => s.id);
    };

    const ordered = rank(prompt.targetIds);
    const need = picksNeeded(prompt.kind);
    const picks = ordered.slice(0, Math.max(need, ordered.length && need === 0 ? 1 : 0));
    // Save the victim if there's one to save; poison nobody (too easy to misfire).
    const save = prompt.kind === "witch" && !!prompt.witch?.victimId && !!prompt.witch.healAvailable;
    return nightMessage(prompt, need === 0 && !save ? [] : picks.slice(0, Math.max(need, 1)), save);
  }

  async speak(view: PlayerView): Promise<string | null> {
    // Only speaks when it has something it actually knows, and never as a wolf
    // (claiming a read it can't back up gets it caught).
    if (this.isWolf(view)) return null;
    const wolves = [...this.knownWolves(view)].filter((id) =>
      view.players.some((p) => p.id === id && p.alive)
    );
    if (!wolves.length) return null;
    // Don't repeat a claim it has already made.
    const already = view.chat.some((m) => m.playerId === view.you.id);
    if (already) return null;
    return `I have a read: ${nameOf(view, wolves[0])} is a wolf. Vote with me.`;
  }

  async vote(view: PlayerView): Promise<PlayerId | null> {
    const others = otherLiving(view);
    if (!others.length) return null;
    const wolves = this.knownWolves(view);
    const clear = this.knownClear(view);
    const pack = new Set(view.packmates);
    const wolfSide = this.isWolf(view);

    const scored = others.map((id) => {
      let score = this.rng();
      if (wolfSide) {
        if (pack.has(id)) score -= 100; // never eat your own at the stake either
      } else {
        if (wolves.has(id)) score += 100; // a confirmed wolf outranks everything
        if (clear.has(id)) score -= 50;
      }
      // Follow the room a little: piling on is how villages actually win.
      score += (view.voteTally[id] ?? 0) * 0.5;
      return { id, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored[0].id;
  }

  async shoot(view: PlayerView): Promise<PlayerId> {
    const targets = view.shootPrompt!.targetIds;
    const wolves = [...this.knownWolves(view)].filter((id) => targets.includes(id));
    return wolves.length ? wolves[0] : this.pick(targets);
  }
}
