import type { Agent, ClueBody, Device, Dossier, Room, Scenario, Secret } from "./types.js";
import { AGENT_NAMES, DEVICES, FEATURES, HOURS, ROOMS, TITLE, TRAITS, type DeviceTemplate } from "./content.js";
import { makeRng, pick, shuffle, type Rng } from "./rng.js";
import { trueClues, withIds } from "./clues.js";
import { Solver } from "./solver.js";
import type { Bitset } from "./space.js";

export interface GenerateOptions {
  seed: number;
  players: number;
  /** Clues each player is dealt. Defaults by player count. */
  handSize?: number;
  /** Clues everyone starts with. */
  publicClues?: number;
  /** Suspects at the reception. */
  agents?: number;
  /** Concealment devices in play. */
  devices?: number;
  /** A single hand (plus the public clues) must leave at least this many answers. */
  minAloneAnswers?: number;
  /** Size of the draw pile, in starting hands' worth of cards. */
  deckHands?: number;
}

export const MIN_PLAYERS = 2;
export const MAX_PLAYERS = 6;

export function defaultHandSize(players: number): number {
  if (players <= 2) return 7;
  if (players === 3) return 6;
  if (players === 4) return 5;
  return 4;
}

/**
 * Build a scenario that is guaranteed to be fair: everything dealt together
 * pins down exactly one answer, no single hand comes close, and no two hands
 * (at four or more players) finish the job between them. Rather than hoping a
 * shuffled deck is in order, each attempt is checked by the solver and thrown
 * away if it fails, so a broken game cannot be dealt.
 */
export function generateScenario(opts: GenerateOptions): Scenario {
  const players = opts.players;
  if (players < MIN_PLAYERS || players > MAX_PLAYERS)
    throw new Error(`Dead Drop needs ${MIN_PLAYERS}–${MAX_PLAYERS} players.`);
  const rng = makeRng(opts.seed);
  for (let attempt = 0; attempt < 200; attempt++) {
    const scenario = attemptScenario(opts, rng);
    if (scenario) return scenario;
  }
  throw new Error(`Could not build a fair scenario from seed ${opts.seed}.`);
}

function attemptScenario(opts: GenerateOptions, rng: Rng): Scenario | null {
  const players = opts.players;
  const handSize = opts.handSize ?? defaultHandSize(players);
  const publicCount = opts.publicClues ?? 2;
  const minAlone = opts.minAloneAnswers ?? 4;
  // Each round everyone swaps half their hand for fresh cards, so a deck twice
  // the size of the starting hands lasts about four rounds.
  const deckSize = players * handSize * (opts.deckHands ?? 2);

  const dossier = buildDossier(rng, opts.agents ?? 8, opts.devices ?? 6);
  const solver = new Solver(dossier);
  const space = solver.space;

  // Pick the mole first so every suspect is equally likely, then one of the
  // routes, devices and hours that would have let them do it.
  const mole = Math.floor(rng() * dossier.agents.length);
  const options: number[] = [];
  space.base.forEach((i) => {
    if (space.agent[i] === mole) options.push(i);
  });
  if (!options.length) return null;
  const truth = pick(options, rng);
  const route = space.paths[space.path[truth]];
  const schedule = dossier.agents.map((a) =>
    a.id === mole ? route : space.paths[Math.floor(rng() * space.paths.length)]
  );
  const secret: Secret = { answer: space.answerAt(truth), schedule };

  // Measure every true statement against the dossier; keep the informative ones.
  const baseAnswers = space.countAnswers(space.base);
  const pool = trueClues(dossier, secret)
    .map((body) => ({ body, mask: solver.maskOf(body) }))
    .filter((c) => space.countAnswers(c.mask) < baseAnswers);

  // Draw clues until they pin the answer down, favouring the kinds that need
  // combining over the ones that name a suspect outright.
  const order = weightedOrder(pool, (c) => KIND_WEIGHT[weightKey(c.body)], rng);
  let set = space.base;
  const chosen: typeof pool = [];
  for (const c of order) {
    const next = set.and(c.mask);
    if (space.countAnswers(next) === space.countAnswers(set)) continue;
    chosen.push(c);
    set = next;
    if (space.countAnswers(set) === 1) break;
  }
  if (space.countAnswers(set) !== 1) return null;

  // Drop anything the rest already implies, so every clue in the core matters.
  for (const c of shuffle(chosen, rng)) {
    const rest = chosen.filter((x) => x !== c);
    if (space.countAnswers(intersect(space.base, rest)) === 1) chosen.splice(chosen.indexOf(c), 1);
  }

  const dealtSize = players * handSize + publicCount;
  const total = dealtSize + deckSize;
  if (chosen.length > total) return null;
  // Pad with further true clues. They can't break uniqueness; they do give
  // players overlapping, partly redundant intel, which makes trades a gamble,
  // and they mean a clue discarded out of circulation is rarely the only way
  // to learn what it said.
  for (const c of order) {
    if (chosen.length >= total) break;
    if (!chosen.includes(c)) chosen.push(c);
  }
  if (chosen.length < total) return null;

  for (let tries = 0; tries < 200; tries++) {
    const dealt = shuffle(chosen, rng);
    const pub = dealt.slice(0, publicCount);
    const hands = Array.from({ length: players }, (_, p) =>
      dealt.slice(publicCount + p * handSize, publicCount + (p + 1) * handSize)
    );
    const pubSet = intersect(space.base, pub);
    if (space.countAnswers(pubSet) < minAlone * 2) continue;
    const alone = hands.map((h) => space.countAnswers(intersect(pubSet, h)));
    if (alone.some((n) => n < minAlone)) continue;
    // Even out the hands: nobody should start with twice the intel of another.
    const bits = alone.map((n) => Math.log2(space.countAnswers(pubSet) / n));
    if (Math.max(...bits) > 2 * Math.min(...bits)) continue;
    if (players >= 4 && !pairsNeedHelp(space, pubSet, hands)) continue;
    // The starting hands alone mustn't already settle it: the deck should matter.
    if (space.countAnswers(intersect(pubSet, hands.flat())) < 2) continue;

    // Ids are assigned after shuffling so they say nothing about the clue.
    const clues = withIds(
      dealt.map((c) => c.body),
      dealt.map((c) => Math.log2(baseAnswers / space.countAnswers(c.mask)))
    );
    return {
      seed: Math.floor(rng() * 2 ** 31),
      dossier,
      secret,
      clues,
      publicClues: clues.slice(0, publicCount).map((c) => c.id),
      hands: hands.map((_, p) =>
        clues.slice(publicCount + p * handSize, publicCount + (p + 1) * handSize).map((c) => c.id)
      ),
      deck: clues.slice(dealtSize).map((c) => c.id),
    };
  }
  return null;
}

function pairsNeedHelp(
  space: Solver["space"],
  pubSet: Bitset,
  hands: { mask: Bitset }[][]
): boolean {
  for (let a = 0; a < hands.length; a++)
    for (let b = a + 1; b < hands.length; b++)
      if (space.countAnswers(intersect(pubSet, [...hands[a], ...hands[b]])) < 2) return false;
  return true;
}

function intersect(start: Bitset, clues: { mask: Bitset }[]): Bitset {
  let s = start;
  for (const c of clues) s = s.and(c.mask);
  return s;
}

type WeightKey = ClueBody["kind"] | "atTrue";

function weightKey(c: ClueBody): WeightKey {
  return c.kind === "at" && c.is ? "atTrue" : c.kind;
}

/** How readily each kind of clue is drawn into play. */
const KIND_WEIGHT: Record<WeightKey, number> = {
  atTrue: 4,
  at: 0.6,
  never: 4,
  moleTrait: 3,
  handoffFeature: 2,
  handoffHour: 1.5,
  notRoom: 1,
  notDevice: 1,
  notAgent: 0.4,
};

/** A random order in which heavier items tend to come first. */
function weightedOrder<T>(items: T[], weight: (t: T) => number, rng: Rng): T[] {
  return items
    .map((t) => ({ t, k: Math.log(rng() || Number.MIN_VALUE) / weight(t) }))
    .sort((a, b) => b.k - a.k)
    .map((x) => x.t);
}

/** Cast the suspects, open up the house and hide the devices. */
export function buildDossier(rng: Rng, agentCount: number, deviceCount: number): Dossier {
  const rooms: Room[] = ROOMS.map((r, id) => ({
    id,
    name: r.name,
    preposition: r.preposition ?? "in",
    features: r.features,
    adjacent: r.adjacent.map((n) => ROOMS.findIndex((x) => x.name === n)),
  }));

  for (let tries = 0; ; tries++) {
    if (tries > 1000) throw new Error("Could not cast a reception from this content.");
    const agents = castAgents(rng, agentCount);
    const templates = chooseDevices(rng, deviceCount);
    // A device only a single suspect (or nearly everyone) could use is either
    // a giveaway or no constraint at all.
    const fair = templates.every((t) => {
      if (t.requirement.kind !== "trait") return true;
      const req = t.requirement;
      const n = agents.filter((a) => req.values.includes(a.traits[req.trait])).length;
      return n >= 2 && n <= agentCount - 2;
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
    return { title: TITLE, traits: TRAITS, features: FEATURES, agents, rooms, devices, hours: HOURS };
  }
}

function castAgents(rng: Rng, n: number): Agent[] {
  for (;;) {
    const names = shuffle(AGENT_NAMES, rng).slice(0, n);
    const agents = names.map((name, id) => ({
      id,
      name,
      traits: Object.fromEntries(TRAITS.map((t) => [t.id, pick(t.values, rng).id])),
    }));
    // Every pair must differ in at least two ways, so no single trait clue
    // tells two suspects apart on its own.
    const distinct = agents.every((a, i) =>
      agents.slice(i + 1).every((b) => TRAITS.filter((t) => a.traits[t.id] !== b.traits[t.id]).length >= 2)
    );
    if (distinct) return agents;
  }
}

/** A mix of devices: some tied to the room, one to the clock, some to the courier. */
function chooseDevices(rng: Rng, n: number): DeviceTemplate[] {
  const byKind = (k: string) => shuffle(DEVICES.filter((d) => d.requirement.kind === k), rng);
  const hours = byKind("hours").slice(0, 1);
  const feature = byKind("feature");
  const trait = byKind("trait");
  const nFeature = Math.ceil((n - hours.length) / 2);
  return shuffle([...hours, ...feature.slice(0, nFeature), ...trait.slice(0, n - hours.length - nFeature)], rng);
}
