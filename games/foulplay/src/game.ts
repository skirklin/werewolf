import { GameError, type Seat } from "@party/core";
import type { Answer, Clue, Dossier, Scenario, Subject } from "./types.js";
import { isAbout, sameSubject } from "./clues.js";
import { sameAnswer } from "./solver.js";
import { makeRng, shuffle } from "./rng.js";

/**
 * The turn-based game. Pure: `reduce` takes a state and returns a new one, so
 * the same rules run on the server for multi-device play and in the browser
 * for practice.
 *
 * Clues are cards. Your hand is what you can trade; your notebook remembers
 * every clue you've ever seen, so passing a card on doesn't make you forget it.
 *
 * A round is one turn for each player still in the running. On your turn you
 * either ask the table about two subjects, or accuse.
 *  1. Everyone else, at once, offers any cards from their hand about either
 *     subject, or nothing. The table sees only how many points and cards each
 *     offered, never which subject they're about.
 *  2. The asker takes any offers they like, and pays each back with cards from
 *     their hand worth at least as many points; fewer cards is fine. A card
 *     they already had is fair game, if mean.
 * At the end of a round everyone discards half their hand, at once, and draws
 * replacements from the deck, so new intelligence keeps arriving while old
 * cards stay in circulation. Discards are shuffled into the bottom of the
 * deck: if they left play, a clue discarded before anyone else saw it would
 * be gone for good, and the case could become unsolvable for everyone.
 *
 *  - Competitive: first correct accusation wins; a wrong one puts you out of
 *    the running (you still offer and trade).
 *  - Co-op: the table shares one accusation and a turn limit.
 */

export type Mode = "competitive" | "coop";

/**
 * How much of the deduction the app does for players. A house rule, so the
 * host picks it and everyone plays with the same help:
 *  - notes: clues are filed; players cross things off themselves.
 *  - grid:  the full auto-filled grid, with reasons for every cross.
 */
export type Assist = "notes" | "grid";

export interface GameConfig {
  mode: Mode;
  /** Co-op only: turns the table has before the culprit gets away. */
  turnLimit?: number;
  /** Defaults to "grid". */
  assist?: Assist;
}

/**
 * Provisional until humans have played. Baseline bots asking at random need
 * about five turns each, so at this limit they win roughly half their co-op
 * games; people choosing their subjects should do better.
 */
export function defaultTurnLimit(players: number): number {
  return players * 5;
}

export type { Seat };

/** How a player came by a clue they weren't dealt at the start. */
export type Source =
  | {
      /** "offer": offered on your ask. "payback": paid to you for your offer. */
      via: "offer" | "payback";
      from: string;
      /** The subjects of the ask it changed hands on. */
      subjects: [Subject, Subject];
      /** `turnsTaken` when it changed hands. */
      turn: number;
    }
  | { via: "draw"; round: number; turn: number };

export interface PlayerState {
  id: string;
  name: string;
  /** Cards in hand: what this player can offer or pay with. */
  hand: number[];
  /** Every clue this player has seen, in the order they saw it. */
  known: number[];
  /** Where each clue they weren't dealt at the start came from. */
  sources: Record<number, Source>;
  /** Made a wrong accusation (competitive). */
  out: boolean;
}

export type Phase =
  | { kind: "turn"; active: number }
  /** The table is offering on the active player's two subjects. */
  | { kind: "offers"; active: number; subjects: [Subject, Subject] }
  /** The active player is choosing which offers to take, and paying them back. */
  | { kind: "choose"; active: number; subjects: [Subject, Subject] }
  /** End of a round: everyone discards half their hand. `next` takes the next turn. */
  | { kind: "discard"; next: number }
  | { kind: "over"; winners: string[]; reason: "solved" | "allOut" | "wrongAccusation" | "outOfTime" };

/** What everyone sees of an offer: its size, never its contents. */
export interface OfferSummary {
  who: string;
  cards: number;
  points: number;
}

export type LogEntry =
  | { t: "ask"; who: string; subjects: [Subject, Subject] }
  | { t: "offers"; offers: OfferSummary[] }
  /** `asker` took `with`'s offer and paid it back. */
  | {
      t: "deal";
      asker: string;
      with: string;
      gotCards: number;
      gotPoints: number;
      paidCards: number;
      paidPoints: number;
    }
  /** Offers were made but the asker took none. */
  | { t: "noDeal"; asker: string }
  | { t: "accuse"; who: string; answer: Answer; correct: boolean }
  /** A round ended: who drew how many replacements, and what's left in the deck. */
  | { t: "round"; round: number; drew: { who: string; cards: number }[]; deckLeft: number };

export interface GameState {
  scenario: Scenario;
  config: GameConfig;
  players: PlayerState[];
  phase: Phase;
  /** The draw pile, top first. */
  deck: number[];
  /** Per seat, for the current ask (offers) or round end (discards): null until they've moved. */
  pending: (number[] | null)[];
  /** 1-based. */
  round: number;
  /** Turns taken so far this round, and how many the round has. */
  roundTurns: number;
  roundLength: number;
  turnsTaken: number;
  log: LogEntry[];
}

export interface Deal {
  /** The player whose offer is taken. */
  from: string;
  /** Cards from the asker's hand paid back to them. */
  payback: number[];
}

export type Action =
  | { type: "ask"; subjects: [Subject, Subject] }
  | { type: "offer"; clueIds: number[] }
  | { type: "accept"; deals: Deal[] }
  | { type: "discard"; clueIds: number[] }
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
      hand: [...scenario.hands[i]],
      known: [...scenario.publicClues, ...scenario.hands[i]],
      sources: {},
      out: false,
    })),
    phase: { kind: "turn", active: 0 },
    deck: [...scenario.deck],
    pending: seats.map(() => null),
    round: 1,
    roundTurns: 0,
    roundLength: seats.length,
    turnsTaken: 0,
    log: [],
  };
}

export const pointsOf = (state: GameState, ids: readonly number[]) =>
  ids.reduce((sum, id) => sum + state.scenario.clues[id].points, 0);

/** The cards `seat` may offer on the current ask: any in hand about either subject. */
export function offerable(state: GameState, seat: number): number[] {
  const p = state.phase;
  if (p.kind !== "offers" || seat === p.active) return [];
  return state.players[seat].hand.filter((id) => p.subjects.some((s) => isAbout(state.scenario.clues[id], s)));
}

/** How many cards `seat` must discard at the end of this round. */
export function discardCount(state: GameState, seat: number): number {
  return Math.floor(state.players[seat].hand.length / 2);
}

/** Seats that owe a move right now. Several at once while the table offers or discards. */
export function whoMustAct(state: GameState): number[] {
  const p = state.phase;
  if (p.kind === "turn" || p.kind === "choose") return [p.active];
  if (p.kind === "offers") return state.pending.flatMap((o, i) => (o === null && i !== p.active ? [i] : []));
  if (p.kind === "discard") return state.pending.flatMap((o, i) => (o === null ? [i] : []));
  return [];
}

export function reduce(state: GameState, actorId: string, action: Action): GameState {
  const s = clone(state);
  const actor = s.players.findIndex((p) => p.id === actorId);
  if (actor < 0) throw new GameError("You are not in this game.");
  const phase = s.phase;

  switch (action?.type) {
    case "ask": {
      if (phase.kind !== "turn" || phase.active !== actor) throw new GameError("It isn't your turn to ask.");
      const subjects = action.subjects;
      if (!Array.isArray(subjects) || subjects.length !== 2) throw new GameError("Ask about two subjects.");
      for (const sub of subjects) checkSubject(s.scenario.dossier, sub);
      if (sameSubject(subjects[0], subjects[1])) throw new GameError("Pick two different subjects.");
      s.log.push({ t: "ask", who: s.players[actor].id, subjects: [subjects[0], subjects[1]] });
      s.phase = { kind: "offers", active: actor, subjects: [subjects[0], subjects[1]] };
      s.pending = s.players.map(() => null);
      // Anyone with nothing they could offer passes straight away.
      s.players.forEach((_, i) => {
        if (i !== actor && !offerable(s, i).length) s.pending[i] = [];
      });
      return afterOffer(s);
    }

    case "offer": {
      if (phase.kind !== "offers") throw new GameError("Nobody is asking right now.");
      if (actor === phase.active) throw new GameError("You can't offer on your own ask.");
      if (s.pending[actor] !== null) throw new GameError("You've already made your offer.");
      const ids = action.clueIds;
      if (!Array.isArray(ids)) throw new GameError("Offer a list of cards, or none.");
      const allowed = new Set(offerable(s, actor));
      if (new Set(ids).size !== ids.length || ids.some((id) => !allowed.has(id)))
        throw new GameError("You can only offer cards from your hand about the subjects asked for.");
      s.pending[actor] = [...ids];
      return afterOffer(s);
    }

    case "accept": {
      if (phase.kind !== "choose" || phase.active !== actor) throw new GameError("There are no offers for you to take.");
      const deals = action.deals;
      if (!Array.isArray(deals)) throw new GameError("Say which offers you're taking.");
      const me = s.players[actor];
      const seen = new Set<number>();
      const spent = new Set<number>();
      const plan = deals.map((d) => {
        const from = s.players.findIndex((p) => p.id === d?.from);
        const offer = from >= 0 ? s.pending[from] : null;
        if (from < 0 || from === actor || !offer?.length) throw new GameError("That player didn't offer anything.");
        if (seen.has(from)) throw new GameError("Take each offer once.");
        seen.add(from);
        const payback = d.payback;
        if (!Array.isArray(payback) || payback.some((id) => !me.hand.includes(id) || spent.has(id)))
          throw new GameError("Pay back with cards from your hand, each card once.");
        for (const id of payback) spent.add(id);
        if (pointsOf(s, payback) < pointsOf(s, offer))
          throw new GameError(`Pay ${s.players[from].name} back at least ${pointsOf(s, offer)} points.`);
        return { from, offer, payback };
      });
      // All checked against the hand the asker held before the trade; now swap the cards.
      const turn = s.turnsTaken;
      for (const { from, offer, payback } of plan) {
        const them = s.players[from];
        move(them, me, offer, { via: "offer", from: them.id, subjects: phase.subjects, turn });
        move(me, them, payback, { via: "payback", from: me.id, subjects: phase.subjects, turn });
        s.log.push({
          t: "deal",
          asker: me.id,
          with: them.id,
          gotCards: offer.length,
          gotPoints: pointsOf(s, offer),
          paidCards: payback.length,
          paidPoints: pointsOf(s, payback),
        });
      }
      if (!plan.length) s.log.push({ t: "noDeal", asker: me.id });
      return endTurn(s);
    }

    case "discard": {
      if (phase.kind !== "discard") throw new GameError("It isn't time to discard.");
      if (s.pending[actor] !== null) throw new GameError("You've already discarded.");
      const ids = action.clueIds;
      const hand = s.players[actor].hand;
      const need = discardCount(s, actor);
      if (!Array.isArray(ids) || new Set(ids).size !== ids.length || ids.some((id) => !hand.includes(id)))
        throw new GameError("Discard cards from your hand.");
      if (ids.length !== need) throw new GameError(`Discard exactly ${need} card${need === 1 ? "" : "s"}.`);
      s.pending[actor] = [...ids];
      return afterDiscard(s);
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

    default:
      throw new GameError("Unsupported action.");
  }
}

/** Once every offer is in, reveal their sizes and hand over to the asker (or move on). */
function afterOffer(s: GameState): GameState {
  const p = s.phase;
  if (p.kind !== "offers" || whoMustAct(s).length) return s;
  const offers = s.players.flatMap((pl, i) =>
    i === p.active ? [] : [{ who: pl.id, cards: s.pending[i]!.length, points: pointsOf(s, s.pending[i]!) }]
  );
  s.log.push({ t: "offers", offers });
  if (offers.every((o) => o.cards === 0)) return endTurn(s);
  s.phase = { kind: "choose", active: p.active, subjects: p.subjects };
  return s;
}

/** Once everyone has discarded, deal replacements around the table and start the next round. */
function afterDiscard(s: GameState): GameState {
  const p = s.phase;
  if (p.kind !== "discard" || whoMustAct(s).length) return s;
  const drew = s.players.map((pl, i) => {
    const gone = new Set(s.pending[i]!);
    pl.hand = pl.hand.filter((id) => !gone.has(id));
    return { who: pl.id, cards: 0, owed: gone.size };
  });
  // Deal one at a time around the table, so a short deck is shared fairly.
  for (let more = true; more && s.deck.length; ) {
    more = false;
    s.players.forEach((pl, i) => {
      if (drew[i].cards < drew[i].owed && s.deck.length) {
        const id = s.deck.shift()!;
        pl.hand.push(id);
        learn(pl, id, { via: "draw", round: s.round, turn: s.turnsTaken });
        drew[i].cards++;
        more = true;
      }
    });
  }
  // Back under the deck, in an order fixed by the seed so a game replays exactly.
  const discards = s.pending.flatMap((d) => d ?? []);
  s.deck.push(...shuffle(discards, makeRng(s.scenario.seed + s.round)));
  s.log.push({
    t: "round",
    round: s.round,
    drew: drew.map(({ who, cards }) => ({ who, cards })),
    deckLeft: s.deck.length,
  });
  return startRound(s, p.next);
}

function startRound(s: GameState, next: number): GameState {
  s.round++;
  s.roundTurns = 0;
  s.roundLength = s.players.filter((pl) => !pl.out).length;
  s.pending = s.players.map(() => null);
  s.phase = { kind: "turn", active: next };
  return s;
}

/** Move cards from one hand to another; the receiver learns them. */
function move(from: PlayerState, to: PlayerState, ids: number[], source: Source) {
  const set = new Set(ids);
  from.hand = from.hand.filter((id) => !set.has(id));
  for (const id of ids) {
    to.hand.push(id);
    learn(to, id, source);
  }
}

function learn(p: PlayerState, id: number, source: Source) {
  if (p.known.includes(id)) return; // they'd seen it already: no news
  p.known.push(id);
  p.sources[id] = source;
}

function endTurn(s: GameState): GameState {
  if (s.phase.kind === "over") return s;
  const active = "active" in s.phase ? s.phase.active : 0;
  s.pending = s.players.map(() => null);
  s.turnsTaken++;
  s.roundTurns++;
  if (s.config.mode === "coop" && s.config.turnLimit && s.turnsTaken >= s.config.turnLimit) {
    s.phase = { kind: "over", winners: [], reason: "outOfTime" };
    return s;
  }
  const n = s.players.length;
  let next = -1;
  for (let step = 1; step <= n; step++) {
    const i = (active + step) % n;
    if (!s.players[i].out) {
      next = i;
      break;
    }
  }
  if (next < 0) {
    s.phase = { kind: "over", winners: [], reason: "allOut" };
    return s;
  }
  if (s.roundTurns < s.roundLength) {
    s.phase = { kind: "turn", active: next };
    return s;
  }
  // End of the round. With nothing to draw (a deck dealt empty), skip the discard.
  if (!s.deck.length) return startRound(s, next);
  s.phase = { kind: "discard", next };
  s.players.forEach((_, i) => {
    if (discardCount(s, i) === 0) s.pending[i] = [];
  });
  return afterDiscard(s);
}

function checkSubject(d: Dossier, s: Subject) {
  const index = (n: number) => Number.isInteger(s.id) && (s.id as number) >= 0 && (s.id as number) < n;
  const ok =
    !!s &&
    ((s.kind === "agent" && index(d.agents.length)) ||
      (s.kind === "room" && index(d.rooms.length)) ||
      (s.kind === "device" && index(d.devices.length)) ||
      (s.kind === "trait" && d.traits.some((t) => t.id === s.id)) ||
      (s.kind === "feature" && d.features.some((f) => f.id === s.id)));
  if (!ok) throw new GameError("Unknown subject.");
}

function checkAnswer(d: Dossier, a: Answer) {
  const inRange = (v: number, n: number) => Number.isInteger(v) && v >= 0 && v < n;
  if (
    !a ||
    !inRange(a.agent, d.agents.length) ||
    !inRange(a.device, d.devices.length) ||
    !inRange(a.room, d.rooms.length)
  )
    throw new GameError("That accusation doesn't name a real suspect, device and room.");
}

function clone(s: GameState): GameState {
  return {
    ...s,
    players: s.players.map((p) => ({ ...p, hand: [...p.hand], known: [...p.known], sources: { ...p.sources } })),
    deck: [...s.deck],
    pending: s.pending.map((o) => (o ? [...o] : null)),
    log: [...s.log],
  };
}

/** What one player is allowed to see. The secret only appears once it's over. */
export interface PlayerView {
  you: {
    id: string;
    seat: number;
    /** Every clue you've seen: what the notebook works from. */
    known: Clue[];
    /** Ids of the cards in your hand. */
    hand: number[];
    sources: Record<number, Source>;
  };
  mode: Mode;
  dossier: Dossier;
  publicClues: number[];
  players: { id: string; name: string; handSize: number; out: boolean }[];
  phase: Phase;
  round: number;
  deckLeft: number;
  /** While the table offers or discards: who has moved yet (never what). */
  moved: boolean[] | null;
  /** When you owe an offer: the cards you may put in it. */
  canOffer: number[] | null;
  /** When you owe a discard: how many cards. */
  mustDiscard: number | null;
  /** Your own offer or discard for the current step, once made. */
  yours: number[] | null;
  /** For the asker choosing: each offer's size. */
  choices: { from: string; cards: number; points: number }[] | null;
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
  const gathering = phase.kind === "offers" || phase.kind === "discard";
  return {
    you: {
      id: me.id,
      seat,
      known: me.known.map((id) => state.scenario.clues[id]),
      hand: [...me.hand],
      sources: { ...me.sources },
    },
    mode: state.config.mode,
    dossier: state.scenario.dossier,
    publicClues: state.scenario.publicClues,
    players: state.players.map((p) => ({ id: p.id, name: p.name, handSize: p.hand.length, out: p.out })),
    phase,
    round: state.round,
    deckLeft: state.deck.length,
    moved: gathering
      ? state.pending.map((o, i) => (phase.kind === "offers" && i === phase.active) || o !== null)
      : null,
    canOffer:
      phase.kind === "offers" && seat !== phase.active && state.pending[seat] === null ? offerable(state, seat) : null,
    mustDiscard: phase.kind === "discard" && state.pending[seat] === null ? discardCount(state, seat) : null,
    yours: gathering || phase.kind === "choose" ? state.pending[seat] : null,
    choices:
      phase.kind === "choose" && phase.active === seat
        ? state.players.flatMap((p, i) => {
            const o = state.pending[i];
            return i === seat || !o?.length ? [] : [{ from: p.id, cards: o.length, points: pointsOf(state, o) }];
          })
        : null,
    log: state.log,
    turnsTaken: state.turnsTaken,
    turnLimit: state.config.turnLimit ?? null,
    assist: state.config.assist ?? "grid",
    answer: phase.kind === "over" ? state.scenario.secret.answer : null,
  };
}
