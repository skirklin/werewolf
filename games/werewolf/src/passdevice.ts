import type { GameState } from "./types.js";
import { currentVoter } from "./engine.js";

/**
 * Pass-the-device seat sequencing (pure). Every living player is prompted each
 * night — actors act, everyone else just passes — so onlookers can't tell who
 * holds a role. Kept here (not in the React client) so it can be tested.
 */
export type Turn =
  | { kind: "night"; seatId: string; roleId: string }
  | { kind: "nightPass"; seatId: string }
  | { kind: "vote"; seatId: string }
  | { kind: "public" };

export const nightAckKey = (round: number, id: string) => `${round}:${id}`;

/**
 * Decide whose turn it is to privately hold the device.
 * @param acks `${round}:${playerId}` markers for finished night turns
 */
export function passDeviceTurn(state: GameState | null, acks: ReadonlySet<string>): Turn {
  if (!state) return { kind: "public" };

  if (state.phase === "night" && state.night) {
    // Plain seat order: nobody waits on anyone else's choice (the Witch acts
    // blind), so the order of the pass can't hint at who holds what.
    for (const p of state.players) {
      if (!p.alive) continue;
      if (acks.has(nightAckKey(state.round, p.id))) continue;
      const step = state.night.steps.find((s) => s.actorIds.includes(p.id));
      if (step && !(p.id in step.subs))
        return { kind: "night", seatId: p.id, roleId: step.roleId };
      return { kind: "nightPass", seatId: p.id };
    }
    return { kind: "public" };
  }

  if (state.phase === "dayVote") {
    // One at a time, in the day's voting order.
    const next = currentVoter(state);
    return next ? { kind: "vote", seatId: next } : { kind: "public" };
  }

  return { kind: "public" };
}
