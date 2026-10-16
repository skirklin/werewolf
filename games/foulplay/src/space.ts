import type { Answer, Dossier, Requirement, RoomId } from "./types.js";

/** Every guest visits between this many rooms over the evening. */
export const MIN_VISITS = 2;
export const MAX_VISITS = 4;

/**
 * The space of possible worlds, small enough to list in full.
 *
 * A candidate is a culprit, an item (weapon), the room of the act, and the set
 * of rooms the culprit visited during the evening. The dossier's rules are
 * applied up front: the act happened in a room the culprit visited, the culprit visited the room
 * the device was hidden in, and the device's requirement holds. So every
 * candidate here is already consistent with the dossier.
 *
 * Keeping the visits in the candidate is what lets "X never set foot in the
 * Garden" rule out weapons kept there, and a murder there, if X is the killer.
 * With six rooms that's about fourteen thousand candidates, so the solver is
 * exact filtering over bitsets rather than anything clever.
 */
export class Space {
  /** Every possible set of visited rooms, as sorted room lists. */
  readonly visitSets: RoomId[][];
  readonly size: number;
  readonly agent: Uint8Array;
  readonly device: Uint8Array;
  readonly room: Uint8Array;
  readonly visits: Uint16Array;
  /** Index of the candidate's (agent, device, room) answer. */
  readonly answerKey: Uint16Array;
  readonly answerSpace: number;
  /** Candidates consistent with the dossier alone. */
  readonly base: Bitset;

  constructor(readonly dossier: Dossier) {
    const { agents, devices, rooms } = dossier;
    this.visitSets = enumerateVisitSets(rooms.length);
    this.answerSpace = agents.length * devices.length * rooms.length;

    const ag: number[] = [];
    const dv: number[] = [];
    const rm: number[] = [];
    const vs: number[] = [];
    for (let a = 0; a < agents.length; a++)
      for (let d = 0; d < devices.length; d++)
        for (let r = 0; r < rooms.length; r++)
          for (let v = 0; v < this.visitSets.length; v++) {
            ag.push(a);
            dv.push(d);
            rm.push(r);
            vs.push(v);
          }
    this.size = ag.length;
    this.agent = Uint8Array.from(ag);
    this.device = Uint8Array.from(dv);
    this.room = Uint8Array.from(rm);
    this.visits = Uint16Array.from(vs);
    this.answerKey = new Uint16Array(this.size);
    for (let i = 0; i < this.size; i++) this.answerKey[i] = this.keyOf(this.answerAt(i));

    this.base = this.mask((i) => {
      const dev = devices[this.device[i]];
      const seen = this.visitSets[this.visits[i]];
      const room = this.room[i];
      return (
        seen.includes(room) &&
        seen.includes(dev.location) && // the culprit had to collect the item
        meets(dossier, dev.requirement, this.agent[i], room)
      );
    }, true);
  }

  answerAt(i: number): Answer {
    return { agent: this.agent[i], device: this.device[i], room: this.room[i] };
  }

  keyOf(a: Answer): number {
    const { devices, rooms } = this.dossier;
    return (a.agent * devices.length + a.device) * rooms.length + a.room;
  }

  answerOfKey(key: number): Answer {
    const { devices, rooms } = this.dossier;
    const room = key % rooms.length;
    key = (key - room) / rooms.length;
    const device = key % devices.length;
    const agent = (key - device) / devices.length;
    return { agent, device, room };
  }

  /** The candidates (within the dossier's rules) for which `pred` holds. */
  mask(pred: (i: number) => boolean, ignoreBase = false): Bitset {
    const out = new Bitset(this.size);
    for (let i = 0; i < this.size; i++) {
      if (!ignoreBase && !this.base.has(i)) continue;
      if (pred(i)) out.set(i);
    }
    return out;
  }

  /** Distinct answers among a set of candidates. */
  answers(set: Bitset): number[] {
    const seen = new Uint8Array(this.answerSpace);
    const out: number[] = [];
    set.forEach((i) => {
      const k = this.answerKey[i];
      if (!seen[k]) {
        seen[k] = 1;
        out.push(k);
      }
    });
    return out;
  }

  /** How many distinct answers a set of candidates allows. */
  countAnswers(set: Bitset): number {
    const seen = new Uint8Array(this.answerSpace);
    let n = 0;
    set.forEach((i) => {
      const k = this.answerKey[i];
      if (!seen[k]) {
        seen[k] = 1;
        n++;
      }
    });
    return n;
  }
}

/** Does the act, by `agent` in `room`, satisfy a requirement? */
export function meets(d: Dossier, req: Requirement, agent: number, room: RoomId): boolean {
  switch (req.kind) {
    case "feature":
      return d.rooms[room].features.includes(req.feature) === req.is;
    case "trait":
      return req.values.includes(d.agents[agent].traits[req.trait]);
  }
}

/** Every set of between MIN_VISITS and MAX_VISITS rooms, each as a sorted list. */
export function enumerateVisitSets(rooms: number): RoomId[][] {
  const out: RoomId[][] = [];
  for (let mask = 0; mask < 1 << rooms; mask++) {
    const set: RoomId[] = [];
    for (let r = 0; r < rooms; r++) if (mask & (1 << r)) set.push(r);
    if (set.length >= MIN_VISITS && set.length <= MAX_VISITS) out.push(set);
  }
  return out;
}

/** A fixed-size set of candidate indices. */
export class Bitset {
  readonly words: Uint32Array;

  constructor(readonly size: number, words?: Uint32Array) {
    this.words = words ?? new Uint32Array(Math.ceil(size / 32));
  }

  set(i: number) {
    this.words[i >>> 5] |= 1 << (i & 31);
  }

  has(i: number): boolean {
    return (this.words[i >>> 5] & (1 << (i & 31))) !== 0;
  }

  and(other: Bitset): Bitset {
    const w = new Uint32Array(this.words.length);
    for (let i = 0; i < w.length; i++) w[i] = this.words[i] & other.words[i];
    return new Bitset(this.size, w);
  }

  andNot(other: Bitset): Bitset {
    const w = new Uint32Array(this.words.length);
    for (let i = 0; i < w.length; i++) w[i] = this.words[i] & ~other.words[i];
    return new Bitset(this.size, w);
  }

  isEmpty(): boolean {
    for (let i = 0; i < this.words.length; i++) if (this.words[i]) return false;
    return true;
  }

  count(): number {
    let n = 0;
    for (let i = 0; i < this.words.length; i++) {
      let v = this.words[i];
      v = v - ((v >>> 1) & 0x55555555);
      v = (v & 0x33333333) + ((v >>> 2) & 0x33333333);
      n += (((v + (v >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24;
    }
    return n;
  }

  forEach(fn: (i: number) => void) {
    for (let w = 0; w < this.words.length; w++) {
      let v = this.words[w];
      while (v) {
        const bit = v & -v;
        fn((w << 5) + 31 - Math.clz32(bit));
        v ^= bit;
      }
    }
  }
}
