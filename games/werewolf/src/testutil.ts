import type { GameState, PlayerId } from "./types.js";
import { reduce, currentVoter } from "./engine.js";

/**
 * Test helpers. Votes are cast one at a time in the day's voting order, so
 * tests describe a ballot ("who votes for whom") and these cast it in turn.
 */

/** Cast this ballot in voting order; anyone not in it abstains when their turn comes. */
export function castVotes(s: GameState, ballot: Record<PlayerId, PlayerId | null>): GameState {
  for (let v = currentVoter(s); v; v = currentVoter(s))
    s = v in ballot ? reduce(s, { type: "castVote", voterId: v, targetId: ballot[v] }) : reduce(s, { type: "skipVoter" });
  return s;
}

/** Every voter votes as `pick` says (null = abstain), in voting order. */
export function voteAll(s: GameState, pick: (voterId: PlayerId) => PlayerId | null): GameState {
  for (let v = currentVoter(s); v; v = currentVoter(s)) s = reduce(s, { type: "castVote", voterId: v, targetId: pick(v) });
  return s;
}

/** Count the votes and move past the announced result, as the host would. */
export function settleVote(s: GameState): GameState {
  s = reduce(s, { type: "resolveVote" });
  return s.phase === "verdict" ? reduce(s, { type: "endVerdict" }) : s;
}
