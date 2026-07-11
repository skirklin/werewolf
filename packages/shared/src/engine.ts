import type {
  GameState,
  Player,
  PlayerId,
  NightState,
  NightStep,
  Team,
  GameConfig,
} from "./types.js";
import { getRole } from "./roles.js";
import { dealRoles } from "./setup.js";
import { makeRng, shuffle } from "./rng.js";

// ---------------------------------------------------------------------------
// Queries (pure helpers, safe to use from client for view logic)
// ---------------------------------------------------------------------------

export function living(state: GameState): Player[] {
  return state.players.filter((p) => p.alive);
}

export function playerById(state: GameState, id: PlayerId): Player | undefined {
  return state.players.find((p) => p.id === id);
}

export function teamOf(state: GameState, id: PlayerId): Team | null {
  const p = playerById(state, id);
  if (!p || !p.roleId) return null;
  return getRole(p.roleId).team;
}

export function livingWerewolves(state: GameState): Player[] {
  return living(state).filter((p) => p.roleId && getRole(p.roleId).team === "werewolf");
}

/** Standard win check. Village: no wolves left. Wolves: reach parity. */
export function checkWinner(state: GameState): Team | null {
  const alive = living(state);
  const wolves = alive.filter((p) => p.roleId && getRole(p.roleId).team === "werewolf");
  if (wolves.length === 0) return "village";
  if (wolves.length * 2 >= alive.length) return "werewolf";
  return null;
}

/** Whether every actor in every night step has submitted a choice. */
export function allNightStepsDone(state: GameState): boolean {
  if (!state.night) return false;
  return state.night.steps.every((s) => s.done);
}

/** Valid targets for a given actor's night ability. */
export function validNightTargets(state: GameState, actorId: PlayerId): Player[] {
  const actor = playerById(state, actorId);
  if (!actor?.roleId) return [];
  const ability = getRole(actor.roleId).night;
  if (!ability) return [];
  return living(state).filter((t) => {
    if (t.id === actorId && !ability.canTargetSelf) return false;
    // Wolves never eat their own pack.
    if (ability.kind === "kill" && t.roleId && getRole(t.roleId).team === "werewolf")
      return false;
    return true;
  });
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { type: "startGame"; config: GameConfig }
  | { type: "startNight" }
  | { type: "nightChoice"; actorId: PlayerId; targetId: PlayerId }
  | { type: "endNight" }
  | { type: "startVote" }
  | { type: "castVote"; voterId: PlayerId; targetId: PlayerId | null }
  | { type: "resolveVote" };

export class EngineError extends Error {}

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new EngineError(msg);
}

/**
 * The authoritative reducer. Pure: given a state and action, returns the next
 * state (or throws EngineError for an illegal move). Shared verbatim by the
 * server (multi-device) and the browser (pass-the-device) so rules can't drift.
 */
export function reduce(state: GameState, action: Action): GameState {
  switch (action.type) {
    case "startGame":
      return startGame(state, action.config);
    case "startNight":
      assert(state.phase === "roleReveal", "Roles not being revealed.");
      return beginNight(state);
    case "nightChoice":
      return nightChoice(state, action.actorId, action.targetId);
    case "endNight":
      return endNight(state);
    case "startVote":
      return startVote(state);
    case "castVote":
      return castVote(state, action.voterId, action.targetId);
    case "resolveVote":
      return resolveVote(state);
  }
}

function startGame(state: GameState, config: GameConfig): GameState {
  assert(state.phase === "lobby", "Game already started.");
  const rng = makeRng(state.seed);
  const players = dealRoles(state.players, config, rng);
  return {
    ...state,
    config,
    players,
    phase: "roleReveal",
    round: 0,
    log: [{ type: "gameStart", round: 0 }],
  };
}

/** Build the ordered night steps from the living players' roles. */
function beginNight(state: GameState): GameState {
  const round = state.round + 1;
  const byRole = new Map<string, PlayerId[]>();
  for (const p of living(state)) {
    if (!p.roleId) continue;
    if (!getRole(p.roleId).night) continue;
    const list = byRole.get(p.roleId) ?? [];
    list.push(p.id);
    byRole.set(p.roleId, list);
  }
  const steps: NightStep[] = [];
  for (const [roleId, actorIds] of byRole) {
    const ability = getRole(roleId).night!;
    steps.push({
      roleId,
      kind: ability.kind,
      order: ability.order,
      group: !!ability.group,
      actorIds,
      choices: {},
      done: false,
    });
  }
  steps.sort((a, b) => a.order - b.order);
  const night: NightState = { steps };
  return {
    ...state,
    phase: "night",
    round,
    night,
    votes: {},
    log: [...state.log, { type: "night", round }],
  };
}

function nightChoice(state: GameState, actorId: PlayerId, targetId: PlayerId): GameState {
  assert(state.phase === "night" && state.night, "Not night.");
  const actor = playerById(state, actorId);
  assert(actor?.alive, "Actor is not alive.");
  assert(actor.roleId, "Actor has no role.");
  const step = state.night.steps.find((s) => s.actorIds.includes(actorId));
  assert(step, "You have no night action.");
  const targets = validNightTargets(state, actorId);
  assert(targets.some((t) => t.id === targetId), "Invalid target.");

  let inspects = state.inspects;
  if (step.kind === "inspect") {
    const target = playerById(state, targetId)!;
    const reveal = state.config.seerLearnsExactRole
      ? target.roleId!
      : getRole(target.roleId!).team === "werewolf"
        ? "werewolf"
        : "not-werewolf";
    inspects = [
      ...inspects,
      { round: state.round, seerId: actorId, targetId, reveal },
    ];
  }

  const choices = { ...step.choices, [actorId]: targetId };
  const done = step.actorIds.every((id) => id in choices);
  const steps = state.night.steps.map((s) =>
    s === step ? { ...s, choices, done } : s
  );
  return { ...state, inspects, night: { steps } };
}

/** Resolve one plurality winner among a step's choices, seeded tiebreak. */
function pluralityTarget(step: NightStep, rng: () => number): PlayerId | null {
  const votes = Object.values(step.choices);
  if (votes.length === 0) return null;
  const tally = new Map<PlayerId, number>();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);
  const max = Math.max(...tally.values());
  const top = shuffle([...tally.entries()].filter(([, c]) => c === max), rng);
  return top[0][0];
}

function endNight(state: GameState): GameState {
  assert(state.phase === "night" && state.night, "Not night.");
  const rng = makeRng(state.seed + state.round);

  const protectedIds = new Set<PlayerId>();
  for (const step of state.night.steps) {
    if (step.kind === "protect") {
      for (const t of Object.values(step.choices)) protectedIds.add(t);
    }
  }

  let victimId: PlayerId | null = null;
  for (const step of state.night.steps) {
    if (step.kind === "kill") victimId = pluralityTarget(step, rng);
  }

  const log = state.log.slice();
  let players = state.players;
  if (victimId && protectedIds.has(victimId)) {
    log.push({ type: "saved", round: state.round, playerId: victimId });
  } else if (victimId) {
    players = players.map((p) => (p.id === victimId ? { ...p, alive: false } : p));
    log.push({ type: "death", round: state.round, playerId: victimId, cause: "wolves" });
  } else {
    log.push({ type: "noDeath", round: state.round, cause: "wolves" });
  }

  const next: GameState = { ...state, players, night: null, log };
  const winner = checkWinner(next);
  if (winner) return finish(next, winner);
  return { ...next, phase: "dayDiscussion" };
}

function startVote(state: GameState): GameState {
  assert(state.phase === "dayDiscussion", "Not in day discussion.");
  return { ...state, phase: "dayVote", votes: {} };
}

function castVote(state: GameState, voterId: PlayerId, targetId: PlayerId | null): GameState {
  assert(state.phase === "dayVote", "Not voting.");
  const voter = playerById(state, voterId);
  assert(voter?.alive, "Dead players can't vote.");
  if (targetId !== null) {
    const target = playerById(state, targetId);
    assert(target?.alive, "Can't vote for a dead player.");
  }
  return { ...state, votes: { ...state.votes, [voterId]: targetId } };
}

/** True once every living player has cast (or skipped) a vote. */
export function allVotesIn(state: GameState): boolean {
  return living(state).every((p) => p.id in state.votes);
}

function resolveVote(state: GameState): GameState {
  assert(state.phase === "dayVote", "Not voting.");
  const tally = new Map<PlayerId, number>();
  for (const target of Object.values(state.votes)) {
    if (target === null) continue;
    tally.set(target, (tally.get(target) ?? 0) + 1);
  }

  const log = state.log.slice();
  let players = state.players;
  if (tally.size === 0) {
    log.push({ type: "noDeath", round: state.round, cause: "lynch" });
  } else {
    const max = Math.max(...tally.values());
    const top = [...tally.entries()].filter(([, c]) => c === max);
    if (top.length > 1) {
      // Tie: no one is lynched. (Deliberate rule — keeps stalls harmless.)
      log.push({ type: "voteTie", round: state.round });
    } else {
      const lynchedId = top[0][0];
      players = players.map((p) => (p.id === lynchedId ? { ...p, alive: false } : p));
      log.push({ type: "lynch", round: state.round, playerId: lynchedId });
    }
  }

  const next: GameState = { ...state, players, votes: {}, log };
  const winner = checkWinner(next);
  if (winner) return finish(next, winner);
  return beginNight(next);
}

function finish(state: GameState, winner: Team): GameState {
  return {
    ...state,
    phase: "gameOver",
    winner,
    night: null,
    log: [...state.log, { type: "gameOver", round: state.round, winner }],
  };
}

/** Create a fresh lobby game. */
export function createGame(code: string, seed: number): GameState {
  return {
    phase: "lobby",
    code,
    players: [],
    config: {
      selection: { mode: "exact", roleCounts: {} },
      revealRoleOnDeath: true,
      seerLearnsExactRole: false,
      nightSummary: "discreet",
    },
    round: 0,
    night: null,
    inspects: [],
    votes: {},
    log: [],
    seed,
    winner: null,
  };
}
