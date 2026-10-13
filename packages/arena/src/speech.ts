import { ROLES, type GameRecord } from "@party/werewolf";
import { SEAT_NAMES } from "./match.js";
import type { Said } from "./match.js";

/**
 * Reading what agents actually said, with roles attached. Used both by the
 * transcript annotator and by the tournament, so "did the wolves bluff?" is
 * measured the same way wherever it's asked.
 *
 * These are keyword heuristics over free text, so treat them as indicators
 * rather than ground truth — they undercount paraphrase and can be fooled by
 * someone quoting an accusation back. Good enough to compare prompts against
 * each other; not good enough to call a single line a lie.
 */

/** Claiming a role, or first-hand knowledge only a power role could have. */
export const CLAIM =
  /\b(i(?:'m| am)\s+(?:the\s+)?(?:seer|doctor|villager|werewolf|wolf|medium|detective|hunter|witch)|my (?:vision|read|check|investigation)|i (?:checked|saw|inspected|protected|healed|investigated)|as the (?:seer|doctor))\b/i;

/** Pointing a finger at somebody in particular. */
export const ACCUSE =
  /\b(vote (?:for|out)|is a wolf|is the wolf|suspicious of|i suspect|has to be|it's got to be)\b/i;

export interface SpeechStats {
  lines: number;
  /** Lines that claim a role or first-hand information. */
  claims: number;
  /**
   * Claims made by a wolf. A wolf has no visions to report, so a claim from
   * one is a bluff — the behaviour a social deduction game is supposed to
   * produce, and the thing the first run produced none of.
   */
  bluffs: number;
  accusations: number;
  /** Lines spoken while on the wolf team, for a per-side rate. */
  wolfLines: number;
}

const blank = (): SpeechStats => ({
  lines: 0,
  claims: 0,
  bluffs: 0,
  accusations: 0,
  wolfLines: 0,
});

/**
 * Attribute each line of talk to the strategy that said it and whether that
 * seat was a wolf. Seats are named by index and records list seats in the same
 * order, so the join is exact.
 */
export function analyzeSpeech(
  games: readonly { record: GameRecord; transcript: readonly Said[] }[]
): Map<string, SpeechStats> {
  const byStrategy = new Map<string, SpeechStats>();
  for (const { record, transcript } of games) {
    for (const said of transcript) {
      const seat = SEAT_NAMES.indexOf(said.speaker);
      const info = seat >= 0 ? record.seats[seat] : undefined;
      if (!info) continue;
      const stats = byStrategy.get(said.strategy) ?? blank();
      const wolf = ROLES[info.dealt]?.team === "werewolf";
      stats.lines++;
      if (wolf) stats.wolfLines++;
      if (ACCUSE.test(said.text)) stats.accusations++;
      if (CLAIM.test(said.text)) {
        stats.claims++;
        if (wolf) stats.bluffs++;
      }
      byStrategy.set(said.strategy, stats);
    }
  }
  return byStrategy;
}
