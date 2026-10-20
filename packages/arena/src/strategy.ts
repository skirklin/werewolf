import type { WerewolfAction, NightPrompt, PlayerId, PlayerView } from "@party/werewolf";

/**
 * A way of playing. Every method receives only this seat's redacted view, which
 * is the whole point of the exercise — a strategy has no back channel to the
 * game state, the other seats, or the referee.
 */
export interface Strategy {
  readonly name: string;
  /** Choose tonight's action. The prompt in the view says what's being asked. */
  night(view: PlayerView): Promise<WerewolfAction>;
  /** Say something to the town, or null to keep quiet this turn. */
  speak(view: PlayerView): Promise<string | null>;
  /** Who to vote out. Null abstains. */
  vote(view: PlayerView): Promise<PlayerId | null>;
  /** A fallen Hunter's parting shot. */
  shoot(view: PlayerView): Promise<PlayerId>;
  /**
   * Handed this seat's own view once roles are dealt, before any decision.
   * A strategy whose behaviour depends on its role settles it here — otherwise
   * a seat that is killed before it ever acts would never learn what it was.
   */
  observe?(view: PlayerView): void;
  /** Called once when the game ends, so a strategy can release resources. */
  finish?(): Promise<void>;
}

/** How many targets a night prompt needs before it can be submitted. */
export function picksNeeded(kind: NightPrompt["kind"]): number {
  if (kind === "swap" || kind === "detect") return 2;
  if (kind === "raise" || kind === "witch") return 0; // both may legitimately pass
  return 1;
}

/**
 * Assemble the wire message for a night action. Keeping this in one place means
 * a strategy only ever has to answer "who?", never "what shape does the Witch's
 * message take?".
 */
export function nightMessage(
  prompt: NightPrompt,
  picks: PlayerId[],
  heal: PlayerId | null = null
): WerewolfAction {
  switch (prompt.kind) {
    case "witch":
      return { type: "witchAction", healTargetId: heal, poisonTargetId: picks[0] ?? null };
    case "swap":
      return { type: "swapAction", aId: picks[0], bId: picks[1] };
    case "detect":
      return { type: "detectAction", aId: picks[0], bId: picks[1] };
    case "raise":
      return { type: "raiseAction", targetId: picks[0] ?? null };
    default:
      return { type: "nightChoice", targetId: picks[0] };
  }
}

/** Everyone still alive who isn't this seat — the usual candidate pool. */
export function otherLiving(view: PlayerView): PlayerId[] {
  return view.players.filter((p) => p.alive && p.id !== view.you.id).map((p) => p.id);
}

/** This seat's fellow wolves, if it has any. */
export function packmates(view: PlayerView): Set<PlayerId> {
  return new Set(view.packmates);
}

export function nameOf(view: PlayerView, id: PlayerId): string {
  return view.players.find((p) => p.id === id)?.name ?? "someone";
}
