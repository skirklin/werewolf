import { GameError, type Seat } from "@party/core";
import type { Answer, Clue, Dossier, Forgery, Lead, Scenario, Secret } from "./types.js";
import { allLeads, leadKey, leadOfKey, sameLead } from "./clues.js";
import { sameAnswer } from "./solver.js";
import { PLANTS } from "./generate.js";
import { makeRng, pick } from "./rng.js";

/**
 * The game. Pure: `reduce` takes a state and returns a new one, so the same
 * rules run on the server for play on separate phones and in the browser for
 * practice.
 *
 * Every player is a guest, and one of them is the killer. The night is three
 * rounds of one turn each. A turn has two steps:
 *  1. Investigate a lead, drawing its top card (only you see what it says),
 *     or call an inquest, naming who, with what and where, for the table to
 *     vote on.
 *  2. Then, if you like, share: testify (put a card from your hand on the
 *     public record), or confer with someone (each of you shows the other one
 *     card).
 * The killer and the accomplice can tamper while they "investigate": bury
 * the lead's top card, or plant a forgery on it. Once a game the killer can
 * strike again; the body is found at the end of the round.
 *
 * At dawn the table votes who, then with what, then where. The innocents win
 * only if all three are right.
 *
 * Seeing a card puts it in your notebook for good; holding one is what lets
 * you show it. Your hand holds at most `HAND_LIMIT` cards; over that, you
 * testify or burn one.
 */

export const ROUNDS = 3;
export const HAND_LIMIT = 4;

export type Role = "innocent" | "killer" | "accomplice";

export interface GameConfig {
  /** Seat an accomplice. Defaults by player count. */
  accomplice?: boolean;
  /** Rounds before dawn. Defaults to `ROUNDS`. */
  rounds?: number;
}

export type { Seat };

/** Where a card entered play. Printed on the card, so anyone who sees it sees this. */
export type Origin =
  | { via: "memory"; who: string }
  | { via: "lead"; lead: Lead; by: string; round: number }
  | { via: "victim"; who: string; round: number };

/** How a particular player came to see a card. */
export type How =
  | { via: "dealt" }
  | { via: "drew"; round: number }
  | { via: "shown"; by: string; round: number }
  | { via: "record"; by: string; round: number };

/** Something only you learned: what a lead gave you. */
export interface Finding {
  lead: Lead;
  round: number;
  /** The card drawn, or null if the lead had nothing more. */
  clue: number | null;
  /** Whether the lead still had something left after this draw. */
  more: boolean;
}

export interface PlayerState {
  id: string;
  name: string;
  role: Role;
  hand: number[];
  /** Every card this player has seen, in the order they saw it. */
  known: number[];
  how: Record<number, How>;
  findings: Finding[];
  alive: boolean;
  inquestUsed: boolean;
}

export type Part = "agent" | "device" | "room";
export const PARTS: Part[] = ["agent", "device", "room"];

export type Phase =
  /** `step`: investigate (or call an inquest) first, then share (or pass). */
  | { kind: "turn"; active: number; step: "investigate" | "share" }
  /** The active player showed `card` to `with`, who now shows one back. */
  | { kind: "confer"; active: number; with: number; card: number }
  /** The active player is over the hand limit and must testify or burn. */
  | { kind: "trim"; active: number }
  /** The table is voting on the active player's accusation. */
  | { kind: "inquest"; active: number; answer: Answer }
  /** Dawn: the table votes on one part of the accusation. */
  | { kind: "vote"; part: Part; options: number[]; revote: boolean }
  | {
      kind: "over";
      /** caught: all three right. wrong: an accusation stood, but it was wrong. */
      result: "caught" | "wrong";
      by: "inquest" | "dawn";
      accusation: Partial<Answer>;
      winners: string[];
    };

export interface RecordEntry {
  clue: number;
  by: string;
  round: number;
}

export type LogEntry =
  | { t: "investigate"; who: string; lead: Lead }
  | { t: "confer"; who: string; with: string }
  | { t: "testify"; who: string; clue: number }
  | { t: "burn"; who: string }
  | { t: "inquest"; who: string; answer: Answer }
  | { t: "inquestFailed"; who: string; yes: number; no: number }
  | { t: "inquestPassed"; who: string; yes: number; no: number }
  | { t: "death"; who: string; round: number }
  | { t: "round"; round: number }
  | { t: "dawn" }
  /**
   * A dawn vote's outcome, with every option's count. `value` is null when a
   * tie sends it to a revote; a second tie is settled by the inspector.
   */
  | { t: "voted"; part: Part; value: number | null; tally: [number, number][]; revote: boolean; inspector: boolean };

/** What the killer and the accomplice did in secret. Revealed at the end. */
export type Tamper =
  | { how: "plant"; by: string; lead: Lead; clue: number; round: number }
  | { how: "bury"; by: string; lead: Lead; round: number };

export interface GameState {
  scenario: Scenario;
  config: GameConfig;
  players: PlayerState[];
  phase: Phase;
  /** Each lead's stack, top first. */
  stacks: Record<string, number[]>;
  /** Leads that exist. The second body joins once there is one. */
  leads: Lead[];
  origins: Record<number, Origin>;
  record: RecordEntry[];
  /** Forgeries already planted. */
  planted: number[];
  tampers: Tamper[];
  /** The killer's second strike: chosen in secret, carried out at round end. */
  strike: { target: number; round: number } | null;
  strikeDone: boolean;
  /** Per seat, for whatever the table is voting on: null until they've voted. */
  votes: (number | null)[];
  accusation: Partial<Answer>;
  round: number;
  /** Turns still to come this round. */
  turnsLeft: number;
  turnsTaken: number;
  log: LogEntry[];
}

export type Tampering = { how: "bury" } | { how: "plant"; clue: number };

export type Action =
  | { type: "investigate"; lead: string; tamper?: Tampering }
  | { type: "confer"; with: string; card: number }
  | { type: "show"; card: number }
  | { type: "testify"; card: number }
  | { type: "burn"; card: number }
  | { type: "inquest"; answer: Answer }
  /** Skip sharing this turn. */
  | { type: "pass" }
  /** On an inquest: 1 for yes, 0 for no. At dawn: the option voted for. */
  | { type: "vote"; value: number }
  | { type: "strike"; target: string };

export { GameError };

export function createGame(scenario: Scenario, seats: readonly Seat[], config: GameConfig): GameState {
  if (seats.length !== scenario.hands.length)
    throw new GameError(`This case was dealt for ${scenario.hands.length} players.`);
  const role = (i: number): Role =>
    i === scenario.killer ? "killer" : i === scenario.accomplice ? "accomplice" : "innocent";
  const origins: Record<number, Origin> = {};
  scenario.hands.forEach((h, i) => h.forEach((id) => (origins[id] = { via: "memory", who: seats[i].id })));
  return {
    scenario,
    config,
    players: seats.map((s, i) => ({
      id: s.id,
      name: s.name,
      role: role(i),
      hand: [...scenario.hands[i]],
      known: [...scenario.hands[i]],
      how: Object.fromEntries(scenario.hands[i].map((id) => [id, { via: "dealt" }])),
      findings: [],
      alive: true,
      inquestUsed: false,
    })),
    phase: { kind: "turn", active: 0, step: "investigate" },
    stacks: Object.fromEntries(allLeads(scenario.dossier).map((l) => [leadKey(l), [...(scenario.stacks[leadKey(l)] ?? [])]])),
    leads: allLeads(scenario.dossier),
    origins,
    record: [],
    planted: [],
    tampers: [],
    strike: null,
    strikeDone: false,
    votes: seats.map(() => null),
    accusation: {},
    round: 1,
    turnsLeft: seats.length,
    turnsTaken: 0,
    log: [],
  };
}

/** The forgeries a seat may plant: theirs, unplanted, while they have plants left. */
export function forgeriesFor(state: GameState, seat: number): { forgery: Forgery; planted: boolean }[] {
  const role = state.players[seat].role;
  if (role === "innocent") return [];
  return state.scenario.forgeries[role].map((f) => ({ forgery: f, planted: state.planted.includes(f.clue) }));
}

export function plantsLeft(state: GameState, seat: number): number {
  const role = state.players[seat].role;
  if (role === "innocent") return 0;
  const mine = new Set(state.scenario.forgeries[role].map((f) => f.clue));
  return PLANTS[role] - state.planted.filter((id) => mine.has(id)).length;
}

const living = (s: GameState) => s.players.flatMap((p, i) => (p.alive ? [i] : []));

/** Seats that owe a move right now. Several at once while the table votes. */
export function whoMustAct(state: GameState): number[] {
  const p = state.phase;
  if (p.kind === "turn" || p.kind === "trim") return [p.active];
  if (p.kind === "confer") return [p.with];
  if (p.kind === "inquest" || p.kind === "vote")
    return living(state).filter((i) => state.votes[i] === null);
  return [];
}

export function reduce(state: GameState, actorId: string, action: Action): GameState {
  const s = clone(state);
  const actor = s.players.findIndex((p) => p.id === actorId);
  if (actor < 0) throw new GameError("You are not in this game.");
  const me = s.players[actor];
  const phase = s.phase;
  const myTurn = phase.kind === "turn" && phase.active === actor;
  const step = (want: "investigate" | "share") => {
    if (!myTurn) throw new GameError("It isn't your turn.");
    if (phase.step !== want)
      throw new GameError(want === "investigate" ? "You've already investigated this turn." : "Investigate first.");
  };
  const card = (id: unknown) => {
    if (typeof id !== "number" || !me.hand.includes(id)) throw new GameError("That card isn't in your hand.");
    return id;
  };

  switch (action?.type) {
    case "investigate": {
      step("investigate");
      const lead = typeof action.lead === "string" ? leadOfKey(action.lead) : null;
      if (!lead || !s.leads.some((l) => sameLead(l, lead))) throw new GameError("There's no such lead.");
      const key = leadKey(lead);
      const stack = s.stacks[key];
      s.log.push({ t: "investigate", who: me.id, lead });
      const tamper = action.tamper;
      if (tamper) {
        if (me.role === "innocent") throw new GameError("Only the guilty tamper with evidence.");
        if (tamper.how === "bury") {
          // The top card goes to the bottom: the next person finds something else, or nothing.
          if (stack.length > 1) stack.push(stack.shift()!);
          s.tampers.push({ how: "bury", by: me.id, lead, round: s.round });
        } else if (tamper.how === "plant") {
          const f = forgeriesFor(s, actor).find((x) => x.forgery.clue === tamper.clue);
          if (!f || f.planted) throw new GameError("You can't plant that.");
          if (!sameLead(f.forgery.lead, lead)) throw new GameError("That forgery belongs with another lead.");
          if (plantsLeft(s, actor) <= 0) throw new GameError("You've no forgeries left to plant.");
          stack.unshift(f.forgery.clue);
          s.planted.push(f.forgery.clue);
          s.tampers.push({ how: "plant", by: me.id, lead, clue: f.forgery.clue, round: s.round });
        } else throw new GameError("Unknown tampering.");
        return toShare(s, actor);
      }
      const id = stack.shift();
      me.findings.push({ lead, round: s.round, clue: id ?? null, more: stack.length > 0 });
      if (id !== undefined) {
        s.origins[id] = { via: "lead", lead, by: me.id, round: s.round };
        me.hand.push(id);
        learn(me, id, { via: "drew", round: s.round });
      }
      return toShare(s, actor);
    }

    case "confer": {
      step("share");
      const other = s.players.findIndex((p) => p.id === action.with);
      if (other < 0 || other === actor || !s.players[other].alive) throw new GameError("Confer with someone else at the table.");
      const shown = card(action.card);
      s.log.push({ t: "confer", who: me.id, with: s.players[other].id });
      learn(s.players[other], shown, { via: "shown", by: me.id, round: s.round });
      if (!s.players[other].hand.length) return afterAction(s, actor);
      s.phase = { kind: "confer", active: actor, with: other, card: shown };
      return s;
    }

    case "show": {
      if (phase.kind !== "confer" || phase.with !== actor) throw new GameError("Nobody is waiting for you to show a card.");
      learn(s.players[phase.active], card(action.card), { via: "shown", by: me.id, round: s.round });
      return afterAction(s, phase.active);
    }

    case "testify": {
      const trimming = phase.kind === "trim" && phase.active === actor;
      if (!trimming) step("share");
      const id = card(action.card);
      me.hand = me.hand.filter((x) => x !== id);
      s.record.push({ clue: id, by: me.id, round: s.round });
      s.log.push({ t: "testify", who: me.id, clue: id });
      for (const p of s.players) learn(p, id, { via: "record", by: me.id, round: s.round });
      return trimming ? endTurn(s, actor) : afterAction(s, actor);
    }

    case "burn": {
      if (phase.kind !== "trim" || phase.active !== actor) throw new GameError("You can only burn a card to get back to the hand limit.");
      const id = card(action.card);
      me.hand = me.hand.filter((x) => x !== id);
      s.log.push({ t: "burn", who: me.id });
      return endTurn(s, actor);
    }

    case "pass": {
      step("share");
      return afterAction(s, actor);
    }

    case "inquest": {
      step("investigate");
      if (me.inquestUsed) throw new GameError("You've already called an inquest.");
      checkAnswer(s.scenario.dossier, action.answer);
      const answer = { agent: action.answer.agent, device: action.answer.device, room: action.answer.room };
      me.inquestUsed = true;
      s.log.push({ t: "inquest", who: me.id, answer });
      s.phase = { kind: "inquest", active: actor, answer };
      s.votes = s.players.map(() => null);
      return s;
    }

    case "vote": {
      if (phase.kind !== "inquest" && phase.kind !== "vote") throw new GameError("There's nothing to vote on.");
      if (!me.alive) throw new GameError("The dead don't vote.");
      if (s.votes[actor] !== null) throw new GameError("You've already voted.");
      const v = action.value;
      const ok = phase.kind === "inquest" ? v === 0 || v === 1 : phase.options.includes(v);
      if (!ok) throw new GameError("That isn't one of the choices.");
      s.votes[actor] = v;
      return phase.kind === "inquest" ? afterInquestVote(s) : afterDawnVote(s);
    }

    case "strike": {
      if (!myTurn) throw new GameError("It isn't your turn.");
      if (me.role !== "killer") throw new GameError("Only the killer can do that.");
      if (s.strike || s.strikeDone) throw new GameError("You can only strike once.");
      const target = s.players.findIndex((p) => p.id === action.target);
      if (target < 0 || target === actor || !s.players[target].alive) throw new GameError("Pick someone else at the table.");
      // Nothing public happens until the body is found at the end of the round.
      s.strike = { target, round: s.round };
      return s;
    }

    default:
      throw new GameError("Unsupported action.");
  }
}

/** On to the second step of the turn. */
function toShare(s: GameState, seat: number): GameState {
  s.phase = { kind: "turn", active: seat, step: "share" };
  return s;
}

/** After sharing: over the hand limit, testify or burn; otherwise the turn ends. */
function afterAction(s: GameState, seat: number): GameState {
  if (s.players[seat].hand.length > HAND_LIMIT) {
    s.phase = { kind: "trim", active: seat };
    return s;
  }
  return endTurn(s, seat);
}

function afterInquestVote(s: GameState): GameState {
  const p = s.phase;
  if (p.kind !== "inquest" || whoMustAct(s).length) return s;
  const cast = s.votes.filter((v): v is number => v !== null);
  const yes = cast.filter((v) => v === 1).length;
  const no = cast.length - yes;
  const who = s.players[p.active].id;
  s.votes = s.players.map(() => null);
  if (yes * 2 > living(s).length) {
    s.log.push({ t: "inquestPassed", who, yes, no });
    return finish(s, sameAnswer(p.answer, s.scenario.secret.answer) ? "caught" : "wrong", "inquest", p.answer);
  }
  s.log.push({ t: "inquestFailed", who, yes, no });
  return endTurn(s, p.active);
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
  // Still tied after the revote: the inspector picks between them, so a split
  // table can't stall the case (or hand it to the killer) on its own.
  const inspector = leaders.length > 1;
  const value = inspector
    ? pick(leaders.sort((a, b) => a - b), makeRng(s.scenario.seed + PARTS.indexOf(p.part)))
    : leaders[0];
  s.log.push({ t: "voted", part: p.part, value, tally: counts, revote: p.revote, inspector });
  s.accusation = { ...s.accusation, [p.part]: value };
  const next = PARTS[PARTS.indexOf(p.part) + 1];
  if (next) return startVote(s, next);
  const a = s.accusation as Answer;
  return finish(s, sameAnswer(a, s.scenario.secret.answer) ? "caught" : "wrong", "dawn", a);
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

function finish(s: GameState, result: "caught" | "wrong", by: "inquest" | "dawn", accusation: Partial<Answer>): GameState {
  const guilty = (p: PlayerState) => p.role !== "innocent";
  const winners = s.players.filter((p) => (result === "caught" ? !guilty(p) : guilty(p))).map((p) => p.id);
  s.phase = { kind: "over", result, by, accusation, winners };
  return s;
}

function learn(p: PlayerState, id: number, how: How) {
  if (p.known.includes(id)) return; // seen it already: no news
  p.known.push(id);
  p.how[id] = how;
}

/** The turn is over: on to the next living guest, the end of the round, or dawn. */
function endTurn(s: GameState, seat: number): GameState {
  s.turnsTaken++;
  s.turnsLeft--;
  s.votes = s.players.map(() => null);
  if (s.turnsLeft > 0) {
    s.phase = { kind: "turn", active: nextLiving(s, seat), step: "investigate" };
    return s;
  }
  // End of the round. A second body is found first, if there is one.
  if (s.strike) {
    const victim = s.players[s.strike.target];
    victim.alive = false;
    s.strikeDone = true;
    s.strike = null;
    s.log.push({ t: "death", who: victim.id, round: s.round });
    // What they were carrying is found on them, for everyone to read.
    for (const id of victim.hand) {
      s.origins[id] ??= { via: "victim", who: victim.id, round: s.round };
      s.record.push({ clue: id, by: victim.id, round: s.round });
      for (const p of s.players) learn(p, id, { via: "record", by: victim.id, round: s.round });
    }
    victim.hand = [];
    s.stacks.body2 = [...s.scenario.secondBody];
    s.leads.push({ kind: "body2" });
  }
  s.log.push({ t: "round", round: s.round });
  if (s.round >= (s.config.rounds ?? ROUNDS)) {
    s.log.push({ t: "dawn" });
    return startVote(s, "agent");
  }
  s.round++;
  s.turnsLeft = living(s).length;
  s.phase = { kind: "turn", active: nextLiving(s, seat), step: "investigate" };
  return s;
}

function nextLiving(s: GameState, seat: number): number {
  const n = s.players.length;
  for (let step = 1; step <= n; step++) {
    const i = (seat + step) % n;
    if (s.players[i].alive) return i;
  }
  return seat;
}

function checkAnswer(d: Dossier, a: Answer) {
  const inRange = (v: number, n: number) => Number.isInteger(v) && v >= 0 && v < n;
  if (!a || !inRange(a.agent, d.agents.length) || !inRange(a.device, d.devices.length) || !inRange(a.room, d.rooms.length))
    throw new GameError("Name a guest, a weapon and a room.");
}

function clone(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({
      ...p,
      hand: [...p.hand],
      known: [...p.known],
      how: { ...p.how },
      findings: [...p.findings],
    })),
    stacks: Object.fromEntries(Object.entries(s.stacks).map(([k, v]) => [k, [...v]])),
    leads: [...s.leads],
    origins: { ...s.origins },
    record: [...s.record],
    planted: [...s.planted],
    tampers: [...s.tampers],
    votes: [...s.votes],
    accusation: { ...s.accusation },
    log: [...s.log],
  };
}

/** What one player is allowed to see. */
export interface PlayerView {
  you: {
    id: string;
    seat: number;
    role: Role;
    alive: boolean;
    /** Ids of the cards in your hand. */
    hand: number[];
    /** Every card you've seen: what the notebook works from. */
    known: Clue[];
    how: Record<number, How>;
    findings: Finding[];
    inquestUsed: boolean;
  };
  /** Only for the killer and the accomplice. */
  guilty: {
    /** The killer sees the whole truth; the accomplice only who. */
    answer: Answer | null;
    killer: number;
    accomplice: number | null;
    /** What each forgery says, which lead it belongs with, and whether it's been planted. */
    forgeries: { forgery: Forgery; planted: boolean; card: Clue }[];
    plantsLeft: number;
    /** Killer only: whether the second strike is still to use, or who's marked. */
    canStrike: boolean;
    marked: string | null;
  } | null;
  dossier: Dossier;
  players: { id: string; name: string; handSize: number; alive: boolean; inquestUsed: boolean }[];
  leads: Lead[];
  /** Where each card you've seen came from. */
  origins: Record<number, Origin>;
  record: RecordEntry[];
  phase: Phase;
  round: number;
  rounds: number;
  handLimit: number;
  /** While the table votes: who has voted yet (never how). */
  voted: boolean[] | null;
  /** For a confer you're answering: the card you were shown. */
  shownYou: number | null;
  /** Your vote, once cast. */
  yourVote: number | null;
  accusation: Partial<Answer>;
  log: LogEntry[];
  turnsTaken: number;
  /** Everything, once it's over. */
  reveal: {
    secret: Secret;
    killer: number;
    accomplice: number | null;
    /** Every card that was planted, with what it said. */
    tampers: Tamper[];
    clues: Clue[];
    forged: number[];
  } | null;
}

/**
 * What a player knows from their role alone, as cards with negative ids that
 * never go into play: an innocent knows it wasn't them; the accomplice knows
 * who it was; the killer knows everything.
 */
export function selfKnowledge(view: PlayerView): Clue[] {
  const d = view.dossier;
  const others = (keep: number) =>
    d.agents.filter((a) => a.id !== keep).map((a, i): Clue => ({ kind: "notAgent", agent: a.id, id: -2 - i }));
  if (view.you.role === "innocent") return [{ kind: "notAgent", agent: view.you.seat, id: -1 }];
  const g = view.guilty!;
  if (!g.answer) return others(g.killer);
  return [
    ...others(g.killer),
    { kind: "isDevice", device: g.answer.device, id: -100 },
    { kind: "isRoom", room: g.answer.room, id: -101 },
  ];
}

export function projectView(state: GameState, playerId: string): PlayerView {
  const seat = state.players.findIndex((p) => p.id === playerId);
  if (seat < 0) throw new GameError("You are not in this game.");
  const me = state.players[seat];
  const sc = state.scenario;
  const phase = state.phase;
  const voting = phase.kind === "inquest" || phase.kind === "vote";
  const over = phase.kind === "over";
  return {
    you: {
      id: me.id,
      seat,
      role: me.role,
      alive: me.alive,
      hand: [...me.hand],
      known: me.known.map((id) => sc.clues[id]),
      how: { ...me.how },
      findings: [...me.findings],
      inquestUsed: me.inquestUsed,
    },
    guilty:
      me.role === "innocent"
        ? null
        : {
            answer: me.role === "killer" ? sc.secret.answer : null,
            killer: sc.killer,
            accomplice: me.role === "killer" ? sc.accomplice : seat,
            forgeries: forgeriesFor(state, seat).map((f) => ({ ...f, card: sc.clues[f.forgery.clue] })),
            plantsLeft: plantsLeft(state, seat),
            canStrike: me.role === "killer" && !state.strike && !state.strikeDone,
            marked: me.role === "killer" && state.strike ? state.players[state.strike.target].id : null,
          },
    dossier: sc.dossier,
    players: state.players.map((p) => ({
      id: p.id,
      name: p.name,
      handSize: p.hand.length,
      alive: p.alive,
      inquestUsed: p.inquestUsed,
    })),
    leads: [...state.leads],
    // A planted card's origin reads exactly like a real one's.
    origins: Object.fromEntries(me.known.filter((id) => state.origins[id]).map((id) => [id, state.origins[id]])),
    record: [...state.record],
    // Only the two conferring know which card was shown.
    phase: phase.kind === "confer" && seat !== phase.active && seat !== phase.with ? { ...phase, card: -1 } : phase,
    round: state.round,
    rounds: state.config.rounds ?? ROUNDS,
    handLimit: HAND_LIMIT,
    voted: voting ? state.votes.map((v, i) => v !== null || !state.players[i].alive) : null,
    shownYou: phase.kind === "confer" && phase.with === seat ? phase.card : null,
    yourVote: voting ? state.votes[seat] : null,
    accusation: { ...state.accusation },
    log: state.log,
    turnsTaken: state.turnsTaken,
    reveal: over
      ? {
          secret: sc.secret,
          killer: sc.killer,
          accomplice: sc.accomplice,
          tampers: state.tampers,
          clues: sc.clues,
          forged: sc.forged,
        }
      : null,
  };
}
