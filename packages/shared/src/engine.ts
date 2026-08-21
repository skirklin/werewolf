import type {
  GameState,
  Player,
  PlayerId,
  NightState,
  NightStep,
  NightSubmission,
  NightActionKind,
  Team,
  GameConfig,
} from "./types.js";
import { getRole, mimicableRoleIds } from "./roles.js";
import { dealRoles } from "./setup.js";
import { makeRng, shuffle, pick, nextSeed } from "./rng.js";

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

/** True if this player is the Drunk (secretly impersonating another role). */
export function isDrunk(state: GameState, id: PlayerId): boolean {
  return playerById(state, id)?.roleId === "drunk";
}

/**
 * Night-action kinds the Drunk is known to handle safely. Effect kinds are
 * nullified automatically (a Drunk's submissions are stripped in endNight);
 * info kinds are fabricated (see nightChoice / detectAction). A role flagged
 * `drunkMimicable` MUST use a kind in this set (a test enforces it), and its
 * prompt/view must not expose real info — which is why the Witch, whose prompt
 * shows the wolves' actual victim, is intentionally not mimicable.
 */
export const DRUNK_MIMIC_KINDS: NightActionKind[] = [
  "inspect",
  "protect",
  "silence",
  "swap",
  "detect",
  "raise",
];

/** The role a player ACTS AS: their Drunk disguise if any, else their real role. */
export function effectiveRoleId(state: GameState, id: PlayerId): string | null {
  const disguise = state.drunkDisguise[id];
  if (disguise) return disguise;
  return playerById(state, id)?.roleId ?? null;
}

/** Whether a role counts as a real werewolf for win math + the aura read. */
export function isWolfForWin(roleId: string): boolean {
  const role = getRole(roleId);
  return role.countsAsWolf ?? role.team === "werewolf";
}

export function livingWerewolves(state: GameState): Player[] {
  return living(state).filter((p) => p.roleId && isWolfForWin(p.roleId));
}

/**
 * Standard win check. Village: no real wolves left (a wolf-aligned Henchman
 * doesn't keep the wolves alive). Wolves: real wolves reach parity.
 */
export function checkWinner(state: GameState): Team | null {
  const alive = living(state);
  const wolves = alive.filter((p) => p.roleId && isWolfForWin(p.roleId));
  if (wolves.length === 0) return "village";
  if (wolves.length * 2 >= alive.length) return "werewolf";
  return null;
}

/** Whether every actor in every night step has submitted a choice. */
export function allNightStepsDone(state: GameState): boolean {
  if (!state.night) return false;
  return state.night.steps.every((s) => s.done);
}

/** Valid targets for a given actor's (effective, possibly disguised) night ability. */
export function validNightTargets(state: GameState, actorId: PlayerId): Player[] {
  const roleId = effectiveRoleId(state, actorId);
  if (!playerById(state, actorId)?.alive || !roleId) return [];
  const ability = getRole(roleId).night;
  if (!ability) return [];
  const targets = living(state).filter((t) => {
    if (t.id === actorId && !ability.canTargetSelf) return false;
    // Wolves never eat their own pack; the Infector only turns non-wolves.
    if (
      (ability.kind === "kill" || ability.kind === "convert") &&
      t.roleId &&
      getRole(t.roleId).team === "werewolf"
    )
      return false;
    return true;
  });
  // No shielding the same patient two nights running — unless that would leave
  // the protector nobody at all to pick, which would wedge the night.
  if (ability.kind === "protect") {
    const fresh = targets.filter((t) => t.id !== state.lastProtect[actorId]);
    if (fresh.length) return fresh;
  }
  return targets;
}

// ---------------------------------------------------------------------------
// Actions
// ---------------------------------------------------------------------------

export type Action =
  | { type: "startGame"; config: GameConfig }
  | { type: "startNight" }
  | { type: "nightChoice"; actorId: PlayerId; targetId: PlayerId }
  | { type: "witchAction"; actorId: PlayerId; save: boolean; poisonTargetId: PlayerId | null }
  | { type: "swapAction"; actorId: PlayerId; aId: PlayerId; bId: PlayerId }
  | { type: "detectAction"; actorId: PlayerId; aId: PlayerId; bId: PlayerId }
  | { type: "raiseAction"; actorId: PlayerId; targetId: PlayerId | null }
  | { type: "endNight" }
  | { type: "startVote" }
  | { type: "castVote"; voterId: PlayerId; targetId: PlayerId | null }
  | { type: "resolveVote" }
  | { type: "shoot"; hunterId: PlayerId; targetId: PlayerId }
  | { type: "skipShot" }
  | { type: "playAgain" };

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
    case "witchAction":
      return witchAction(state, action.actorId, action.save, action.poisonTargetId);
    case "swapAction":
      return swapAction(state, action.actorId, action.aId, action.bId);
    case "detectAction":
      return detectAction(state, action.actorId, action.aId, action.bId);
    case "raiseAction":
      return raiseAction(state, action.actorId, action.targetId);
    case "endNight":
      return endNight(state);
    case "startVote":
      return startVote(state);
    case "castVote":
      return castVote(state, action.voterId, action.targetId);
    case "resolveVote":
      return resolveVote(state);
    case "shoot":
      return shoot(state, action.hunterId, action.targetId);
    case "skipShot":
      return skipShot(state);
    case "playAgain":
      return playAgain(state);
  }
}

/**
 * Rematch: drop the finished game but keep the room, its players and their
 * setup, so a group on separate devices never re-enters the code. Players whose
 * device has gone are left behind (the lobby drops them anyway).
 */
function playAgain(state: GameState): GameState {
  assert(state.phase === "gameOver", "The game isn't over yet.");
  const players = state.players
    .filter((p) => p.connected)
    .map((p) => ({ ...p, roleId: null, alive: true }));
  assert(players.length > 0, "Nobody's still here to play.");
  if (!players.some((p) => p.isHost)) players[0] = { ...players[0], isHost: true };
  return { ...createGame(state.code, nextSeed(state.seed)), players, config: state.config };
}

function startGame(state: GameState, config: GameConfig): GameState {
  assert(state.phase === "lobby", "Game already started.");
  const rng = makeRng(state.seed);
  const players = dealRoles(state.players, config, rng);
  const witchPotions: GameState["witchPotions"] = {};
  const mediumUsed: GameState["mediumUsed"] = {};
  const convertUsed: GameState["convertUsed"] = {};
  const drunkDisguise: GameState["drunkDisguise"] = {};
  const mimicable = mimicableRoleIds();
  for (const p of players) {
    if (p.roleId === "witch") witchPotions[p.id] = { heal: true, poison: true };
    if (p.roleId === "medium") mediumUsed[p.id] = false;
    if (p.roleId === "infector") convertUsed[p.id] = false;
    // Each Drunk secretly becomes a random mimicable role for the whole game.
    if (p.roleId === "drunk" && mimicable.length) {
      const disguise = pick(mimicable, rng);
      drunkDisguise[p.id] = disguise;
      if (disguise === "medium") mediumUsed[p.id] = false; // so the fake step can appear
    }
  }
  return {
    ...state,
    config,
    players,
    witchPotions,
    mediumUsed,
    convertUsed,
    drunkDisguise,
    dealtRoles: players.map((p) => p.roleId!),
    phase: "roleReveal",
    round: 0,
    log: [{ type: "gameStart", round: 0 }],
  };
}

/** Build the ordered night steps from the living players' roles. */
function beginNight(state: GameState): GameState {
  const round = state.round + 1;
  const deadExist = state.players.some((p) => !p.alive);
  // Group by EFFECTIVE role, so a Drunk wakes with (and alongside) the role it
  // impersonates. The Drunk's action resolves to nothing (see the isDrunk skips).
  const byRole = new Map<string, PlayerId[]>();
  for (const p of living(state)) {
    const roleId = effectiveRoleId(state, p.id);
    if (!roleId) continue;
    const ability = getRole(roleId).night;
    if (!ability) continue;
    // Peaceful first night: the wolves sit night 1 out, so nobody dies before
    // the town has had a single conversation.
    if (ability.kind === "kill" && round === 1 && state.config.peacefulFirstNight) continue;
    // The Medium only wakes while their raise is unspent and someone is dead.
    if (ability.kind === "raise" && (state.mediumUsed[p.id] || !deadExist)) continue;
    // The Infector only wakes while their conversion is unspent and a non-wolf lives.
    if (
      ability.kind === "convert" &&
      (state.convertUsed[p.id] ||
        !living(state).some((t) => t.roleId && getRole(t.roleId).team !== "werewolf"))
    )
      continue;
    const list = byRole.get(roleId) ?? [];
    list.push(p.id);
    byRole.set(roleId, list);
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
      subs: {},
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
    silenced: [], // last night's silence expires
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
  assert(!step.done, "That action is already locked in.");
  const targets = validNightTargets(state, actorId);
  assert(targets.some((t) => t.id === targetId), "Invalid target.");

  let inspects = state.inspects;
  if (step.kind === "inspect") {
    const target = playerById(state, targetId)!;
    const ability = getRole(effectiveRoleId(state, actorId)!).night!;
    const reveal = isDrunk(state, actorId)
      ? fabricatedInspect(state.seed, state.round, targetId, ability.reveal ?? "exactRole")
      : ability.reveal === "exactRole"
        ? target.roleId!
        : isWolfForWin(target.roleId!)
          ? "werewolf"
          : "not-werewolf";
    inspects = [
      ...inspects,
      { round: state.round, seerId: actorId, targetId, reveal },
    ];
  }

  return {
    ...state,
    inspects,
    night: { steps: withSub(state.night.steps, step, actorId, { t: "target", target: targetId }) },
  };
}

/** Record a submission and recompute the step's done flag. */
function withSub(
  steps: NightStep[],
  step: NightStep,
  actorId: PlayerId,
  sub: NightSubmission
): NightStep[] {
  const subs = { ...step.subs, [actorId]: sub };
  const done = step.actorIds.every((id) => id in subs);
  return steps.map((s) => (s === step ? { ...s, subs, done } : s));
}

/** The player the wolves are set to kill this night (plurality of a done step). */
export function wolfVictim(state: GameState): PlayerId | null {
  if (!state.night) return null;
  const killStep = state.night.steps.find((s) => s.kind === "kill" && s.done);
  if (!killStep) return null;
  return pluralityTarget(killStep, makeRng(state.seed + state.round));
}

function witchAction(
  state: GameState,
  actorId: PlayerId,
  save: boolean,
  poisonTargetId: PlayerId | null
): GameState {
  assert(state.phase === "night" && state.night, "Not night.");
  const actor = playerById(state, actorId);
  assert(actor?.alive && actor.roleId === "witch", "You are not the Witch.");
  const step = state.night.steps.find((s) => s.kind === "witch" && s.actorIds.includes(actorId));
  assert(step, "You have no night action.");
  assert(!step.done, "You have already acted.");
  // The Witch may only act once the wolves have locked in their victim.
  const killStep = state.night.steps.find((s) => s.kind === "kill");
  assert(!killStep || killStep.done, "Wait for the wolves to choose first.");

  const potions = state.witchPotions[actorId] ?? { heal: false, poison: false };
  if (save) assert(potions.heal && wolfVictim(state), "You can't heal right now.");
  if (poisonTargetId !== null) {
    assert(potions.poison, "Your poison is already spent.");
    assert(poisonTargetId !== actorId, "You can't poison yourself.");
    assert(playerById(state, poisonTargetId)?.alive, "Can't poison a dead player.");
  }
  return {
    ...state,
    night: {
      steps: withSub(state.night.steps, step, actorId, {
        t: "witch",
        save,
        poison: poisonTargetId,
      }),
    },
  };
}

function swapAction(state: GameState, actorId: PlayerId, aId: PlayerId, bId: PlayerId): GameState {
  assert(state.phase === "night" && state.night, "Not night.");
  const actor = playerById(state, actorId);
  assert(actor?.alive && effectiveRoleId(state, actorId) === "troublemaker", "You are not the Troublemaker.");
  const step = state.night.steps.find((s) => s.kind === "swap" && s.actorIds.includes(actorId));
  assert(step, "You have no night action.");
  assert(!step.done, "You have already acted.");
  assert(aId !== bId, "Pick two different players.");
  for (const id of [aId, bId]) {
    assert(id !== actorId, "Swap two other players, not yourself.");
    assert(playerById(state, id)?.alive, "Can only swap living players.");
  }
  return {
    ...state,
    night: {
      steps: withSub(state.night.steps, step, actorId, { t: "swap", a: aId, b: bId }),
    },
  };
}

function detectAction(state: GameState, actorId: PlayerId, aId: PlayerId, bId: PlayerId): GameState {
  assert(state.phase === "night" && state.night, "Not night.");
  const actor = playerById(state, actorId);
  assert(actor?.alive && effectiveRoleId(state, actorId) === "detective", "You are not the Detective.");
  const step = state.night.steps.find((s) => s.kind === "detect" && s.actorIds.includes(actorId));
  assert(step, "You have no night action.");
  assert(!step.done, "You have already acted.");
  assert(aId !== bId, "Pick two different players.");
  for (const id of [aId, bId]) {
    assert(id !== actorId, "Investigate two other players, not yourself.");
    assert(playerById(state, id)?.alive, "Can only investigate living players.");
  }
  const sameTeam = isDrunk(state, actorId)
    ? fabricatedSameTeam(state.seed, state.round, aId, bId)
    : teamOf(state, aId) === teamOf(state, bId);
  return {
    ...state,
    detections: [...state.detections, { round: state.round, detectiveId: actorId, aId, bId, sameTeam }],
    night: { steps: withSub(state.night.steps, step, actorId, { t: "detect", a: aId, b: bId }) },
  };
}

function raiseAction(state: GameState, actorId: PlayerId, targetId: PlayerId | null): GameState {
  assert(state.phase === "night" && state.night, "Not night.");
  const actor = playerById(state, actorId);
  assert(actor?.alive && effectiveRoleId(state, actorId) === "medium", "You are not the Medium.");
  assert(!state.mediumUsed[actorId], "You have already raised someone.");
  const step = state.night.steps.find((s) => s.kind === "raise" && s.actorIds.includes(actorId));
  assert(step, "You have no night action.");
  assert(!step.done, "You have already acted.");
  if (targetId !== null) {
    const target = playerById(state, targetId);
    assert(target && !target.alive, "You can only raise a dead player.");
  }
  return {
    ...state,
    night: { steps: withSub(state.night.steps, step, actorId, { t: "raise", target: targetId }) },
  };
}

/** All target ids submitted for a (target-kind) step. */
function stepTargets(step: NightStep): PlayerId[] {
  return Object.values(step.subs).flatMap((s) => (s.t === "target" ? [s.target] : []));
}

/** Resolve one plurality winner among a step's target submissions, seeded tiebreak. */
function pluralityTarget(step: NightStep, rng: () => number): PlayerId | null {
  const votes = stepTargets(step);
  if (votes.length === 0) return null;
  const tally = new Map<PlayerId, number>();
  for (const v of votes) tally.set(v, (tally.get(v) ?? 0) + 1);
  const max = Math.max(...tally.values());
  const top = shuffle([...tally.entries()].filter(([, c]) => c === max), rng);
  return top[0][0];
}

// Fake results for the Drunk. Deterministic (so pass-device previews match the
// engine record) and independent of the truth (so they leak nothing). A fake
// exact-role read is villager-heavy so it looks like a real Seer's result.
const FAKE_ROLES = ["villager", "villager", "villager", "villager", "werewolf", "seer", "doctor"];
function drunkHash(seed: number, round: number, s: string): number {
  let h = 0;
  for (const ch of s) h = (h * 31 + ch.charCodeAt(0)) | 0;
  return seed + round * 131 + h;
}

/** A stable fake inspect result matching the mimicked inspector's format. */
export function fabricatedInspect(
  seed: number,
  round: number,
  targetId: PlayerId,
  format: "exactRole" | "isWerewolf"
): string {
  const rng = makeRng(drunkHash(seed, round, targetId));
  if (format === "isWerewolf") return rng() < 0.5 ? "werewolf" : "not-werewolf";
  return FAKE_ROLES[Math.floor(rng() * FAKE_ROLES.length)];
}

/** A stable fake "same team?" verdict for a Drunk mimicking the Detective. */
export function fabricatedSameTeam(seed: number, round: number, aId: PlayerId, bId: PlayerId): boolean {
  return makeRng(drunkHash(seed, round, `${aId}|${bId}`))() < 0.5;
}

/** Back-compat: an exact-role fabrication. */
export function fabricatedReveal(seed: number, round: number, targetId: PlayerId): string {
  return fabricatedInspect(seed, round, targetId, "exactRole");
}

/** Mark players dead (only those currently alive); collect any who owe a dying shot. */
function markDead(
  players: Player[],
  ids: PlayerId[]
): { players: Player[]; deadShooters: PlayerId[] } {
  const deadShooters: PlayerId[] = [];
  let next = players;
  for (const id of ids) {
    const p = next.find((x) => x.id === id);
    if (!p || !p.alive) continue;
    next = next.map((x) => (x.id === id ? { ...x, alive: false } : x));
    if (p.roleId && getRole(p.roleId).onDeathShoot) deadShooters.push(id);
  }
  return { players: next, deadShooters };
}

/** Living players a pending shooter could still target. */
export function validShootTargets(state: GameState): Player[] {
  return living(state);
}

/**
 * Enter the dying-shot phase if any shooter has a target; otherwise carry on to
 * the next phase. The single seam that Hunter-style on-death effects hook into.
 *
 * Note: the winner is finalised in `continueAfter`, i.e. only once all pending
 * shots have fired. This is intentional — a dying Hunter shoots even when the
 * math already looks decided, and that shot can change the outcome.
 */
function enterReckoning(state: GameState, next: "day" | "night"): GameState {
  const pending = state.pendingShots.filter((id) => living(state).some((p) => p.id !== id));
  if (pending.length === 0)
    return continueAfter({ ...state, pendingShots: [], afterReckoning: null }, next);
  return { ...state, phase: "hunterShot", pendingShots: pending, afterReckoning: next };
}

/** Resolve the game or advance to the pending day/night once deaths settle. */
function continueAfter(state: GameState, next: "day" | "night"): GameState {
  const winner = checkWinner(state);
  if (winner) return finish(state, winner);
  return next === "day"
    ? { ...state, phase: "dayDiscussion", afterReckoning: null }
    : beginNight({ ...state, afterReckoning: null });
}

function endNight(state: GameState): GameState {
  assert(state.phase === "night" && state.night, "Not night.");
  const rng = makeRng(state.seed + state.round);
  const steps = state.night.steps;

  // A Drunk's mimicked action never has a REAL effect. Its fake *info* was already
  // recorded at submit time (nightChoice/detectAction); here we drop its
  // submissions so no effect kind — present OR future — is ever applied. This is
  // what makes new mimicable roles safe by default. One exception: a Drunk
  // mimicking the Medium spends its (fake) one-time power, so the illusion holds.
  const mediumUsed = { ...state.mediumUsed };
  for (const step of steps) {
    if (step.kind !== "raise") continue;
    for (const [actorId, sub] of Object.entries(step.subs))
      if (sub.t === "raise" && sub.target !== null && isDrunk(state, actorId)) mediumUsed[actorId] = true;
  }
  const liveSteps: NightStep[] = steps.map((s) => ({
    ...s,
    subs: Object.fromEntries(Object.entries(s.subs).filter(([id]) => !isDrunk(state, id))),
  }));

  // Remember tonight's patients so nobody can be shielded twice running. Taken
  // from the RAW steps, not liveSteps: a Drunk mimicking the Doctor is bound by
  // the same restriction, so the blocked name can't give the disguise away.
  const lastProtect: GameState["lastProtect"] = {};
  for (const step of steps) {
    if (step.kind !== "protect") continue;
    for (const [actorId, sub] of Object.entries(step.subs))
      if (sub.t === "target") lastProtect[actorId] = sub.target;
  }

  // Protections (doctor) + the wolves' victim.
  const protectedIds = new Set<PlayerId>();
  for (const step of liveSteps) {
    if (step.kind === "protect") for (const t of stepTargets(step)) protectedIds.add(t);
  }
  let victimId: PlayerId | null = null;
  for (const step of liveSteps) if (step.kind === "kill") victimId = pluralityTarget(step, rng);

  // Witch: heal the victim and/or poison a player, spending potions.
  const witchPotions = { ...state.witchPotions };
  const poisonIds: PlayerId[] = [];
  for (const step of liveSteps) {
    if (step.kind !== "witch") continue;
    for (const [actorId, sub] of Object.entries(step.subs)) {
      if (sub.t !== "witch") continue;
      let cur = witchPotions[actorId] ?? { heal: false, poison: false };
      if (sub.save && cur.heal && victimId) {
        protectedIds.add(victimId);
        cur = { ...cur, heal: false };
      }
      if (sub.poison !== null && cur.poison) {
        poisonIds.push(sub.poison);
        cur = { ...cur, poison: false };
      }
      witchPotions[actorId] = cur;
    }
  }

  // Assemble deaths. Poison bypasses protection, so a protected wolf-victim who
  // is also poisoned still dies — and must be logged as a death, not "saved".
  const deaths = new Set<PlayerId>();
  const wolfProtected = victimId !== null && protectedIds.has(victimId);
  if (victimId && !wolfProtected) deaths.add(victimId);
  for (const id of poisonIds) if (playerById(state, id)?.alive) deaths.add(id);

  const log = state.log.slice();
  if (!victimId) log.push({ type: "noDeath", round: state.round, cause: "wolves" });
  else if (!deaths.has(victimId)) log.push({ type: "saved", round: state.round, playerId: victimId });
  else if (!wolfProtected) log.push({ type: "death", round: state.round, playerId: victimId, cause: "wolves" });
  else log.push({ type: "poisoned", round: state.round, playerId: victimId }); // protected but poisoned
  for (const id of deaths) if (id !== victimId) log.push({ type: "poisoned", round: state.round, playerId: id });

  const killed = markDead(state.players, [...deaths]);
  const roleState: RoleState = {
    witchPotions,
    mediumUsed,
    convertUsed: { ...state.convertUsed },
    drunkDisguise: { ...state.drunkDisguise },
    lastProtect,
  };
  // Spend one-time powers (Medium raise, Infector convert) BEFORE swaps, so the
  // spent flag is written under the current id and then travels with the role...
  let players = applyRaises(killed.players, roleState.mediumUsed, liveSteps, log, state.round);
  players = applyConverts(players, roleState.convertUsed, roleState.drunkDisguise, liveSteps);
  // ...then the Troublemaker swap carries all that role state to the new holder.
  players = applySwaps(players, roleState, liveSteps);

  // Silencer: whoever is silenced can't vote in the coming day.
  const silenced: PlayerId[] = [];
  for (const step of liveSteps) {
    if (step.kind === "silence") for (const t of stepTargets(step)) silenced.push(t);
  }

  const next: GameState = {
    ...state,
    players,
    witchPotions: roleState.witchPotions,
    mediumUsed: roleState.mediumUsed,
    convertUsed: roleState.convertUsed,
    drunkDisguise: roleState.drunkDisguise,
    lastProtect: roleState.lastProtect,
    silenced,
    night: null,
    log,
    pendingShots: [...state.pendingShots, ...killed.deadShooters],
  };
  return enterReckoning(next, "day");
}

/** Swap a per-player role-state entry between two ids (potions/medium follow role). */
function swapEntry<T>(map: Record<string, T>, a: PlayerId, b: PlayerId) {
  const va = map[a];
  const vb = map[b];
  delete map[a];
  delete map[b];
  if (vb !== undefined) map[a] = vb;
  if (va !== undefined) map[b] = va;
}

/** Mutable bundle of per-player role state that swaps carry with the role. */
interface RoleState {
  witchPotions: GameState["witchPotions"];
  mediumUsed: GameState["mediumUsed"];
  convertUsed: GameState["convertUsed"];
  drunkDisguise: GameState["drunkDisguise"];
  lastProtect: GameState["lastProtect"];
}

/**
 * Apply every Troublemaker swap for which both targets are still alive. All
 * per-player role state (potions, spent flags) travels with the role, so a
 * player swapped into a role inherits its state and the ex-holder loses it.
 */
function applySwaps(players: Player[], roleState: RoleState, steps: NightStep[]): Player[] {
  let next = players;
  for (const step of steps) {
    if (step.kind !== "swap") continue;
    for (const sub of Object.values(step.subs)) {
      if (sub.t !== "swap") continue;
      const a = next.find((p) => p.id === sub.a);
      const b = next.find((p) => p.id === sub.b);
      if (!a?.alive || !b?.alive) continue;
      const roleA = a.roleId;
      next = next.map((p) =>
        p.id === sub.a ? { ...p, roleId: b.roleId } : p.id === sub.b ? { ...p, roleId: roleA } : p
      );
      swapEntry(roleState.witchPotions, sub.a, sub.b);
      swapEntry(roleState.mediumUsed, sub.a, sub.b);
      swapEntry(roleState.convertUsed, sub.a, sub.b);
      swapEntry(roleState.drunkDisguise, sub.a, sub.b);
      swapEntry(roleState.lastProtect, sub.a, sub.b);
    }
  }
  return next;
}

/** Apply Medium raises, mutating the shared log + spent flags. */
function applyRaises(
  players: Player[],
  mediumUsed: GameState["mediumUsed"],
  steps: NightStep[],
  log: GameState["log"],
  round: number
): Player[] {
  let next = players;
  for (const step of steps) {
    if (step.kind !== "raise") continue;
    for (const [actorId, sub] of Object.entries(step.subs)) {
      if (sub.t !== "raise" || sub.target === null || mediumUsed[actorId]) continue;
      const target = next.find((p) => p.id === sub.target);
      if (!target || target.alive) continue;
      next = next.map((p) => (p.id === sub.target ? { ...p, alive: true } : p));
      mediumUsed[actorId] = true;
      log.push({ type: "raised", round, playerId: sub.target });
    }
  }
  return next;
}

/** Apply Infector conversions: turn a living non-wolf into a werewolf. */
function applyConverts(
  players: Player[],
  convertUsed: GameState["convertUsed"],
  drunkDisguise: GameState["drunkDisguise"],
  steps: NightStep[]
): Player[] {
  let next = players;
  for (const step of steps) {
    if (step.kind !== "convert") continue;
    for (const [actorId, sub] of Object.entries(step.subs)) {
      if (sub.t !== "target" || convertUsed[actorId]) continue;
      const target = next.find((p) => p.id === sub.target);
      if (!target?.alive || (target.roleId && getRole(target.roleId).team === "werewolf")) continue;
      next = next.map((p) => (p.id === sub.target ? { ...p, roleId: "werewolf" } : p));
      // A converted Drunk becomes a real wolf — drop the fake disguise so it no
      // longer wakes as its old village role (and stops faking effects).
      delete drunkDisguise[sub.target];
      convertUsed[actorId] = true;
    }
  }
  return next;
}

function shoot(state: GameState, hunterId: PlayerId, targetId: PlayerId): GameState {
  assert(state.phase === "hunterShot", "No dying shot pending.");
  assert(state.pendingShots[0] === hunterId, "It's not your shot.");
  const target = playerById(state, targetId);
  assert(target?.alive, "Can't shoot a dead player.");
  assert(targetId !== hunterId, "You can't shoot yourself.");

  const { players, deadShooters } = markDead(state.players, [targetId]);
  const log: typeof state.log = [
    ...state.log,
    { type: "hunterShot", round: state.round, playerId: targetId },
  ];
  const pendingShots = [...state.pendingShots.slice(1), ...deadShooters];
  return enterReckoning({ ...state, players, log, pendingShots }, state.afterReckoning ?? "day");
}

/** Host recovery: drop the pending shooter without firing (e.g. they left). */
function skipShot(state: GameState): GameState {
  assert(state.phase === "hunterShot", "No dying shot pending.");
  const pendingShots = state.pendingShots.slice(1);
  return enterReckoning({ ...state, pendingShots }, state.afterReckoning ?? "day");
}

function startVote(state: GameState): GameState {
  assert(state.phase === "dayDiscussion", "Not in day discussion.");
  return { ...state, phase: "dayVote", votes: {} };
}

function castVote(state: GameState, voterId: PlayerId, targetId: PlayerId | null): GameState {
  assert(state.phase === "dayVote", "Not voting.");
  const voter = playerById(state, voterId);
  assert(voter?.alive, "Dead players can't vote.");
  assert(!state.silenced.includes(voterId), "You've been silenced — no vote today.");
  if (targetId !== null) {
    assert(targetId !== voterId, "You can't vote for yourself.");
    const target = playerById(state, targetId);
    assert(target?.alive, "Can't vote for a dead player.");
  }
  return { ...state, votes: { ...state.votes, [voterId]: targetId } };
}

/** Living players who are allowed to vote (silenced players sit the day out). */
export function eligibleVoters(state: GameState): Player[] {
  return living(state).filter((p) => !state.silenced.includes(p.id));
}

/** True once every eligible voter has cast (or skipped) a vote. */
export function allVotesIn(state: GameState): boolean {
  return eligibleVoters(state).every((p) => p.id in state.votes);
}

function resolveVote(state: GameState): GameState {
  assert(state.phase === "dayVote", "Not voting.");
  const tally = new Map<PlayerId, number>();
  for (const target of Object.values(state.votes)) {
    if (target === null) continue;
    tally.set(target, (tally.get(target) ?? 0) + 1);
  }

  const log = state.log.slice();

  if (tally.size === 0) {
    log.push({ type: "noDeath", round: state.round, cause: "lynch" });
    return continueAfter({ ...state, votes: {}, log }, "night");
  }
  const max = Math.max(...tally.values());
  const top = [...tally.entries()].filter(([, c]) => c === max);
  if (top.length > 1) {
    // Tie: no one is lynched. (Deliberate rule — keeps stalls harmless.)
    log.push({ type: "voteTie", round: state.round });
    return continueAfter({ ...state, votes: {}, log }, "night");
  }

  const lynchedId = top[0][0];
  const lynched = playerById(state, lynchedId)!;
  const { players, deadShooters } = markDead(state.players, [lynchedId]);
  log.push({ type: "lynch", round: state.round, playerId: lynchedId });

  // A lynched Tanner wins outright, before any Hunter shot or team check.
  if (lynched.roleId && getRole(lynched.roleId).winsIfLynched) {
    return finish({ ...state, players, votes: {}, log }, "solo", lynchedId);
  }

  const next: GameState = {
    ...state,
    players,
    votes: {},
    log,
    pendingShots: [...state.pendingShots, ...deadShooters],
  };
  return enterReckoning(next, "night");
}

function finish(state: GameState, winner: Team, soloWinnerId: PlayerId | null = null): GameState {
  return {
    ...state,
    phase: "gameOver",
    winner,
    soloWinnerId,
    night: null,
    pendingShots: [],
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
      revealRoleOnDeath: false,
      nightSummary: "discreet",
      peacefulFirstNight: false,
    },
    round: 0,
    night: null,
    inspects: [],
    detections: [],
    silenced: [],
    mediumUsed: {},
    convertUsed: {},
    drunkDisguise: {},
    lastProtect: {},
    dealtRoles: [],
    votes: {},
    witchPotions: {},
    pendingShots: [],
    afterReckoning: null,
    log: [],
    seed,
    winner: null,
    soloWinnerId: null,
  };
}
