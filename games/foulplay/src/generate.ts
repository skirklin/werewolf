import type { Agent, ClueBody, Device, Dossier, Room, Scenario, Secret } from "./types.js";
import { CAST, DEVICES, FEATURES, ROOMS, THEME, TITLE, TRAITS, type DeviceTemplate } from "./content.js";
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
  /** Looks the body in the Hall gives away. */
  bodyTraits?: number;
  /** Chance that a room holds a record of who set foot in it. */
  visitorsChance?: number;
  /** Chance that a guest's evening is written down somewhere in the house. */
  whereaboutsChance?: number;
  /** The most cards any room holds at the start. */
  stackLimit?: number;
  /** Weapons in play. */
  devices?: number;
  /** Require the case to survive losing any one card (default true). */
  robust?: boolean;
}

export const defaultAccomplice = (players: number) => players >= 6;

/**
 * Build a case. The killer, weapon and room come first; the evidence is then
 * written to fit them and left around the house:
 *  - in the Hall, on the body: the killer's looks and what kind of room it
 *    happened in;
 *  - in each room: whether it happened there, whether the weapon kept there
 *    is missing, and sometimes who set foot there, or a guest's evening.
 * Each player also starts with one memory.
 *
 * The case is fair:
 *  - everything the innocents could find names exactly one answer;
 *  - it still does with any single card destroyed, so the killer has to
 *    destroy more than one to win that way;
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
  const bodyTraits = opts.bodyTraits ?? 2;
  const visitorsChance = opts.visitorsChance ?? 0.5;
  const whereaboutsChance = opts.whereaboutsChance ?? 0.5;
  const stackLimit = opts.stackLimit ?? 3;
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

  // One of the weapons, rooms and evenings that would have let the killer do it.
  const options: number[] = [];
  space.base.forEach((i) => {
    if (space.agent[i] === killer) options.push(i);
  });
  if (!options.length) return null;
  const truth = pick(options, rng);
  const visits = dossier.agents.map((a) =>
    a.id === killer ? space.visitSets[space.visits[truth]] : pick(space.visitSets, rng)
  );
  const secret: Secret = { answer: space.answerAt(truth), visits };
  const { answer } = secret;
  const culprit = dossier.agents[killer];
  const rooms = dossier.rooms.length;
  const hall = rooms;

  // The body, in the Hall: a few of the killer's looks, and the room it happened in.
  const looks = shuffle(
    dossier.traits
      .map((t) => measure({ kind: "moleTrait", trait: t.id, value: culprit.traits[t.id], is: true }))
      .filter(informative),
    rng
  );
  if (looks.length < bodyTraits + 1) return null;
  const scene = dossier.rooms[answer.room];
  const roomSign = shuffle(
    dossier.features
      .map((f) => measure({ kind: "handoffFeature", feature: f.id, is: scene.features.includes(f.id) }))
      .filter(informative),
    rng
  )[0];
  const stacks: Measured[][] = Array.from({ length: rooms + 1 }, () => []);
  stacks[hall] = shuffle([...looks.slice(0, bodyTraits), ...(roomSign ? [roomSign] : [])], rng);
  // Held back for a second body.
  const spare = looks.slice(bodyTraits, bodyTraits + 2);

  // Each room: was it the scene, and is the weapon kept here missing?
  for (const r of dossier.rooms) {
    stacks[r.id].push(measure(r.id === answer.room ? { kind: "isRoom", room: r.id } : { kind: "notRoom", room: r.id }));
    for (const x of dossier.devices)
      if (x.location === r.id)
        stacks[r.id].push(measure(x.id === answer.device ? { kind: "isDevice", device: x.id } : { kind: "notDevice", device: x.id }));
    // Sometimes the staff kept track of who came and went.
    if (rng() < visitorsChance) {
      const seen = dossier.agents.filter((a) => visits[a.id].includes(r.id)).map((a) => a.id);
      stacks[r.id].push(measure({ kind: "visitors", room: r.id, agents: seen }));
    }
  }
  // Sometimes a guest's evening is written down, somewhere they went.
  for (const a of dossier.agents)
    if (rng() < whereaboutsChance) {
      const where = pick(visits[a.id], rng);
      stacks[where].push(measure({ kind: "whereabouts", agent: a.id, rooms: [...visits[a.id]] }));
    }
  for (let p = 0; p < rooms; p++) {
    // Keep the room's own card; trim the extras beyond the limit.
    const [own, ...rest] = stacks[p];
    stacks[p] = shuffle([own, ...shuffle(rest, rng).slice(0, stackLimit - 1)], rng);
  }

  // One memory each: a sighting. The guilty's never name the killer.
  const sightings = shuffle(
    trueClues(dossier, secret)
      .filter((b) => b.kind === "visited" || b.kind === "never")
      .map(measure)
      .filter(informative),
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

  // Fairness: the innocents could prove it, even if any one card is lost.
  const findable = [...stacks.flat(), ...innocents.flatMap((s) => memories[s])];
  const unique = (cs: Measured[]) => space.countAnswers(intersect(space.base, cs)) === 1;
  if (!unique(findable)) return null;
  if (opts.robust ?? true) for (const c of stacks.flat()) if (!unique(findable.filter((x) => x !== c))) return null;
  // ...but nobody's memory alone comes close.
  if (innocents.some((s) => space.countAnswers(intersect(space.base, memories[s])) < baseAnswers / 4)) return null;

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
    clues: all.map((c, id) => ({ ...c.body, id })),
    memories: memories.map(ids),
    stacks: stacks.map(ids),
    spare: ids(spare),
  };
}

/** Does a statement name this guest? */
function mentions(c: ClueBody, agent: number): boolean {
  if (c.kind === "visited" || c.kind === "notAgent" || c.kind === "whereabouts") return c.agent === agent;
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
