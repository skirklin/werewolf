import { GameError, type Seat } from "@party/core";
import type { Answer, Clue, Dossier, Scenario, Subject } from "./types.js";
import { categoryOf, isAbout, isInCategory } from "./clues.js";
import { sameAnswer } from "./solver.js";

/**
 * The turn-based game. Pure: `reduce` takes a state and returns a new one, so
 * the same rules can run on a server for multi-device play or in the browser
 * for pass-the-device.
 *
 * On your turn you either ask someone about a subject, or accuse.
 *  - Asked about a subject, a player must hand over a clue about it that the
 *    asker doesn't already have — their choice which. Holding nothing on that
 *    exact subject, they must give something from the same category (people,
 *    places, times, devices) instead, and everyone sees that they did.
 *  - Competitive: whoever handed something over may then ask the asker back.
 *    First correct accusation wins; a wrong one puts you out of the running
 *    (you still answer questions).
 *  - Co-op: no asking back. The table shares one accusation and a turn limit.
 */

export type Mode = "competitive" | "coop";

/**
 * How much of the deduction the app does for players. A house rule, so the
 * host picks it and everyone plays with the same help:
 *  - notes: clues are filed; players cross things off themselves.
 *  - gauge: also shows how many answers remain, but not which.
 *  - grid:  the full auto-filled grid, with reasons for every cross.
 */
export type Assist = "notes" | "gauge" | "grid";

export interface GameConfig {
  mode: Mode;
  /** Co-op only: turns the table has before the handler gets away. */
  turnLimit?: number;
  /** Defaults to "grid". */
  assist?: Assist;
}

/**
 * Provisional: baseline bots that ask at random need roughly 12 turns each,
 * so this assumes people who think about who to ask do a good deal better.
 * Tune it once humans have played.
 */
export function defaultTurnLimit(players: number): number {
  return players * 5;
}

export type { Seat };

export interface PlayerState {
  id: string;
  name: string;
  /** Clue ids this player holds, in the order they learned them. */
  known: number[];
  /** Made a wrong accusation (competitive). */
  out: boolean;
}

export type Phase =
  | { kind: "turn"; active: number }
  /** `from` must hand `to` a clue about `subject`. */
  | { kind: "answer"; active: number; from: number; to: number; subject: Subject; counter: boolean }
  /** `by` just answered the active player and may ask them something back. */
  | { kind: "counter"; active: number; by: number }
  | { kind: "over"; winners: string[]; reason: "solved" | "allOut" | "wrongAccusation" | "outOfTime" };

export type LogEntry =
  | { t: "ask"; from: string; to: string; subject: Subject }
  /** `fallback`: nothing on the exact subject, so something from its category. */
  | { t: "gave"; from: string; to: string; subject: Subject; fallback: boolean }
  | { t: "nothing"; from: string; to: string; subject: Subject }
  | { t: "declined"; who: string }
  | { t: "accuse"; who: string; answer: Answer; correct: boolean };

export interface GameState {
  scenario: Scenario;
  config: GameConfig;
  players: PlayerState[];
  phase: Phase;
  turnsTaken: number;
  log: LogEntry[];
}

export type Action =
  | { type: "ask"; target: string; subject: Subject }
  | { type: "give"; clueId: number }
  | { type: "decline" }
  | { type: "accuse"; answer: Answer };

export { GameError };

export function createGame(scenario: Scenario, seats: readonly Seat[], config: GameConfig): GameState {
  if (seats.length !== scenario.hands.length)
    throw new GameError(`This scenario was dealt for ${scenario.hands.length} players.`);
  return {
    scenario,
    config:
      config.mode === "coop" ? { ...config, turnLimit: config.turnLimit ?? defaultTurnLimit(seats.length) } : config,
    players: seats.map((s, i) => ({
      id: s.id,
      name: s.name,
      known: [...scenario.publicClues, ...scenario.hands[i]],
      out: false,
    })),
    phase: { kind: "turn", active: 0 },
    turnsTaken: 0,
    log: [],
  };
}

export interface GiveOptions {
  ids: number[];
  /** True when nothing matched the exact subject and these are from its category. */
  fallback: boolean;
}

/** The seat whose move it is (asking, answering or asking back), or null once it's over. */
export function whoActs(state: GameState): number | null {
  const p = state.phase;
  if (p.kind === "turn") return p.active;
  if (p.kind === "answer") return p.from;
  if (p.kind === "counter") return p.by;
  return null;
}

/** Clues `from` could hand `to` when asked about `subject`. */
export function eligibleClues(state: GameState, from: number, to: number, subject: Subject): GiveOptions {
  const theirs = new Set(state.players[to].known);
  const fresh = state.players[from].known.filter((id) => !theirs.has(id));
  const clue = (id: number) => state.scenario.clues[id];
  const exact = fresh.filter((id) => isAbout(clue(id), subject));
  if (exact.length) return { ids: exact, fallback: false };
  const category = categoryOf(subject);
  return { ids: fresh.filter((id) => isInCategory(clue(id), category)), fallback: true };
}

export function reduce(state: GameState, actorId: string, action: Action): GameState {
  const s = clone(state);
  const actor = s.players.findIndex((p) => p.id === actorId);
  if (actor < 0) throw new GameError("You are not in this game.");
  const phase = s.phase;

  switch (action.type) {
    case "ask": {
      const target = s.players.findIndex((p) => p.id === action.target);
      if (target < 0 || target === actor) throw new GameError("Ask someone else.");
      checkSubject(s.scenario.dossier, action.subject);
      if (phase.kind === "turn") {
        if (phase.active !== actor) throw new GameError("It isn't your turn.");
        return ask(s, phase.active, actor, target, action.subject, false);
      }
      if (phase.kind === "counter") {
        if (phase.by !== actor) throw new GameError("It isn't your turn to ask.");
        if (target !== phase.active) throw new GameError("You may only ask the player who asked you.");
        return ask(s, phase.active, actor, target, action.subject, true);
      }
      throw new GameError("You can't ask anything right now.");
    }

    case "give": {
      if (phase.kind !== "answer" || phase.from !== actor) throw new GameError("Nobody is waiting on you.");
      const options = eligibleClues(s, actor, phase.to, phase.subject);
      if (!options.ids.includes(action.clueId)) throw new GameError("That clue doesn't answer the question.");
      s.players[phase.to].known.push(action.clueId);
      s.log.push({
        t: "gave",
        from: s.players[actor].id,
        to: s.players[phase.to].id,
        subject: phase.subject,
        fallback: options.fallback,
      });
      // In a competitive game the answerer gets to ask back, once.
      if (s.config.mode === "competitive" && !phase.counter) {
        s.phase = { kind: "counter", active: phase.active, by: actor };
        return s;
      }
      return endTurn(s);
    }

    case "decline": {
      if (phase.kind !== "counter" || phase.by !== actor) throw new GameError("There is nothing to decline.");
      s.log.push({ t: "declined", who: s.players[actor].id });
      return endTurn(s);
    }

    case "accuse": {
      if (phase.kind !== "turn" || phase.active !== actor) throw new GameError("You can only accuse on your turn.");
      checkAnswer(s.scenario.dossier, action.answer);
      const correct = sameAnswer(action.answer, s.scenario.secret.answer);
      s.log.push({ t: "accuse", who: s.players[actor].id, answer: action.answer, correct });
      if (correct) {
        const winners = s.config.mode === "coop" ? s.players.map((p) => p.id) : [s.players[actor].id];
        s.phase = { kind: "over", winners, reason: "solved" };
        return s;
      }
      if (s.config.mode === "coop") {
        s.phase = { kind: "over", winners: [], reason: "wrongAccusation" };
        return s;
      }
      s.players[actor].out = true;
      return endTurn(s);
    }
  }
}

function ask(s: GameState, active: number, from: number, to: number, subject: Subject, counter: boolean): GameState {
  const asker = s.players[from].id;
  const asked = s.players[to].id;
  s.log.push({ t: "ask", from: asker, to: asked, subject });
  // Someone with nothing to give says so straight away; that's public too.
  if (!eligibleClues(s, to, from, subject).ids.length) {
    s.log.push({ t: "nothing", from: asked, to: asker, subject });
    return endTurn(s);
  }
  s.phase = { kind: "answer", active, from: to, to: from, subject, counter };
  return s;
}

function endTurn(s: GameState): GameState {
  if (s.phase.kind === "over") return s;
  const active = "active" in s.phase ? s.phase.active : 0;
  s.turnsTaken++;
  if (s.config.mode === "coop" && s.config.turnLimit && s.turnsTaken >= s.config.turnLimit) {
    s.phase = { kind: "over", winners: [], reason: "outOfTime" };
    return s;
  }
  const n = s.players.length;
  for (let step = 1; step <= n; step++) {
    const next = (active + step) % n;
    if (!s.players[next].out) {
      s.phase = { kind: "turn", active: next };
      return s;
    }
  }
  s.phase = { kind: "over", winners: [], reason: "allOut" };
  return s;
}

function checkSubject(d: Dossier, s: Subject) {
  const ok =
    !!s &&
    (s.kind === "agent" && Number.isInteger(s.id) && s.id >= 0 && s.id < d.agents.length) ||
    (s.kind === "room" && Number.isInteger(s.id) && s.id >= 0 && s.id < d.rooms.length) ||
    (s.kind === "device" && Number.isInteger(s.id) && s.id >= 0 && s.id < d.devices.length) ||
    (s.kind === "hour" && Number.isInteger(s.id) && s.id >= 0 && s.id < d.hours.length) ||
    (s.kind === "trait" && d.traits.some((t) => t.id === s.id)) ||
    (s.kind === "feature" && d.features.some((f) => f.id === s.id));
  if (!ok) throw new GameError("Unknown subject.");
}

function checkAnswer(d: Dossier, a: Answer) {
  const inRange = (v: number, n: number) => Number.isInteger(v) && v >= 0 && v < n;
  if (
    !a ||
    !inRange(a.agent, d.agents.length) ||
    !inRange(a.device, d.devices.length) ||
    !inRange(a.room, d.rooms.length) ||
    !inRange(a.hour, d.hours.length)
  )
    throw new GameError("That accusation doesn't name a real suspect, device, room and hour.");
}

function clone(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, known: [...p.known] })),
    log: [...s.log],
  };
}

/** What one player is allowed to see. The secret only appears once it's over. */
export interface PlayerView {
  you: { id: string; seat: number; known: Clue[] };
  mode: Mode;
  dossier: Dossier;
  publicClues: number[];
  players: { id: string; name: string; knownCount: number; out: boolean }[];
  phase: Phase;
  /** When someone is waiting on you: the clues you may hand over. */
  mustGive: GiveOptions | null;
  log: LogEntry[];
  turnsTaken: number;
  turnLimit: number | null;
  assist: Assist;
  answer: Answer | null;
}

export function projectView(state: GameState, playerId: string): PlayerView {
  const seat = state.players.findIndex((p) => p.id === playerId);
  if (seat < 0) throw new GameError("You are not in this game.");
  const me = state.players[seat];
  const phase = state.phase;
  return {
    you: { id: me.id, seat, known: me.known.map((id) => state.scenario.clues[id]) },
    mode: state.config.mode,
    dossier: state.scenario.dossier,
    publicClues: state.scenario.publicClues,
    players: state.players.map((p) => ({ id: p.id, name: p.name, knownCount: p.known.length, out: p.out })),
    phase,
    mustGive:
      phase.kind === "answer" && phase.from === seat ? eligibleClues(state, seat, phase.to, phase.subject) : null,
    log: state.log,
    turnsTaken: state.turnsTaken,
    turnLimit: state.config.turnLimit ?? null,
    assist: state.config.assist ?? "grid",
    answer: phase.kind === "over" ? state.scenario.secret.answer : null,
  };
}

export interface Provenance {
  source: "public" | "hand" | "received";
  /** For received clues: the trade it came from. */
  from?: Extract<LogEntry, { t: "gave" }>;
}

/**
 * Where each of a player's clues came from. Clues they were handed arrive in
 * the same order as the public "gave … to them" entries, so the log can be
 * matched up without the server ever saying which clue changed hands.
 */
export function provenance(view: PlayerView): Map<number, Provenance> {
  const out = new Map<number, Provenance>();
  const gifts = view.log.filter(
    (e): e is Extract<LogEntry, { t: "gave" }> => e.t === "gave" && e.to === view.you.id
  );
  const dealt = view.you.known.length - gifts.length;
  const pub = new Set(view.publicClues);
  view.you.known.forEach((c, i) => {
    if (i >= dealt) out.set(c.id, { source: "received", from: gifts[i - dealt] });
    else out.set(c.id, { source: pub.has(c.id) ? "public" : "hand" });
  });
  return out;
}
