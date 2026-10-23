import type { WerewolfAction, PlayerId, PlayerView } from "@party/werewolf";
import { nightMessage, otherLiving, picksNeeded, type Strategy } from "../strategy.js";

/**
 * The control. Picks uniformly at random from whatever the server says is legal
 * and never says a word, so every other strategy's win rate can be read against
 * "what does luck alone get you at this table size?".
 */
export class RandomStrategy implements Strategy {
  readonly name: string;

  constructor(
    private readonly rng: () => number = Math.random,
    name = "random"
  ) {
    this.name = name;
  }

  private pick<T>(items: readonly T[]): T {
    return items[Math.floor(this.rng() * items.length)];
  }

  async night(view: PlayerView): Promise<WerewolfAction> {
    const prompt = view.nightPrompt!;
    const pool = prompt.targetIds.slice();
    const picks: PlayerId[] = [];
    for (let i = 0; i < picksNeeded(prompt.kind) && pool.length; i++) {
      picks.push(...pool.splice(Math.floor(this.rng() * pool.length), 1));
    }
    // The Witch and the Medium may pass; when they don't, spend on a coin flip.
    if (picksNeeded(prompt.kind) === 0 && pool.length && this.rng() < 0.5) {
      picks.push(this.pick(pool));
    }
    const heal = !!prompt.witch?.healAvailable && this.rng() < 0.5;
    return nightMessage(prompt, picks, heal);
  }

  // Takes the view it ignores, so subclasses can override with one.
  async speak(_view: PlayerView): Promise<string | null> {
    return null; // the strong and silent type
  }

  async vote(view: PlayerView): Promise<PlayerId | null> {
    const others = otherLiving(view);
    return others.length ? this.pick(others) : null;
  }
}
