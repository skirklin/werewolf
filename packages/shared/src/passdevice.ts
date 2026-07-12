import type { GameState } from "./types.js";

/**
 * Pass-the-device seat sequencing (pure). Every living player is prompted each
 * night — actors act, everyone else just passes — so onlookers can't tell who
 * holds a role. Kept here (not in the React client) so it can be tested.
 */
export type Turn =
  | { kind: "reveal"; seatId: string }
  | { kind: "startNight" }
  | { kind: "night"; seatId: string; roleId: string }
  | { kind: "nightPass"; seatId: string }
  | { kind: "shoot"; seatId: string }
  | { kind: "vote"; seatId: string }
  | { kind: "public" };

export const nightAckKey = (round: number, id: string) => `${round}:${id}`;

/**
 * Decide whose turn it is to privately hold the device.
 * @param revealed player ids that have already seen their role card
 * @param acks     `${round}:${playerId}` markers for finished night turns
 */
export function passDeviceTurn(
  state: GameState | null,
  revealed: ReadonlySet<string>,
  acks: ReadonlySet<string>
): Turn {
  if (!state) return { kind: "public" };

  if (state.phase === "roleReveal") {
    const next = state.players.find((p) => !revealed.has(p.id));
    return next ? { kind: "reveal", seatId: next.id } : { kind: "startNight" };
  }

  if (state.phase === "night" && state.night) {
    const killStep = state.night.steps.find((s) => s.kind === "kill");
    const killReady = !killStep || killStep.done; // no wolves ⇒ nothing to wait for
    for (const p of state.players) {
      if (!p.alive) continue;
      if (acks.has(nightAckKey(state.round, p.id))) continue;
      const step = state.night.steps.find((s) => s.actorIds.includes(p.id));
      // The Witch acts only after the wolves — skip her seat until then and
      // circle back (she becomes the last actor of the night).
      if (step?.kind === "witch" && !killReady) continue;
      if (step && !(p.id in step.subs))
        return { kind: "night", seatId: p.id, roleId: step.roleId };
      return { kind: "nightPass", seatId: p.id };
    }
    return { kind: "public" };
  }

  if (state.phase === "hunterShot") {
    const shooter = state.pendingShots[0];
    return shooter ? { kind: "shoot", seatId: shooter } : { kind: "public" };
  }

  if (state.phase === "dayVote") {
    const next = state.players.find(
      (p) => p.alive && !state.silenced.includes(p.id) && !(p.id in state.votes)
    );
    return next ? { kind: "vote", seatId: next.id } : { kind: "public" };
  }

  return { kind: "public" };
}
