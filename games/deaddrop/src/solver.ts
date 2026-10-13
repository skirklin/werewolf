import type { Answer, ClueBody, Dossier } from "./types.js";
import { holds } from "./clues.js";
import { Bitset, Space } from "./space.js";

/** Per-value counts of the answers still possible. */
export interface Marginals {
  agent: number[];
  device: number[];
  room: number[];
  hour: number[];
}

export interface Analysis {
  /** Candidate worlds still consistent with everything known. */
  candidates: Bitset;
  /** How many distinct (mole, device, room, hour) answers remain. */
  remaining: number;
  /** Bits of information still missing (log2 of `remaining`). */
  bitsLeft: number;
  marginals: Marginals;
  /** The answer, once only one remains. */
  solved: Answer | null;
}

export type Dimension = keyof Marginals;

/**
 * Applies what a player knows to the space of possible worlds. One per
 * dossier; clue masks are cached by id, so re-analysing after each trade only
 * costs a handful of bitwise ANDs.
 */
export class Solver {
  readonly space: Space;
  private masks = new Map<number, Bitset>();

  constructor(dossier: Dossier) {
    this.space = new Space(dossier);
  }

  get dossier() {
    return this.space.dossier;
  }

  /** The candidates a clue allows. Cached when the clue has an id. */
  maskOf(clue: ClueBody & { id?: number }): Bitset {
    if (clue.id !== undefined) {
      const hit = this.masks.get(clue.id);
      if (hit) return hit;
    }
    const m = this.space.mask((i) => holds(this.space, clue, i));
    if (clue.id !== undefined) this.masks.set(clue.id, m);
    return m;
  }

  candidates(clues: readonly ClueBody[]): Bitset {
    let set = this.space.base;
    for (const c of clues) set = set.and(this.maskOf(c));
    return set;
  }

  analyze(clues: readonly ClueBody[]): Analysis {
    const candidates = this.candidates(clues);
    const keys = this.space.answers(candidates);
    const d = this.dossier;
    const marginals: Marginals = {
      agent: d.agents.map(() => 0),
      device: d.devices.map(() => 0),
      room: d.rooms.map(() => 0),
      hour: d.hours.map(() => 0),
    };
    for (const k of keys) {
      const a = this.space.answerOfKey(k);
      marginals.agent[a.agent]++;
      marginals.device[a.device]++;
      marginals.room[a.room]++;
      marginals.hour[a.hour]++;
    }
    return {
      candidates,
      remaining: keys.length,
      bitsLeft: keys.length ? Math.log2(keys.length) : 0,
      marginals,
      solved: keys.length === 1 ? this.space.answerOfKey(keys[0]) : null,
    };
  }

  /** How many distinct answers a set of clues leaves. */
  remaining(clues: readonly ClueBody[]): number {
    return this.space.countAnswers(this.candidates(clues));
  }

  /**
   * How much a clue would tell someone who already knows `known`, in bits.
   * Zero means it adds nothing; this is what the game uses to show how
   * lopsided a trade was.
   */
  valueOf(clue: ClueBody, known: readonly ClueBody[]): number {
    const before = this.candidates(known);
    const after = before.and(this.maskOf(clue));
    const a = this.space.countAnswers(before);
    const b = this.space.countAnswers(after);
    return b ? Math.log2(a / b) : 0;
  }

  /**
   * Why a value has been ruled out: a small set of the known clues that
   * together eliminate every world in which it held. Returns [] when the
   * dossier's rules alone rule it out, and null when it is still possible.
   */
  explain<C extends ClueBody>(known: readonly C[], dim: Dimension, value: number): C[] | null {
    const s = this.space;
    let open = s.mask((i) => valueIn(s, i, dim) === value);
    if (open.isEmpty()) return [];
    if (!open.and(this.candidates(known)).isEmpty()) return null;
    // Greedy set cover: each step take the clue that knocks out the most of
    // what's left. Not always minimal, but short and readable.
    const chosen: C[] = [];
    const pool = known.slice();
    while (!open.isEmpty()) {
      let best = -1;
      let bestLeft = open.count();
      for (let j = 0; j < pool.length; j++) {
        const left = open.and(this.maskOf(pool[j])).count();
        if (left < bestLeft) {
          best = j;
          bestLeft = left;
        }
      }
      if (best < 0) break; // unreachable: the clues together do exclude it
      chosen.push(pool[best]);
      open = open.and(this.maskOf(pool[best]));
      pool.splice(best, 1);
    }
    return chosen;
  }
}

function valueIn(s: Space, i: number, dim: Dimension): number {
  if (dim === "agent") return s.agent[i];
  if (dim === "device") return s.device[i];
  if (dim === "hour") return s.hour[i];
  return s.roomAt(i);
}

export function sameAnswer(a: Answer, b: Answer): boolean {
  return a.agent === b.agent && a.device === b.device && a.room === b.room && a.hour === b.hour;
}
