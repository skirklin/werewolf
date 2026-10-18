import { GameError, type Seat } from "@party/core";
import type { Answer, Clue, Dossier, Scenario, Secret } from "./types.js";
import { hallOf } from "./clues.js";
import { sameAnswer } from "./solver.js";
import { makeRng, pick } from "./rng.js";

/**
 * The game. Pure: `reduce` takes a state and returns a new one, so the same
 * rules run on the server for play on separate phones and in the browser for
 * practice. Every step is one player's, so it also works passing one device.
 *
 * Lord Ashcombe's body lies in the Hall and the evidence is scattered through
 * the house. One of the guests did it and knows where every piece is. The
 * house tells a story about every guest; only the killer's is true, and the
 * killer wins by getting someone else's to stick.
 *
 * A round is a turn for each living guest, then the night.
 *  - On your turn, move (stay, go to a room, or join another guest), then
 *    act: search the room, or keep watch. Then testify cards from your hand
 *    onto the public record, or quietly burn them. Anyone can burn: an
 *    innocent might, to get rid of what fits their own story.
 *  - Searching with anyone else in the room puts the find straight on the
 *    record. Searching alone puts it in your hand, unseen.
 *  - At night the killer can murder a guest who is alone, or destroy a card
 *    in an empty room.
 *  - Instead of moving, once a game, you can call the Reconstruction: name
 *    who, with what and where, and the table votes on it. If most agree,
 *    that's the verdict: right, and the innocents win; wrong, and the killer
 *    does. If not, play goes on.
 *
 * The game never ends just because the evidence adds up: someone has to see
 * it and convince the table. If nobody has by the last round, the table
 * votes at dawn. The killer also wins if the guilty come to outnumber the
 * innocents.
 */

export const MAX_ROUNDS = 6;

export type Role = "innocent" | "killer" | "accomplice";

export interface GameConfig {
  /** Seat an accomplice. Defaults by player count. */
  accomplice?: boolean;
  /** Rounds before the dawn vote. Defaults to `MAX_ROUNDS`. */
  rounds?: number;
  /** How many guests the killer can murder. Defaults to `MURDERS`. */
  murders?: number;
}

export const MURDERS = 1;

export type { Seat };

/** How a player came to see a card. */
export type How =
  | { via: "memory" }
  /** Found it searching alone. */
  | { via: "found"; round: number; place: number }
  /** Saw it found, or found it, with others watching: it went on the record. */
  | { via: "witnessed"; by: string; round: number; place: number }
  | { via: "record"; by: string; round: number };

export interface PlayerState {
  id: string;
  name: string;
  role: Role;
  alive: boolean;
  place: number;
  hand: number[];
  /** Every card this player has seen, in the order they saw it. */
  known: number[];
  how: Record<number, How>;
}

export type Part = "agent" | "device" | "room";
export const PARTS: Part[] = ["agent", "device", "room"];

export type Phase =
  /** `step`: move, then act, then wrap up (testify or burn what you hold) and end the turn. */
  | { kind: "turn"; active: number; step: "move" | "act" | "wrap" }
  /** Everyone alive taps through the night in seat order; only the killer's choice counts. */
  | { kind: "night"; active: number }
  /** The Reconstruction: `by` has named an answer, and everyone alive says yes or no. */
  | { kind: "trial"; by: number; answer: Answer }
  /** The fallback: the table votes on one part of the accusation. */
  | { kind: "vote"; part: Part; options: number[]; revote: boolean }
  | {
      kind: "over";
      /**
       * trial: the table accepted a Reconstruction. outnumbered: the guilty
       * are as many as the innocents. dawn: the fallback vote.
       */
      by: "trial" | "outnumbered" | "dawn";
      caught: boolean;
      accusation: Partial<Answer>;
      winners: string[];
    };

/** Where the card came from, as everyone who sees it sees it. */
export interface RecordEntry {
  clue: number;
  /** Who put it on the record, and how. */
  by: string;
  how: "witnessed" | "testified" | "body";
  place: number | null;
  round: number;
}

export type LogEntry =
  | { t: "move"; who: string; to: number; joined: string | null }
  | { t: "search"; who: string; place: number; found: "public" | "private" | "nothing" }
  | { t: "watch"; who: string; place: number }
  | { t: "testify"; who: string; clue: number }
  | { t: "night"; round: number }
  | { t: "murder"; who: string; place: number }
  | { t: "quiet" }
  | { t: "dawn" }
  | { t: "accuse"; who: string; answer: Answer }
  /** How the table voted on a Reconstruction. Votes are open. */
  | { t: "verdict"; who: string; answer: Answer; yes: string[]; no: string[]; accepted: boolean }
  | { t: "voted"; part: Part; value: number | null; tally: [number, number][]; revote: boolean; inspector: boolean };

/** What the guilty did in secret, revealed at the end. */
export type Secretly =
  | { what: "burn"; who: string; clue: number; round: number }
  | { what: "nightDestroy"; clue: number; place: number; round: number };

export interface GameState {
  scenario: Scenario;
  config: GameConfig;
  players: PlayerState[];
  phase: Phase;
  /** The evidence still in each place, top first. */
  stacks: number[][];
  record: RecordEntry[];
  /** Spare evidence still to leave on a body. */
  spare: number[];
  secretly: Secretly[];
  /** The killer's choice for this night, made in turn, carried out at dawn. */
  nightPlan: NightPlan | null;
  votes: (number | null)[];
  /** Yes or no on the Reconstruction in progress. */
  verdicts: (boolean | null)[];
  /** Who has used their one Reconstruction. */
  called: boolean[];
  accusation: Partial<Answer>;
  round: number;
  turnsTaken: number;
  log: LogEntry[];
}

export type NightPlan = { murder: string } | { destroy: number } | { rest: true };

export type Action =
  | { type: "move"; to: number }
  | { type: "join"; who: string }
  | { type: "stay" }
  | { type: "search" }
  | { type: "watch" }
  /** Finish your turn, after acting. */
  | { type: "end" }
  | { type: "testify"; card: number }
  | { type: "burn"; card: number }
  /** Night: the killer picks; everyone else just goes to sleep. */
  | { type: "night"; plan?: NightPlan }
  | { type: "vote"; value: number }
  /** Instead of moving: call the Reconstruction, naming the whole answer. */
  | { type: "accuse"; answer: Answer }
  /** Agree with the Reconstruction, or not. */
  | { type: "verdict"; agree: boolean };

export { GameError };

export function createGame(scenario: Scenario, seats: readonly Seat[], config: GameConfig): GameState {
  if (seats.length !== scenario.memories.length)
    throw new GameError(`This case was dealt for ${scenario.memories.length} players.`);
  const role = (i: number): Role =>
    i === scenario.killer ? "killer" : i === scenario.accomplice ? "accomplice" : "innocent";
  const hall = hallOf(scenario.dossier);
  return {
    scenario,
    config,
    players: seats.map((s, i) => ({
      id: s.id,
      name: s.name,
      role: role(i),
      alive: true,
      place: hall,
      hand: [...scenario.memories[i]],
      known: [...scenario.memories[i]],
      how: Object.fromEntries(scenario.memories[i].map((id) => [id, { via: "memory" }])),
    })),
    phase: { kind: "turn", active: 0, step: "move" },
    stacks: scenario.stacks.map((s) => [...s]),
    record: [],
    spare: [...scenario.spare],
    secretly: [],
    nightPlan: null,
    votes: seats.map(() => null),
    verdicts: seats.map(() => null),
    called: seats.map(() => false),
    accusation: {},
    round: 1,
    turnsTaken: 0,
    log: [],
  };
}

const guilty = (p: PlayerState) => p.role !== "innocent";
const living = (s: GameState) => s.players.flatMap((p, i) => (p.alive ? [i] : []));

export function murdersLeft(s: GameState): number {
  return (s.config.murders ?? MURDERS) - s.log.filter((e) => e.t === "murder").length;
}

/** Who else (living) is in a place. */
export function occupants(s: GameState, place: number): number[] {
  return s.players.flatMap((p, i) => (p.alive && p.place === place ? [i] : []));
}

/** Is this guest alone, as far as a murderer is concerned: nobody with them but the guilty? */
export function isAlone(s: GameState, seat: number): boolean {
  return occupants(s, s.players[seat].place).every((i) => i === seat || guilty(s.players[i]));
}

/**
 * Is anyone else there to see what `seat` finds? Anyone at all counts: if
 * only innocents did, a find staying private would give away who's guilty.
 */
function watched(s: GameState, seat: number): boolean {
  return occupants(s, s.players[seat].place).some((i) => i !== seat);
}

/** Seats that owe a move right now. Several at once only while the table votes. */
export function whoMustAct(state: GameState): number[] {
  const p = state.phase;
  if (p.kind === "turn" || p.kind === "night") return [p.active];
  if (p.kind === "vote") return living(state).filter((i) => state.votes[i] === null);
  if (p.kind === "trial") return living(state).filter((i) => state.verdicts[i] === null);
  return [];
}

export function reduce(state: GameState, actorId: string, action: Action): GameState {
  const s = clone(state);
  const actor = s.players.findIndex((p) => p.id === actorId);
  if (actor < 0) throw new GameError("You are not in this game.");
  const me = s.players[actor];
  const phase = s.phase;
  const myTurn = phase.kind === "turn" && phase.active === actor;
  const step = (want: "move" | "act" | "wrap") => {
    if (!myTurn) throw new GameError("It isn't your turn.");
    if (phase.step !== want)
      throw new GameError(
        want === "move" ? "You've already moved this turn." : want === "act" ? (phase.step === "move" ? "Move first." : "You've already acted this turn.") : "Act first."
      );
  };
  const places = s.scenario.dossier.rooms.length + 1;

  switch (action?.type) {
    case "move": {
      step("move");
      if (!Number.isInteger(action.to) || action.to < 0 || action.to >= places) throw new GameError("There's no such room.");
      me.place = action.to;
      s.log.push({ t: "move", who: me.id, to: me.place, joined: null });
      s.phase = { kind: "turn", active: actor, step: "act" };
      return s;
    }
    case "join": {
      step("move");
      const other = s.players.findIndex((p) => p.id === action.who);
      if (other < 0 || other === actor || !s.players[other].alive) throw new GameError("Join someone else at the party.");
      me.place = s.players[other].place;
      s.log.push({ t: "move", who: me.id, to: me.place, joined: s.players[other].id });
      s.phase = { kind: "turn", active: actor, step: "act" };
      return s;
    }
    case "stay": {
      step("move");
      s.log.push({ t: "move", who: me.id, to: me.place, joined: null });
      s.phase = { kind: "turn", active: actor, step: "act" };
      return s;
    }

    case "search": {
      step("act");
      const stack = s.stacks[me.place];
      const id = stack.shift();
      if (id === undefined) {
        s.log.push({ t: "search", who: me.id, place: me.place, found: "nothing" });
        return wrapUp(s, actor);
      }
      if (watched(s, actor)) {
        // Found in company: everyone there saw it, so it's on the record.
        s.log.push({ t: "search", who: me.id, place: me.place, found: "public" });
        putOnRecord(s, id, me.id, "witnessed", me.place);
      } else {
        s.log.push({ t: "search", who: me.id, place: me.place, found: "private" });
        me.hand.push(id);
        learn(me, id, { via: "found", round: s.round, place: me.place });
      }
      return wrapUp(s, actor);
    }
    case "watch": {
      step("act");
      s.log.push({ t: "watch", who: me.id, place: me.place });
      return wrapUp(s, actor);
    }
    case "end": {
      step("wrap");
      return endTurn(s, actor);
    }

    case "testify": {
      if (!myTurn) throw new GameError("You can testify on your turn.");
      const id = action.card;
      if (!me.hand.includes(id)) throw new GameError("That card isn't in your hand.");
      me.hand = me.hand.filter((x) => x !== id);
      s.log.push({ t: "testify", who: me.id, clue: id });
      putOnRecord(s, id, me.id, "testified", null);
      return settle(s);
    }
    case "burn": {
      if (!myTurn) throw new GameError("You can only do that on your turn.");
      const id = action.card;
      if (!me.hand.includes(id)) throw new GameError("That card isn't in your hand.");
      me.hand = me.hand.filter((x) => x !== id);
      // Nothing public happens: it's simply gone.
      s.secretly.push({ what: "burn", who: me.id, clue: id, round: s.round });
      return s;
    }

    case "accuse": {
      step("move");
      if (s.called[actor]) throw new GameError("You've already called the Reconstruction once.");
      const answer = checkAnswer(s, action.answer);
      s.called[actor] = true;
      s.log.push({ t: "accuse", who: me.id, answer });
      s.verdicts = s.players.map((_, i) => (i === actor ? true : null));
      s.phase = { kind: "trial", by: actor, answer };
      return afterVerdict(s);
    }
    case "verdict": {
      if (phase.kind !== "trial") throw new GameError("There's nothing to agree to.");
      if (!me.alive) throw new GameError("The dead don't vote.");
      if (s.verdicts[actor] !== null) throw new GameError("You've already said.");
      if (typeof action.agree !== "boolean") throw new GameError("Yes or no?");
      s.verdicts[actor] = action.agree;
      return afterVerdict(s);
    }

    case "night": {
      if (phase.kind !== "night" || phase.active !== actor) throw new GameError("It isn't your turn in the dark.");
      if (me.role === "killer" && action.plan) {
        const plan = action.plan;
        if ("murder" in plan) {
          const victim = s.players.findIndex((p) => p.id === plan.murder);
          if (victim < 0 || !s.players[victim].alive || guilty(s.players[victim]))
            throw new GameError("Pick one of the innocent guests.");
          if (!isAlone(s, victim)) throw new GameError("They aren't alone.");
          if (murdersLeft(s) <= 0) throw new GameError("You can't risk another.");
        } else if ("destroy" in plan) {
          if (!Number.isInteger(plan.destroy) || plan.destroy < 0 || plan.destroy >= places)
            throw new GameError("There's no such room.");
          if (occupants(s, plan.destroy).length) throw new GameError("Someone is in there.");
          if (!s.stacks[plan.destroy].length) throw new GameError("There's nothing left there.");
        }
        s.nightPlan = plan;
      }
      return nextSleeper(s, actor);
    }

    case "vote": {
      if (phase.kind !== "vote") throw new GameError("There's nothing to vote on.");
      if (!me.alive) throw new GameError("The dead don't vote.");
      if (s.votes[actor] !== null) throw new GameError("You've already voted.");
      if (!phase.options.includes(action.value)) throw new GameError("That isn't one of the choices.");
      s.votes[actor] = action.value;
      return afterDawnVote(s);
    }

    default:
      throw new GameError("Unsupported action.");
  }
}

function putOnRecord(s: GameState, id: number, by: string, how: RecordEntry["how"], place: number | null) {
  s.record.push({ clue: id, by, how, place, round: s.round });
  for (const p of s.players) learn(p, id, { via: "record", by, round: s.round });
}

function learn(p: PlayerState, id: number, how: How) {
  if (p.known.includes(id)) return; // seen it already: no news
  p.known.push(id);
  p.how[id] = how;
}

/** A whole answer, with a living guest: what a Reconstruction has to name. */
function checkAnswer(s: GameState, a: Answer | undefined): Answer {
  const d = s.scenario.dossier;
  const ok = (v: unknown, n: number) => Number.isInteger(v) && (v as number) >= 0 && (v as number) < n;
  if (!a || !ok(a.agent, d.agents.length) || !ok(a.device, d.devices.length) || !ok(a.room, d.rooms.length))
    throw new GameError("Name who, with what, and where.");
  if (!s.players[a.agent].alive) throw new GameError("The dead can't be arrested.");
  return { agent: a.agent, device: a.device, room: a.room };
}

/** Once everyone alive has said: a majority makes it the verdict; otherwise play goes on. */
function afterVerdict(s: GameState): GameState {
  const p = s.phase;
  if (p.kind !== "trial" || whoMustAct(s).length) return s;
  const said = (v: boolean) => s.players.filter((x, i) => x.alive && s.verdicts[i] === v).map((x) => x.id);
  const yes = said(true);
  const no = said(false);
  const accepted = yes.length > (yes.length + no.length) / 2;
  s.log.push({ t: "verdict", who: s.players[p.by].id, answer: p.answer, yes, no, accepted });
  s.verdicts = s.players.map(() => null);
  if (accepted) return finish(s, "trial", sameAnswer(p.answer, s.scenario.secret.answer), p.answer);
  // Calling it took the turn.
  return endTurn(s, p.by);
}

/** Check whether anyone has won. Called after anything that could change it. */
function settle(s: GameState): GameState {
  if (s.phase.kind === "over") return s;
  const alive = s.players.filter((p) => p.alive);
  if (alive.filter(guilty).length >= alive.filter((p) => !guilty(p)).length) return finish(s, "outnumbered", false, {});
  return s;
}

/** Acted: the turn stays yours to testify or burn what you hold, then end it. */
function wrapUp(s: GameState, seat: number): GameState {
  s.phase = { kind: "turn", active: seat, step: "wrap" };
  return settle(s);
}

/** The turn is over: on to the next living guest, or the night. */
function endTurn(s: GameState, seat: number): GameState {
  s.turnsTaken++;
  if (settle(s).phase.kind === "over") return s;
  const next = nextLiving(s, seat);
  if (next !== null) {
    s.phase = { kind: "turn", active: next, step: "move" };
    return s;
  }
  // Everyone has had a turn. After the last round, the inspector won't wait.
  if (s.round >= (s.config.rounds ?? MAX_ROUNDS)) {
    s.log.push({ t: "dawn" });
    return startVote(s, "agent");
  }
  s.log.push({ t: "night", round: s.round });
  s.nightPlan = null;
  s.phase = { kind: "night", active: living(s)[0] };
  return s;
}

/** The next living seat after `seat` this round, or null once everyone has gone. */
function nextLiving(s: GameState, seat: number): number | null {
  for (let i = seat + 1; i < s.players.length; i++) if (s.players[i].alive) return i;
  return null;
}

/** Pass the device to the next sleeper; once everyone has, the morning comes. */
function nextSleeper(s: GameState, seat: number): GameState {
  const next = nextLiving(s, seat);
  if (next !== null) {
    s.phase = { kind: "night", active: next };
    return s;
  }
  return morning(s);
}

function morning(s: GameState): GameState {
  const plan = s.nightPlan;
  s.nightPlan = null;
  if (plan && "murder" in plan) {
    const victim = s.players.find((p) => p.id === plan.murder)!;
    victim.alive = false;
    s.log.push({ t: "murder", who: victim.id, place: victim.place });
    // What they carried stays with them, and the body says something new.
    const evidence = [...(s.spare.length ? [s.spare.shift()!] : []), ...victim.hand];
    victim.hand = [];
    s.stacks[victim.place] = [...evidence, ...s.stacks[victim.place]];
  } else if (plan && "destroy" in plan) {
    const id = s.stacks[plan.destroy].shift();
    if (id !== undefined) s.secretly.push({ what: "nightDestroy", clue: id, place: plan.destroy, round: s.round });
    s.log.push({ t: "quiet" });
  } else s.log.push({ t: "quiet" });
  s.round++;
  if (settle(s).phase.kind === "over") return s;
  s.phase = { kind: "turn", active: living(s)[0], step: "move" };
  return s;
}

function afterDawnVote(s: GameState): GameState {
  const p = s.phase;
  if (p.kind !== "vote" || whoMustAct(s).length) return s;
  const tally = new Map<number, number>();
  for (const v of s.votes) if (v !== null) tally.set(v, (tally.get(v) ?? 0) + 1);
  const top = Math.max(...tally.values());
  const leaders = [...tally].filter(([, n]) => n === top).map(([v]) => v);
  const counts = [...tally].sort((a, b) => b[1] - a[1] || a[0] - b[0]);
  s.votes = s.players.map(() => null);
  if (leaders.length > 1 && !p.revote) {
    s.log.push({ t: "voted", part: p.part, value: null, tally: counts, revote: false, inspector: false });
    s.phase = { kind: "vote", part: p.part, options: leaders.sort((a, b) => a - b), revote: true };
    return s;
  }
  // Still tied: the inspector picks between them.
  const inspector = leaders.length > 1;
  const value = inspector
    ? pick(leaders.sort((a, b) => a - b), makeRng(s.scenario.seed + PARTS.indexOf(p.part)))
    : leaders[0];
  s.log.push({ t: "voted", part: p.part, value, tally: counts, revote: p.revote, inspector });
  s.accusation = { ...s.accusation, [p.part]: value };
  const next = PARTS[PARTS.indexOf(p.part) + 1];
  if (next) return startVote(s, next);
  const a = s.accusation as Answer;
  return finish(s, "dawn", sameAnswer(a, s.scenario.secret.answer), a);
}

function startVote(s: GameState, part: Part): GameState {
  const d = s.scenario.dossier;
  const options =
    part === "agent"
      ? d.agents.filter((a) => s.players[a.id].alive).map((a) => a.id)
      : part === "device"
        ? d.devices.map((x) => x.id)
        : d.rooms.map((r) => r.id);
  s.votes = s.players.map(() => null);
  s.phase = { kind: "vote", part, options, revote: false };
  return s;
}

function finish(s: GameState, by: "trial" | "outnumbered" | "dawn", caught: boolean, accusation: Partial<Answer>): GameState {
  const winners = s.players.filter((p) => (caught ? !guilty(p) : guilty(p))).map((p) => p.id);
  s.phase = { kind: "over", by, caught, accusation, winners };
  return s;
}

function clone(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, hand: [...p.hand], known: [...p.known], how: { ...p.how } })),
    stacks: s.stacks.map((x) => [...x]),
    record: [...s.record],
    spare: [...s.spare],
    secretly: [...s.secretly],
    votes: [...s.votes],
    verdicts: [...s.verdicts],
    called: [...s.called],
    accusation: { ...s.accusation },
    log: [...s.log],
  };
}

/**
 * What a player knows from their role alone, as cards with negative ids that
 * never go into play: an innocent knows it wasn't them, and nobody suspects
 * the dead; the guilty know everything.
 */
export function selfKnowledge(view: PlayerView): Clue[] {
  const d = view.dossier;
  const others = (keep: number) =>
    d.agents.filter((a) => a.id !== keep).map((a, i): Clue => ({ kind: "notAgent", agent: a.id, id: -2 - i }));
  // The dead didn't do it: the killer never dies.
  const dead = view.players.flatMap((p, i): Clue[] => (p.alive ? [] : [{ kind: "notAgent", agent: i, id: -300 - i }]));
  if (view.you.role === "innocent") return [{ kind: "notAgent", agent: view.you.seat, id: -1 }, ...dead];
  const g = view.guilty!;
  return [
    ...others(g.killer),
    { kind: "isDevice", device: g.answer.device, id: -100 },
    { kind: "isRoom", room: g.answer.room, id: -101 },
  ];
}

/** What one player is allowed to see. */
export interface PlayerView {
  you: {
    id: string;
    seat: number;
    role: Role;
    alive: boolean;
    hand: number[];
    /** Every card you've seen. */
    known: Clue[];
    how: Record<number, How>;
    /** The story the house tells about you. The killer's is the truth. */
    story: Answer;
    /** The rooms you went into this evening. */
    evening: number[];
    /** Whether you've used your Reconstruction. */
    called: boolean;
  };
  /** Only for the killer and the accomplice. */
  guilty: {
    answer: Answer;
    killer: number;
    accomplice: number | null;
    /** Everyone's story and evening: who could be framed, and with what. */
    stories: Answer[];
    evenings: number[][];
    /** The killer sees what's left in every room, top first. */
    stacks: Clue[][] | null;
  } | null;
  dossier: Dossier;
  players: { id: string; name: string; alive: boolean; place: number }[];
  /** How many cards are left in each place: public. */
  counts: number[];
  record: RecordEntry[];
  phase: Phase;
  round: number;
  rounds: number;
  /** While the table votes, at dawn or on a Reconstruction: who has voted yet (never how, until it's done). */
  voted: boolean[] | null;
  /** Your yes or no on the Reconstruction in progress. */
  yourVerdict: boolean | null;
  /** Who has used their Reconstruction. */
  called: boolean[];
  yourVote: number | null;
  accusation: Partial<Answer>;
  log: LogEntry[];
  turnsTaken: number;
  /** For the killer at night: who is alone, and which rooms are empty with something in them. */
  night: { alone: string[]; emptyRooms: number[] } | null;
  /** Everything, once it's over. */
  reveal: { secret: Secret; killer: number; accomplice: number | null; stories: Answer[]; secretly: Secretly[]; clues: Clue[] } | null;
}

export function projectView(state: GameState, playerId: string): PlayerView {
  const seat = state.players.findIndex((p) => p.id === playerId);
  if (seat < 0) throw new GameError("You are not in this game.");
  const me = state.players[seat];
  const sc = state.scenario;
  const phase = state.phase;
  const clue = (id: number) => sc.clues[id];
  const killersNight = phase.kind === "night" && phase.active === seat && me.role === "killer";
  return {
    you: {
      id: me.id,
      seat,
      role: me.role,
      alive: me.alive,
      hand: [...me.hand],
      known: me.known.map(clue),
      how: { ...me.how },
      story: sc.stories[seat],
      evening: [...sc.secret.visits[seat]],
      called: state.called[seat],
    },
    guilty:
      me.role === "innocent"
        ? null
        : {
            answer: sc.secret.answer,
            killer: sc.killer,
            accomplice: sc.accomplice,
            stories: sc.stories,
            evenings: sc.secret.visits,
            stacks: me.role === "killer" ? state.stacks.map((st) => st.map(clue)) : null,
          },
    dossier: sc.dossier,
    players: state.players.map((p) => ({ id: p.id, name: p.name, alive: p.alive, place: p.place })),
    counts: state.stacks.map((st) => st.length),
    record: [...state.record],
    phase,
    round: state.round,
    rounds: state.config.rounds ?? MAX_ROUNDS,
    voted:
      phase.kind === "vote"
        ? state.votes.map((v, i) => v !== null || !state.players[i].alive)
        : phase.kind === "trial"
          ? state.verdicts.map((v, i) => v !== null || !state.players[i].alive)
          : null,
    yourVote: phase.kind === "vote" ? state.votes[seat] : null,
    yourVerdict: phase.kind === "trial" ? state.verdicts[seat] : null,
    called: [...state.called],
    accusation: { ...state.accusation },
    log: state.log,
    turnsTaken: state.turnsTaken,
    night: killersNight
      ? {
          alone:
            murdersLeft(state) > 0
              ? state.players.filter((p, i) => p.alive && !guilty(p) && isAlone(state, i)).map((p) => p.id)
              : [],
          emptyRooms: state.stacks.flatMap((st, place) => (st.length && !occupants(state, place).length ? [place] : [])),
        }
      : null,
    reveal:
      phase.kind === "over"
        ? { secret: sc.secret, killer: sc.killer, accomplice: sc.accomplice, stories: sc.stories, secretly: state.secretly, clues: sc.clues }
        : null,
  };
}
