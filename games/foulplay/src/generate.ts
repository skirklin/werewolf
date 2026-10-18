import type { Agent, ClueBody, Device, Dossier, Room, Scenario, Secret } from "./types.js";
import { ALIBIS, CAST, DEVICES, FEATURES, ROOMS, THEME, TITLE, TRAITS, type DeviceTemplate } from "./content.js";
import { makeRng, pick, shuffle, type Rng } from "./rng.js";
import { trueClues } from "./clues.js";
import { Solver } from "./solver.js";
import type { Bitset } from "./space.js";

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = CAST.length;

export interface GenerateOptions {
  seed: number;
  players: number;
  /** Seat an accomplice. Defaults to on at six or more players. */
  accomplice?: boolean;
  /** Chance that an innocent's story shares the real room, and the real weapon. */
  shareChance?: number;
  /** Chance that a room also holds a record of who set foot in it. */
  visitorsChance?: number;
  /** Chance that a guest's evening is written down somewhere in the house. */
  whereaboutsChance?: number;
  /** Chance of a second sighting, where the weapon in a guest's story is kept. */
  secondSighting?: number;
  /** Weapons in play. */
  devices?: number;
}

export const defaultAccomplice = (players: number) => players >= 6;

/**
 * Build a case. Every guest gets a story first: a weapon they could have
 * used and a room they were in that fits it. The killer's story is the
 * truth. Then the evidence goes round the house:
 *  - for every other guest, an alibi (sometimes two witnesses), and the
 *    cards that rule out their story's weapon and room when those aren't the
 *    real ones. These are what break a false story, and what the killer
 *    wants gone;
 *  - in each room, whether it happened there and whether the weapon kept
 *    there was used (said only when the answer is no);
 *  - sightings that fit each guest's story: true, proving nothing, and what
 *    a guest would rather burn;
 *  - sometimes who came and went, or a guest's evening.
 * Each player also starts with one memory.
 *
 * The case is fair:
 *  - everything the innocents could find names exactly one answer;
 *  - every false story is broken by two or three cards, none of them in the
 *    Hall (searched in company from the start) or in anyone's memory, so the
 *    killer can frame someone by destroying them, but has to work for it;
 *  - the guilty's own memories are never needed.
 * Any attempt that misses is thrown away and dealt again.
 */
export function generateScenario(opts: GenerateOptions): Scenario {
  const players = opts.players;
  if (players < MIN_PLAYERS || players > MAX_PLAYERS)
    throw new Error(`Foul Play needs ${MIN_PLAYERS}–${MAX_PLAYERS} players.`);
  const rng = makeRng(opts.seed);
  for (let attempt = 0; attempt < 500; attempt++) {
    const scenario = attemptScenario(opts, rng);
    if (scenario) return scenario;
  }
  throw new Error(`Could not build a fair case from seed ${opts.seed}.`);
}

interface Measured {
  body: ClueBody;
  mask: Bitset;
}

function attemptScenario(opts: GenerateOptions, rng: Rng): Scenario | null {
  const players = opts.players;
  const shareChance = opts.shareChance ?? 0.4;
  const visitorsChance = opts.visitorsChance ?? 0.15;
  const whereaboutsChance = opts.whereaboutsChance ?? 0.15;
  const secondSighting = opts.secondSighting ?? 0.25;
  const withAccomplice = opts.accomplice ?? defaultAccomplice(players);

  const dossier = buildDossier(rng, players, opts.devices ?? 6);
  const solver = new Solver(dossier);
  const space = solver.space;
  const measure = (body: ClueBody): Measured => ({ body, mask: solver.maskOf(body) });
  const baseAnswers = space.countAnswers(space.base);
  const informative = (c: Measured) => space.countAnswers(c.mask) < baseAnswers;

  const killer = Math.floor(rng() * players);
  const others = [...Array(players).keys()].filter((i) => i !== killer);
  const accomplice = withAccomplice ? pick(others, rng) : null;
  const innocents = others.filter((i) => i !== accomplice);

  // Everyone's story: a world in which they did it. The killer's is the truth.
  const worldsOf = (agent: number) => {
    const out: number[] = [];
    space.base.forEach((i) => {
      if (space.agent[i] === agent) out.push(i);
    });
    return out;
  };
  const mine = worldsOf(killer);
  if (!mine.length) return null;
  const truth = pick(mine, rng);
  const answer = space.answerAt(truth);
  const storyWorld: number[] = [];
  for (let g = 0; g < players; g++) {
    if (g === killer) {
      storyWorld.push(truth);
      continue;
    }
    let worlds = worldsOf(g);
    const narrow = (keep: (i: number) => boolean) => {
      const n = worlds.filter(keep);
      if (n.length) worlds = n;
    };
    // Some stories borrow the real room or weapon; they're the hardest to tell apart.
    narrow(rng() < shareChance ? (i) => space.room[i] === answer.room : (i) => space.room[i] !== answer.room);
    narrow(rng() < shareChance ? (i) => space.device[i] === answer.device : (i) => space.device[i] !== answer.device);
    if (!worlds.length) return null;
    storyWorld.push(pick(worlds, rng));
  }
  const stories = storyWorld.map((i) => space.answerAt(i));
  // Each guest's evening is the one their story needs.
  const visits = storyWorld.map((i) => [...space.visitSets[space.visits[i]]]);
  const secret: Secret = { answer, visits };
  const rooms = dossier.rooms.length;
  const hall = rooms;
  const stacks: Measured[][] = Array.from({ length: rooms + 1 }, () => []);
  const anyRoom = () => Math.floor(rng() * rooms);
  const alibi = (agent: number, say: number) => measure({ kind: "notAgent", agent, say });

  // Each room: was it the scene? Each weapon: was it used? Only the "no"s are written down.
  for (const r of dossier.rooms) if (r.id !== answer.room) stacks[r.id].push(measure({ kind: "notRoom", room: r.id }));
  for (const x of dossier.devices)
    if (x.id !== answer.device) stacks[x.location].push(measure({ kind: "notDevice", device: x.id }));

  // An alibi for everyone but the killer, somewhere in the house.
  const witnesses = shuffle([...ALIBIS.keys()], rng);
  let w = 0;
  for (const g of others) stacks[anyRoom()].push(alibi(g, witnesses[w++ % witnesses.length]));

  // Sightings that fit each story, in the story's room, and sometimes where its weapon is kept.
  for (let g = 0; g < players; g++) {
    const s = stories[g];
    stacks[s.room].push(measure({ kind: "seen", agent: g, room: s.room }));
    const kept = dossier.devices[s.device].location;
    if (kept !== s.room && rng() < secondSighting) stacks[kept].push(measure({ kind: "seen", agent: g, room: kept }));
  }

  // Now and then, a record of who came and went, or of a guest's whole evening.
  for (const r of dossier.rooms)
    if (rng() < visitorsChance) {
      const seen = dossier.agents.filter((a) => visits[a.id].includes(r.id)).map((a) => a.id);
      stacks[r.id].push(measure({ kind: "visitors", room: r.id, agents: seen }));
    }
  for (const a of dossier.agents)
    if (rng() < whereaboutsChance) stacks[pick(visits[a.id], rng)].push(measure({ kind: "whereabouts", agent: a.id, rooms: [...visits[a.id]] }));

  // The body, in the Hall. It's searched in company from the start, so it
  // only holds what fits every story: no story can be broken there.
  const fitsAll = (c: Measured) => storyWorld.every((i) => c.mask.has(i));
  // The body's own evidence first, then the staff's word on who went where.
  const fitting = (bodies: ClueBody[]) => shuffle(bodies.map(measure).filter((c) => informative(c) && fitsAll(c)), rng);
  const body = [
    ...fitting(trueClues(dossier, secret).filter((b) => b.kind === "moleTrait" || b.kind === "handoffFeature")),
    ...fitting(
      dossier.rooms.map((r) => ({ kind: "visitors", room: r.id, agents: dossier.agents.filter((a) => visits[a.id].includes(r.id)).map((a) => a.id) }))
    ),
  ];
  stacks[hall] = body.slice(0, 2);

  // One memory each: a sighting. The guilty's never name the killer.
  const sightings = shuffle(
    trueClues(dossier, secret)
      .filter((b) => b.kind === "visited" || b.kind === "never")
      .map(measure)
      .filter((c) => informative(c) && fitsAll(c)),
    rng
  );
  const memories: Measured[][] = Array.from({ length: players }, () => []);
  const used = new Set<Measured>();
  for (let seat = 0; seat < players; seat++) {
    const guilty = seat === killer || seat === accomplice;
    const m = sightings.find((c) => !used.has(c) && (!guilty || !mentions(c.body, killer)));
    if (!m) return null;
    used.add(m);
    memories[seat] = [m];
  }

  // Every false story takes two or three cards to break: a second witness
  // for an alibi that would otherwise stand alone.
  const inPlay = () => stacks.flat();
  for (const g of others) {
    const breakers = inPlay().filter((c) => !c.mask.has(storyWorld[g]));
    if (breakers.length < 2) stacks[anyRoom()].push(alibi(g, witnesses[w++ % witnesses.length]));
  }
  for (const g of others) {
    const breakers = inPlay().filter((c) => !c.mask.has(storyWorld[g]));
    if (breakers.length < 2 || breakers.length > 3) return null;
    if (stacks[hall].some((c) => breakers.includes(c))) return null;
  }

  // Fairness: the innocents could prove it from what's in the house.
  const findable = [...inPlay(), ...innocents.flatMap((s) => memories[s])];
  if (space.countAnswers(intersect(space.base, findable)) !== 1) return null;
  // ...but nobody's memory alone comes close.
  if (innocents.some((s) => space.countAnswers(intersect(space.base, memories[s])) < baseAnswers / 4)) return null;

  for (let p = 0; p <= rooms; p++) stacks[p] = shuffle(stacks[p], rng);
  // Held back for a body, if there's a murder: the killer's looks.
  const culprit = dossier.agents[killer];
  const spare = shuffle(
    dossier.traits.map((t) => measure({ kind: "moleTrait", trait: t.id, value: culprit.traits[t.id], is: true })).filter(informative),
    rng
  ).slice(0, 2);

  // Number the cards in a shuffled order, so an id says nothing about a card.
  const all = shuffle([...stacks.flat(), ...memories.flat(), ...spare], rng);
  const idOf = new Map(all.map((c, i) => [c, i]));
  const ids = (xs: Measured[]) => xs.map((x) => idOf.get(x)!);
  return {
    seed: Math.floor(rng() * 2 ** 31),
    dossier,
    secret,
    killer,
    accomplice,
    stories,
    clues: all.map((c, id) => ({ ...c.body, id })),
    memories: memories.map(ids),
    stacks: stacks.map(ids),
    spare: ids(spare),
  };
}

/** Does a statement name this guest? */
function mentions(c: ClueBody, agent: number): boolean {
  if (c.kind === "visited" || c.kind === "notAgent" || c.kind === "whereabouts" || c.kind === "seen") return c.agent === agent;
  if (c.kind === "visitors") return c.agents.includes(agent);
  return false;
}

function intersect(start: Bitset, clues: { mask: Bitset }[]): Bitset {
  let s = start;
  for (const c of clues) s = s.and(c.mask);
  return s;
}

/** Seat the guests, open up the house and lay out the weapons. */
export function buildDossier(rng: Rng, players: number, deviceCount: number): Dossier {
  const rooms: Room[] = ROOMS.map((r, id) => ({
    id,
    name: r.name,
    preposition: r.preposition ?? "in",
    features: r.features,
  }));
  const agents: Agent[] = shuffle(CAST, rng)
    .slice(0, players)
    .map((c, id) => ({ id, name: c.name, motive: c.motive, traits: { ...c.traits } }));

  for (let tries = 0; ; tries++) {
    if (tries > 1000) throw new Error("Could not lay out the weapons for this table.");
    const templates = chooseDevices(rng, deviceCount);
    // A weapon nobody at the table could use, or everyone could, says nothing.
    const fair = templates.every((t) => {
      if (t.requirement.kind !== "trait") return true;
      const req = t.requirement;
      const n = agents.filter((a) => req.values.includes(a.traits[req.trait])).length;
      return n >= 1 && n < agents.length;
    });
    if (!fair) continue;
    const spots = shuffle(rooms, rng);
    const devices: Device[] = templates.map((t, id) => ({
      id,
      name: t.name,
      requirement: t.requirement,
      blurb: t.blurb,
      location: spots[id % spots.length].id,
    }));
    return { title: TITLE, theme: THEME, traits: TRAITS, features: FEATURES, agents, rooms, devices };
  }
}

/** A mix of weapons: half tied to the room, half to the killer. */
function chooseDevices(rng: Rng, n: number): DeviceTemplate[] {
  const byKind = (k: string) => shuffle(DEVICES.filter((d) => d.requirement.kind === k), rng);
  const nFeature = Math.ceil(n / 2);
  return shuffle([...byKind("feature").slice(0, nFeature), ...byKind("trait").slice(0, n - nFeature)], rng);
}
