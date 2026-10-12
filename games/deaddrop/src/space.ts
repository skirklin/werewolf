import type { Answer, Dossier, Requirement, RoomId } from "./types.js";

/**
 * The space of possible worlds, small enough to list in full.
 *
 * A candidate is a mole, a device, an hour, and the mole's whole route through
 * the house (one room per hour, moving only between adjacent rooms). The
 * handoff room is wherever that route has the mole at the handoff hour. The
 * dossier's rules — each device's requirement, and that the mole must have
 * passed the device's hiding place by the handoff — are applied up front, so
 * every candidate here is already consistent with the dossier.
 *
 * Keeping the route in the candidate is what lets "X was in the Study at 9pm"
 * say something about where X could have been at 10pm. With six rooms and four
 * hours this is a few tens of thousands of candidates, so the solver is exact
 * filtering over bitsets rather than anything clever.
 */
export class Space {
  readonly paths: RoomId[][];
  readonly size: number;
  readonly agent: Uint8Array;
  readonly device: Uint8Array;
  readonly hour: Uint8Array;
  readonly path: Uint16Array;
  /** Index of the candidate's (agent, device, room, hour) answer. */
  readonly answerKey: Uint16Array;
  readonly answerSpace: number;
  /** Candidates consistent with the dossier alone. */
  readonly base: Bitset;

  constructor(readonly dossier: Dossier) {
    const { agents, devices, rooms, hours } = dossier;
    this.paths = enumeratePaths(dossier);
    this.answerSpace = agents.length * devices.length * rooms.length * hours.length;

    const ag: number[] = [];
    const dv: number[] = [];
    const hr: number[] = [];
    const pt: number[] = [];
    for (let a = 0; a < agents.length; a++)
      for (let d = 0; d < devices.length; d++)
        for (let h = 0; h < hours.length; h++)
          for (let p = 0; p < this.paths.length; p++) {
            ag.push(a);
            dv.push(d);
            hr.push(h);
            pt.push(p);
          }
    this.size = ag.length;
    this.agent = Uint8Array.from(ag);
    this.device = Uint8Array.from(dv);
    this.hour = Uint8Array.from(hr);
    this.path = Uint16Array.from(pt);
    this.answerKey = new Uint16Array(this.size);
    for (let i = 0; i < this.size; i++) this.answerKey[i] = this.keyOf(this.answerAt(i));

    this.base = this.mask((i) => {
      const dev = devices[this.device[i]];
      const route = this.paths[this.path[i]];
      const h = this.hour[i];
      if (!meets(dossier, dev.requirement, this.agent[i], route[h], h)) return false;
      // The mole had to collect the device on the way.
      for (let t = 0; t <= h; t++) if (route[t] === dev.location) return true;
      return false;
    }, true);
  }

  roomAt(i: number): RoomId {
    return this.paths[this.path[i]][this.hour[i]];
  }

  answerAt(i: number): Answer {
    return { agent: this.agent[i], device: this.device[i], room: this.roomAt(i), hour: this.hour[i] };
  }

  keyOf(a: Answer): number {
    const { devices, rooms, hours } = this.dossier;
    return ((a.agent * devices.length + a.device) * rooms.length + a.room) * hours.length + a.hour;
  }

  answerOfKey(key: number): Answer {
    const { devices, rooms, hours } = this.dossier;
    const hour = key % hours.length;
    key = (key - hour) / hours.length;
    const room = key % rooms.length;
    key = (key - room) / rooms.length;
    const device = key % devices.length;
    const agent = (key - device) / devices.length;
    return { agent, device, room, hour };
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

/** Does a handoff by `agent` in `room` at `hour` satisfy a requirement? */
export function meets(d: Dossier, req: Requirement, agent: number, room: RoomId, hour: number): boolean {
  switch (req.kind) {
    case "feature":
      return d.rooms[room].features.includes(req.feature) === req.is;
    case "trait":
      return req.values.includes(d.agents[agent].traits[req.trait]);
    case "hours":
      return hour >= req.from && hour <= req.to;
  }
}

/** Every route through the house: one room per hour, staying or stepping to a neighbour. */
export function enumeratePaths(d: Dossier): RoomId[][] {
  let paths: RoomId[][] = d.rooms.map((r) => [r.id]);
  for (let h = 1; h < d.hours.length; h++) {
    const next: RoomId[][] = [];
    for (const p of paths) {
      const here = p[p.length - 1];
      for (const r of [here, ...d.rooms[here].adjacent]) next.push([...p, r]);
    }
    paths = next;
  }
  return paths;
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
