import type { Agent, ClueBody, Device, Dossier, Lead, Room, Scenario, Secret } from "./types.js";
import { CAST, DEVICES, FEATURES, ROOMS, THEME, TITLE, TRAITS, type DeviceTemplate } from "./content.js";
import { makeRng, pick, shuffle, type Rng } from "./rng.js";
import { holds, leadKey, possibleClues, trueClues } from "./clues.js";
import { Solver } from "./solver.js";
import type { Bitset, Space } from "./space.js";

export const MIN_PLAYERS = 4;
export const MAX_PLAYERS = CAST.length;

export interface GenerateOptions {
  seed: number;
  players: number;
  /** Seat an accomplice. Defaults to on at six or more players. */
  accomplice?: boolean;
  /** Memory cards each innocent starts with. */
  handSize?: number;
  /** Looks the body gives away, before any second body. */
  bodyTraits?: number;
  /** Chance that the staff of a room, or a guest's alibi, has anything to say. */
  witnessChance?: number;
  /** Weapons in play. */
  devices?: number;
}

export const defaultAccomplice = (players: number) => players >= 6;

/** How many forgeries each can plant, and how many they get to choose from. */
export const PLANTS = { killer: 2, accomplice: 1 };
const MENU = { killer: 4, accomplice: 2 };

/**
 * Build a case. The killer, weapon and room come first; the evidence is then
 * written to fit them, and laid out so the case is fair:
 *  - all the true evidence together names exactly one answer;
 *  - it does so without anything the killer or accomplice holds;
 *  - the innocents' starting memories alone don't come close;
 *  - every forgery contradicts the truth, so it can be caught.
 * Any attempt that misses is thrown away and dealt again.
 *
 * Each lead answers its own question, so a player picks where to look:
 *  - the body: the killer's looks, and what kind of room it happened in;
 *  - a room's staff: exactly who set foot there;
 *  - a guest's alibi: exactly where they went;
 *  - searching a room: whether it happened there, and whether a weapon kept
 *    there is missing.
 */
export function generateScenario(opts: GenerateOptions): Scenario {
  const players = opts.players;
  if (players < MIN_PLAYERS || players > MAX_PLAYERS)
    throw new Error(`Foul Play needs ${MIN_PLAYERS}–${MAX_PLAYERS} players.`);
  const rng = makeRng(opts.seed);
  for (let attempt = 0; attempt < 300; attempt++) {
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
  const handSize = opts.handSize ?? 3;
  const bodyTraits = opts.bodyTraits ?? 2;
  const witnessChance = opts.witnessChance ?? 0.75;
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

  // The body: a few of the killer's looks that tell guests apart, and one
  // thing about the room it happened in. Some are held back for a second body.
  const looks = shuffle(
    dossier.traits
      .map((t) => measure({ kind: "moleTrait", trait: t.id, value: culprit.traits[t.id], is: true }))
      .filter(informative),
    rng
  );
  if (looks.length < bodyTraits + 1) return null;
  const scene = dossier.rooms[answer.room];
  const roomSigns = shuffle(
    dossier.features.map((f) => measure({ kind: "handoffFeature", feature: f.id, is: scene.features.includes(f.id) })).filter(informative),
    rng
  );
  const body = [...looks.slice(0, bodyTraits), ...roomSigns.slice(0, 1)];
  const secondBody = looks.slice(bodyTraits, bodyTraits + 2);

  const stacks = new Map<string, Measured[]>();
  stacks.set("body", shuffle(body, rng));
  for (const r of dossier.rooms) {
    if (rng() < witnessChance) {
      const seen = dossier.agents.filter((a) => visits[a.id].includes(r.id)).map((a) => a.id);
      stacks.set(leadKey({ kind: "staff", room: r.id }), [measure({ kind: "visitors", room: r.id, agents: seen })]);
    }
    const found: Measured[] = [measure(r.id === answer.room ? { kind: "isRoom", room: r.id } : { kind: "notRoom", room: r.id })];
    for (const x of dossier.devices)
      if (x.location === r.id) found.push(measure(x.id === answer.device ? { kind: "isDevice", device: x.id } : { kind: "notDevice", device: x.id }));
    stacks.set(leadKey({ kind: "search", room: r.id }), found);
  }
  for (const a of dossier.agents)
    if (rng() < witnessChance)
      stacks.set(leadKey({ kind: "alibi", agent: a.id }), [measure({ kind: "whereabouts", agent: a.id, rooms: [...visits[a.id]] })]);

  // Memories are sightings: what each guest saw (or didn't) around the house.
  const sightings = shuffle(
    trueClues(dossier, secret)
      .filter((b) => b.kind === "visited" || b.kind === "never")
      .map(measure)
      .filter(informative),
    rng
  );
  const used = new Set<Measured>();
  const take = (n: number, ok: (c: Measured) => boolean = () => true) => {
    const out: Measured[] = [];
    for (const c of sightings) {
      if (out.length >= n) break;
      if (!used.has(c) && ok(c)) {
        out.push(c);
        used.add(c);
      }
    }
    return out.length === n ? out : null;
  };
  const hands: Measured[][] = Array.from({ length: players }, () => []);
  // The killer's and accomplice's memories don't name the killer: nothing
  // they'd never want to show.
  const harmless = (c: Measured) => !mentions(c.body, killer);
  const killerHand = take(2, harmless);
  if (!killerHand) return null;
  hands[killer] = killerHand;
  if (accomplice !== null) {
    const h = take(handSize, harmless);
    if (!h) return null;
    hands[accomplice] = h;
  }
  for (const seat of innocents) {
    const h = take(handSize);
    if (!h) return null;
    hands[seat] = h;
  }

  // Fairness: memories alone leave plenty open, and everything an innocent
  // could find names one answer.
  const innocentHands = innocents.flatMap((s) => hands[s]);
  if (space.countAnswers(intersect(space.base, innocentHands)) < 6) return null;
  const findable = [...innocentHands, ...[...stacks.values()].flat()];
  if (space.countAnswers(intersect(space.base, findable)) !== 1) return null;

  const forgeries = chooseForgeries(dossier, space, truth, secret, killer, accomplice, rng);
  if (!forgeries) return null;

  // Number the cards in a shuffled order, so an id says nothing about a card.
  const cards: { body: ClueBody; forged: boolean }[] = [];
  const idOf = new Map<Measured | ClueBody, number>();
  const all: (Measured | ClueBody)[] = shuffle(
    [
      ...hands.flat(),
      ...[...stacks.values()].flat(),
      ...secondBody,
      ...forgeries.killer.map((f) => f.body),
      ...forgeries.accomplice.map((f) => f.body),
    ],
    rng
  );
  for (const x of all) {
    idOf.set(x, cards.length);
    cards.push("mask" in x ? { body: x.body, forged: false } : { body: x, forged: true });
  }
  const ids = (xs: (Measured | ClueBody)[]) => xs.map((x) => idOf.get(x)!);

  return {
    seed: Math.floor(rng() * 2 ** 31),
    dossier,
    secret,
    killer,
    accomplice,
    clues: cards.map((c, id) => ({ ...c.body, id })),
    forged: cards.flatMap((c, id) => (c.forged ? [id] : [])),
    hands: hands.map((h) => ids(h)),
    stacks: Object.fromEntries([...stacks].map(([k, v]) => [k, ids(v)])),
    secondBody: ids(secondBody),
    forgeries: {
      killer: forgeries.killer.map((f) => ({ clue: idOf.get(f.body)!, lead: f.lead })),
      accomplice: forgeries.accomplice.map((f) => ({ clue: idOf.get(f.body)!, lead: f.lead })),
    },
  };
}

/** Does a statement name this guest? */
function mentions(c: ClueBody, agent: number): boolean {
  if (c.kind === "visited" || c.kind === "notAgent" || c.kind === "whereabouts") return c.agent === agent;
  if (c.kind === "visitors") return c.agents.includes(agent);
  return false;
}

type Draft = { body: ClueBody; lead: Lead };

/**
 * The forgers' menus. Each forgery is false, fits a particular lead, and
 * points away from the truth: a look the killer doesn't have, a room or a
 * weapon that's really not the one, the killer left off a list of who was
 * there. The accomplice only knows who the killer is, so theirs are about
 * the killer alone.
 */
function chooseForgeries(
  d: Dossier,
  space: Space,
  truth: number,
  secret: Secret,
  killer: number,
  accomplice: number | null,
  rng: Rng
): { killer: Draft[]; accomplice: Draft[] } | null {
  const { answer, visits } = secret;
  const killerAgent = d.agents[killer];
  const lies = possibleClues(d).filter((c) => !holds(space, c, truth));
  // A false look should still describe someone at the table, so it frames them.
  const looks = shuffle(
    lies.filter(
      (c) =>
        c.kind === "moleTrait" &&
        killerAgent.traits[c.trait] !== c.value &&
        d.agents.some((a) => a.id !== killer && a.traits[c.trait] === c.value)
    ),
    rng
  );
  const others = d.agents.filter((a) => a.id !== killer).map((a) => a.id);
  // The killer's evening, with the scene swapped for somewhere they weren't.
  const elsewhere = d.rooms.filter((r) => !visits[killer].includes(r.id)).map((r) => r.id);
  const falseEvening: Draft | null = elsewhere.length
    ? {
        body: {
          kind: "whereabouts",
          agent: killer,
          rooms: [...visits[killer].filter((r) => r !== answer.room), pick(elsewhere, rng)].sort((a, b) => a - b),
        },
        lead: { kind: "alibi", agent: killer },
      }
    : null;

  const accompliceMenu: Draft[] = [];
  if (accomplice !== null) {
    if (falseEvening) accompliceMenu.push(falseEvening);
    const look = looks.shift();
    if (look) accompliceMenu.push({ body: look, lead: { kind: "body" } });
    if (accompliceMenu.length < MENU.accomplice) return null;
  }

  const killerMenu: Draft[] = [];
  const look = looks.shift();
  if (look) killerMenu.push({ body: look, lead: { kind: "body" } });
  // The scene's visitors, with the killer swapped for someone who wasn't there.
  const seen = others.filter((a) => visits[a].includes(answer.room));
  const absent = others.filter((a) => !visits[a].includes(answer.room));
  killerMenu.push({
    body: { kind: "visitors", room: answer.room, agents: [...seen, ...(absent.length ? [pick(absent, rng)] : [])].sort((a, b) => a - b) },
    lead: { kind: "staff", room: answer.room },
  });
  killerMenu.push({ body: { kind: "notRoom", room: answer.room }, lead: { kind: "search", room: answer.room } });
  const decoy = pick(d.rooms.filter((r) => r.id !== answer.room), rng).id;
  killerMenu.push({ body: { kind: "isRoom", room: decoy }, lead: { kind: "search", room: decoy } });
  killerMenu.push({
    body: { kind: "notDevice", device: answer.device },
    lead: { kind: "search", room: d.devices[answer.device].location },
  });
  if (accomplice === null && falseEvening) killerMenu.push(falseEvening);
  const menu = shuffle(killerMenu, rng).slice(0, MENU.killer);
  if (menu.length < MENU.killer) return null;
  return { killer: menu, accomplice: accompliceMenu.slice(0, MENU.accomplice) };
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
