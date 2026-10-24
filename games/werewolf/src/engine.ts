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
  Announcement,
  AnnouncementEvent,
  Notice,
} from "./types.js";
import { getRole, mimicableRoleIds, isWolf, onWolfTeam } from "./roles.js";
import { dealRoles, maxWolfTeam, possibleRoles } from "./setup.js";
import { makeRng, shuffle, pick, nextSeed } from "@party/core";
import { GameError } from "@party/core";

// ---------------------------------------------------------------------------
// Queries (pure helpers, safe to use from client for view logic)
// ---------------------------------------------------------------------------

export function living(state: GameState): Player[] {
  return state.players.filter((p) => p.alive);
}

export function playerById(state: GameState, id: PlayerId): Player | undefined {
  return state.players.find((p) => p.id === id);
}

/**
 * True if this player's power does nothing tonight: the Drunk always, and
 * anyone the Poisoner got to last night. They act as normal; effects are
 * dropped at dawn and info comes back fake, so they can't tell.
 */
export function isPowerless(state: GameState, id: PlayerId): boolean {
  return playerById(state, id)?.roleId === "drunk" || state.drugged.includes(id);
}

/**
 * Night-action kinds the Drunk can fake without being found out while it
 * still matters. Effect kinds are nullified automatically (a Drunk's
 * submissions are stripped in endNight) and info kinds are fabricated (see
 * nightChoice / detectAction); either way the failure should be invisible.
 * A Gossip's silence would visibly not happen, so it's out. The Medium is
 * the one exception, kept on purpose: a séance that fails at dawn is a good
 * reveal, and the table can't tell who held it. A `drunkMimicable` role must
 * have no night power or one of these kinds (a test enforces it); passive
 * powers (the Hunter's shot, the Prince's reprieve, the Cursed's turn) and
 * solo wins (the Tanner's, the Poisoner's) check the real role, so a Drunk
 * never triggers them — and is only found out once it's dead. A Drunk
 * Werewolf hunts alone with a pack it imagines (see drunkPack), which takes
 * the blame for every kill it didn't pick, so it can go all game.
 */
export const DRUNK_MIMIC_KINDS: NightActionKind[] = ["inspect", "protect", "swap", "detect", "mark", "raise", "block", "kill"];

/** The role a player ACTS AS: their Drunk disguise if any, else their real role. */
export function effectiveRoleId(state: GameState, id: PlayerId): string | null {
  const disguise = state.drunkDisguise[id];
  if (disguise) return disguise;
  return playerById(state, id)?.roleId ?? null;
}

/**
 * Standard win check. Village: no real wolves left (a wolf-aligned Henchman
 * doesn't keep the wolves alive). Wolves: the whole wolf team — Henchman
 * included, since they vote with the pack — outnumbers everyone else, or ties
 * them with nothing left that could break the tie.
 */
export function checkWinner(state: GameState): Team | null {
  const alive = living(state);
  if (!alive.some((p) => p.roleId && isWolf(p.roleId))) return "village";
  const pack = alive.filter((p) => p.roleId && onWolfTeam(p.roleId)).length;
  const rest = alive.length - pack;
  if (pack > rest || (pack === rest && !canBreakTie(state))) return "werewolf";
  return null;
}

/**
 * At a tie the wolves hold half the votes, so the town can't vote them out —
 * unless someone alive still holds a power that could change that (see
 * RoleDef.canBreakTie). Real roles only: a Drunk has no power to use.
 */
function canBreakTie(state: GameState): boolean {
  return living(state).some((p) => !!p.roleId && !!getRole(p.roleId).canBreakTie?.(state, p.id));
}

/**
 * Whether a player won: their final role's side won (or they're the solo
 * winner), or they only needed to survive (the Poisoner) and did.
 */
export function wonGame(
  p: { id: PlayerId; roleId: string | null; alive: boolean },
  winner: Team | null,
  soloWinnerId: PlayerId | null
): boolean {
  if (!winner || !p.roleId) return false;
  const role = getRole(p.roleId);
  if (role.winsBySurviving) return p.alive;
  return winner === "solo" ? p.id === soloWinnerId : role.team === winner;
}

/** Whether every actor in every night step has submitted a choice. */
export function allNightStepsDone(state: GameState): boolean {
  if (!state.night) return false;
  return state.night.steps.every((s) => s.done);
}

/** Night kinds that hand the actor a private result they must read before dawn. */
const NIGHT_RESULT_KINDS: NightActionKind[] = ["inspect", "detect"];

/** Actors who acted tonight on a result-bearing step and haven't dismissed it yet. */
export function unackedNightResults(state: GameState): PlayerId[] {
  if (!state.night) return [];
  const acked = state.night.acked;
  return state.night.steps
    .filter((s) => NIGHT_RESULT_KINDS.includes(s.kind))
    .flatMap((s) => Object.keys(s.subs))
    .filter((id) => !acked.includes(id) && playerById(state, id)?.alive);
}

/** Living players with no night step tonight (they get a decoy prompt). */
export function nightIdlers(state: GameState): Player[] {
  const steps = state.night?.steps ?? [];
  return living(state).filter((p) => !steps.some((s) => s.actorIds.includes(p.id)));
}

/**
 * Whether the night can close by itself: everyone has acted (powers and
 * decoys alike) AND everyone who learned something has had the chance to
 * read it. (The host can still force it.)
 */
export function nightReadyToEnd(state: GameState): boolean {
  const idleDone = state.night?.idleDone ?? [];
  return (
    allNightStepsDone(state) &&
    unackedNightResults(state).length === 0 &&
    nightIdlers(state).every((p) => idleDone.includes(p.id))
  );
}

/**
 * Who an actor's night power can pick — the one place that decides it, for
 * every kind. Uses the effective (possibly disguised) role.
 */
export function validNightTargets(state: GameState, actorId: PlayerId): Player[] {
  const roleId = effectiveRoleId(state, actorId);
  if (!playerById(state, actorId)?.alive || !roleId) return [];
  const ability = getRole(roleId).night;
  if (!ability) return [];
  // The Medium calls on the dead; every other power picks among the living.
  const candidates = ability.kind === "raise" ? state.players.filter((p) => !p.alive) : living(state);
  const targets = candidates.filter((t) => {
    if (t.id === actorId && !ability.canTargetSelf) return false;
    // The wolf team never targets its own: no eating or infecting the pack.
    if (onWolfTeam(roleId) && packmatesOf(state, actorId).includes(t.id)) return false;
    return true;
  });
  // No picking the same player two nights running (the Doctor's patient, the
  // Gossip's mark) — unless that would leave nobody at all, which would wedge
  // the night.
  if (ability.noRepeat) {
    const fresh = targets.filter((t) => t.id !== state.lastTarget[actorId]);
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
  | { type: "ready"; actorId: PlayerId }
  | { type: "nightChoice"; actorId: PlayerId; targetId: PlayerId }
  | { type: "witchAction"; actorId: PlayerId; heal: boolean; poisonTargetId: PlayerId | null }
  | { type: "nightSkip"; actorId: PlayerId }
  | { type: "swapAction"; actorId: PlayerId; aId: PlayerId; bId: PlayerId }
  | { type: "detectAction"; actorId: PlayerId; aId: PlayerId; bId: PlayerId }
  | { type: "raiseAction"; actorId: PlayerId; targetId: PlayerId | null }
  | { type: "nightAck"; actorId: PlayerId }
  | { type: "nightIdle"; actorId: PlayerId; targetId: PlayerId }
  | { type: "endNight" }
  | { type: "startVote" }
  | { type: "castVote"; voterId: PlayerId; targetId: PlayerId | null }
  | { type: "skipVoter" }
  | { type: "resolveVote" }
  | { type: "proceed" }
  | { type: "playAgain" }
  | { type: "redeal" }
  | { type: "say"; speakerId: PlayerId; text: string };

/** Longest single message, and the most a game will keep before it stops listening. */
export const MAX_CHAT_TEXT = 300;
export const MAX_CHAT_MESSAGES = 300;

/** An illegal move. A GameError, so the platform shows its message to the player. */
class EngineError extends GameError {}

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
    case "ready":
      return ready(state, action.actorId);
    case "nightChoice":
      return nightChoice(state, action.actorId, action.targetId);
    case "witchAction":
      return witchAction(state, action.actorId, action.heal, action.poisonTargetId);
    case "nightSkip":
      return nightSkip(state, action.actorId);
    case "swapAction":
      return swapAction(state, action.actorId, action.aId, action.bId);
    case "detectAction":
      return detectAction(state, action.actorId, action.aId, action.bId);
    case "raiseAction":
      return raiseAction(state, action.actorId, action.targetId);
    case "nightAck":
      return nightAck(state, action.actorId);
    case "nightIdle":
      return nightIdle(state, action.actorId, action.targetId);
    case "endNight":
      return endNight(state);
    case "startVote":
      return startVote(state);
    case "castVote":
      return castVote(state, action.voterId, action.targetId);
    case "skipVoter":
      return skipVoter(state);
    case "resolveVote":
      return resolveVote(state);
    case "proceed":
      return proceed(state);
    case "playAgain":
      return playAgain(state);
    case "redeal":
      return redeal(state);
    case "say":
      return say(state, action.speakerId, action.text);
  }
}

/**
 * Say something to the town. Daytime only and living players only — the night
 * is silent and the dead stay out of it — and always public, so nothing here
 * can leak a role the speaker didn't choose to give away.
 */
function say(state: GameState, speakerId: PlayerId, text: string): GameState {
  assert(state.config.chat !== false, "Chat is off for this game — say it out loud.");
  assert(
    state.phase === "dayDiscussion" || state.phase === "dayVote",
    "The town only talks by day."
  );
  const speaker = playerById(state, speakerId);
  assert(speaker?.alive, "The dead don't get a say.");
  assert(!state.silenced.includes(speakerId), "You're getting the cold shoulder today — nobody's listening.");
  const clean = text.trim().slice(0, MAX_CHAT_TEXT);
  assert(clean.length > 0, "Say something first.");
  assert(state.chat.length < MAX_CHAT_MESSAGES, "This town has talked itself hoarse.");
  return {
    ...state,
    chat: [...state.chat, { round: state.round, playerId: speakerId, text: clean }],
  };
}

/**
 * A player has read their role card and understood it. Once every player has,
 * night falls on its own; the host can still start without someone who's gone
 * quiet (startNight).
 */
function ready(state: GameState, actorId: PlayerId): GameState {
  assert(state.phase === "roleReveal", "Roles not being revealed.");
  assert(playerById(state, actorId), "You're not in this game.");
  if (state.ready.includes(actorId)) return state;
  const next = { ...state, ready: [...state.ready, actorId] };
  return state.players.every((p) => next.ready.includes(p.id)) ? beginNight(next) : next;
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

/**
 * Shuffle again from the same setup and go back to the role cards: the way out
 * when someone's card got seen, or a question gave a role away, before it
 * mattered. Only until the first dawn, so no death is ever undone.
 */
function redeal(state: GameState): GameState {
  assert(state.phase === "roleReveal" || (state.phase === "night" && state.round === 1), "Too late to redeal.");
  const players = state.players.map((p) => ({ ...p, roleId: null, alive: true }));
  const fresh = { ...createGame(state.code, nextSeed(state.seed)), players, redeals: state.redeals + 1 };
  return startGame(fresh, state.config);
}

function startGame(state: GameState, config: GameConfig): GameState {
  assert(state.phase === "lobby", "Game already started.");
  const rng = makeRng(state.seed);
  const players = dealRoles(state.players, config, rng);
  const witchPotions: GameState["witchPotions"] = {};
  const drunkDisguise: GameState["drunkDisguise"] = {};
  const drunkPack: GameState["drunkPack"] = {};
  // The Drunk's disguise comes only from roles this game could have: a role the
  // whole table can see isn't in play would tell the Drunk what they are.
  const inPlay = new Set(possibleRoles(config, players.length));
  const mimicable = mimicableRoleIds().filter((id) => inPlay.has(id)); // never empty: there's always a Werewolf
  const dealtRoles = players.map((p) => p.roleId!);
  // Dealt an apprentice to a role nobody holds? They start out holding it.
  const startingPlayers = promoteSuccessors(players).players;
  for (const p of players) {
    if (p.roleId === "witch") witchPotions[p.id] = { heal: true, poison: true };
    // Each Drunk secretly becomes a random mimicable role for the whole game.
    if (p.roleId === "drunk") {
      const disguise = pick(mimicable, rng);
      drunkDisguise[p.id] = disguise;
      if (disguise === "werewolf") {
        // At least one packmate to blame for kills it didn't pick, and no more
        // than this table's biggest real pack, so the size gives nothing away.
        const most = maxWolfTeam(players.length) - 1;
        const others = players.filter((o) => o.id !== p.id).map((o) => o.id);
        drunkPack[p.id] = shuffle(others, rng).slice(0, most && 1 + Math.floor(rng() * most));
      }
    }
  }
  return {
    ...state,
    config,
    witchPotions,
    drunkDisguise,
    drunkPack,
    players: startingPlayers,
    dealtRoles,
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
  // impersonates. Its action comes to nothing (see isPowerless). A group (the
  // pack) never sees a Drunk among it, though: it hunts in a step of its own.
  const byRole = new Map<string, { roleId: string; actorIds: PlayerId[] }>();
  for (const p of living(state)) {
    const roleId = effectiveRoleId(state, p.id);
    if (!roleId) continue;
    const ability = getRole(roleId).night;
    if (!ability) continue;
    // Peaceful first night: no killing at all, so the wolves and the Witch sleep.
    if ((ability.kind === "kill" || ability.kind === "witch") && round === 1 && state.config.peacefulFirstNight) continue;
    // A spent one-time power sleeps through; so does one with nothing to work on.
    if (ability.once && state.used[p.id]) continue;
    if (ability.kind === "raise" && !deadExist) continue;
    if (ability.kind === "convert" && !living(state).some((t) => t.roleId && !onWolfTeam(t.roleId))) continue;
    const key = ability.group && p.roleId === "drunk" ? p.id : roleId;
    const entry = byRole.get(key) ?? { roleId, actorIds: [] };
    entry.actorIds.push(p.id);
    byRole.set(key, entry);
  }
  const steps: NightStep[] = [];
  for (const { roleId, actorIds } of byRole.values()) {
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
  const night: NightState = { steps, acked: [], idleDone: [] };
  return {
    ...state,
    phase: "night",
    round,
    night,
    votes: {},
    // Yesterday's private news is old news — except a takeover, which matters
    // most on the first night the new power wakes.
    notices: Object.fromEntries(Object.entries(state.notices).filter(([, n]) => n.promoted)),
    silenced: [], // last night's silence expires
    log: [...state.log, { type: "night", round }],
  };
}

/** The step `actorId` takes tonight (of `kind`, if given), checked still open. */
function openStep(state: GameState, actorId: PlayerId, kind?: NightActionKind): NightStep {
  assert(state.phase === "night" && state.night, "Not night.");
  assert(playerById(state, actorId)?.alive, "The dead don't act.");
  const step = state.night.steps.find((s) => s.actorIds.includes(actorId) && (!kind || s.kind === kind));
  assert(step, "You have no night action.");
  assert(!step.done, "You have already acted.");
  return step;
}

/** Record a submission and recompute the step's done flag. */
function submit(state: GameState, step: NightStep, actorId: PlayerId, sub: NightSubmission): GameState {
  const subs = { ...step.subs, [actorId]: sub };
  const done = step.actorIds.every((id) => id in subs);
  const steps = state.night!.steps.map((s) => (s === step ? { ...s, subs, done } : s));
  return { ...state, night: { ...state.night!, steps } };
}

/** Two different valid targets, for the Troublemaker's swap and the Detective's comparison. */
function assertPair(state: GameState, actorId: PlayerId, aId: PlayerId, bId: PlayerId) {
  assert(aId !== bId, "Pick two different players.");
  const valid = validNightTargets(state, actorId).map((p) => p.id);
  assert(valid.includes(aId) && valid.includes(bId), "Pick two other living players.");
}

function nightChoice(state: GameState, actorId: PlayerId, targetId: PlayerId): GameState {
  const step = openStep(state, actorId);
  assert(validNightTargets(state, actorId).some((t) => t.id === targetId), "Invalid target.");
  if (step.kind === "inspect") {
    const format = getRole(step.roleId).night!.reveal ?? "exactRole";
    const roleId = playerById(state, targetId)!.roleId!;
    const reveal = isPowerless(state, actorId)
      ? fabricatedInspect(state.seed, state.round, targetId, format)
      : format === "exactRole"
        ? roleId
        : isWolf(roleId)
          ? "werewolf"
          : "not-werewolf";
    state = { ...state, inspects: [...state.inspects, { round: state.round, seerId: actorId, targetId, reveal }] };
  }
  return submit(state, step, actorId, { t: "target", target: targetId });
}

/**
 * The Witch acts blind, like everyone else: she never learns whom the wolves
 * picked. Her healing potion saves whoever they attack tonight, and is spent
 * either way — if they attacked nobody, she wasted it.
 */
function witchAction(state: GameState, actorId: PlayerId, heal: boolean, poison: PlayerId | null): GameState {
  const step = openStep(state, actorId, "witch");
  const potions = state.witchPotions[actorId] ?? { heal: false, poison: false };
  if (heal) assert(potions.heal, "Your healing potion is already spent.");
  if (poison !== null) {
    assert(potions.poison, "Your poison is already spent.");
    assert(validNightTargets(state, actorId).some((p) => p.id === poison), "Poison another living player.");
  }
  return submit(state, step, actorId, { t: "witch", heal, poison });
}

/**
 * A player with no power tonight taps through their decoy prompt. The pick is
 * deliberately thrown away: the prompt exists only so every phone at the
 * table is busy at night, not to record anything.
 */
function nightIdle(state: GameState, actorId: PlayerId, targetId: PlayerId): GameState {
  assert(state.phase === "night" && state.night, "Not night.");
  assert(nightIdlers(state).some((p) => p.id === actorId), "You have a real choice to make tonight.");
  assert(targetId !== actorId && playerById(state, targetId)?.alive, "Pick another living player.");
  if (state.night.idleDone.includes(actorId)) return state;
  return { ...state, night: { ...state.night, idleDone: [...state.night.idleDone, actorId] } };
}

/** Hold an optional one-time power for another night (it isn't spent). */
function nightSkip(state: GameState, actorId: PlayerId): GameState {
  const step = openStep(state, actorId);
  assert(getRole(step.roleId).night?.optional, "That power can't be saved for later.");
  return submit(state, step, actorId, { t: "skip" });
}

/** An actor has read their private night result; the night may now move on. */
function nightAck(state: GameState, actorId: PlayerId): GameState {
  assert(state.phase === "night" && state.night, "Not night.");
  if (state.night.acked.includes(actorId)) return state;
  assert(unackedNightResults(state).includes(actorId), "Nothing to acknowledge.");
  return { ...state, night: { ...state.night, acked: [...state.night.acked, actorId] } };
}

function swapAction(state: GameState, actorId: PlayerId, aId: PlayerId, bId: PlayerId): GameState {
  const step = openStep(state, actorId, "swap");
  assertPair(state, actorId, aId, bId);
  return submit(state, step, actorId, { t: "swap", a: aId, b: bId });
}

function detectAction(state: GameState, actorId: PlayerId, aId: PlayerId, bId: PlayerId): GameState {
  const step = openStep(state, actorId, "detect");
  assertPair(state, actorId, aId, bId);
  const team = (id: PlayerId) => getRole(playerById(state, id)!.roleId!).team;
  const sameTeam = isPowerless(state, actorId)
    ? fabricatedSameTeam(state.seed, state.round, aId, bId)
    : team(aId) === team(bId);
  state = { ...state, detections: [...state.detections, { round: state.round, detectiveId: actorId, aId, bId, sameTeam }] };
  return submit(state, step, actorId, { t: "detect", a: aId, b: bId });
}

function raiseAction(state: GameState, actorId: PlayerId, targetId: PlayerId | null): GameState {
  const step = openStep(state, actorId, "raise");
  if (targetId !== null)
    assert(validNightTargets(state, actorId).some((p) => p.id === targetId), "You can only raise a dead player.");
  return submit(state, step, actorId, { t: "raise", target: targetId });
}

/** Each actor's target on these steps (actorId -> target). */
function picksOf(steps: NightStep[]): Record<PlayerId, PlayerId> {
  const picks: Record<PlayerId, PlayerId> = {};
  for (const step of steps)
    for (const [actorId, sub] of Object.entries(step.subs)) if (sub.t === "target") picks[actorId] = sub.target;
  return picks;
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

/**
 * A dying Hunter takes the player they marked at night with them — no extra
 * turn, no waiting. A shot that kills another Hunter sets off theirs too.
 */
function fireDyingShots(
  players: Player[],
  shooters: PlayerId[],
  marks: GameState["hunterMark"],
  events: AnnouncementEvent[],
  log: GameState["log"],
  round: number
): Player[] {
  let next = players;
  const queue = [...shooters];
  while (queue.length) {
    const shooterId = queue.shift()!;
    const targetId = marks[shooterId];
    if (!targetId || !next.find((p) => p.id === targetId)?.alive) continue;
    const r = markDead(next, [targetId]);
    next = r.players;
    events.push({ t: "shot", shooterId, playerId: targetId });
    log.push({ type: "hunterShot", round, playerId: targetId });
    queue.push(...r.deadShooters);
  }
  return next;
}

/**
 * Stop and tell the table what just happened. The outcome is already applied;
 * `proceed` moves on to the day, the next night, or the end of the game.
 */
function announce(
  state: GameState,
  kind: Announcement["kind"],
  events: AnnouncementEvent[],
  soloWinnerId: PlayerId | null = null
): GameState {
  const winner = soloWinnerId ? "solo" : checkWinner(state);
  const announcement: Announcement = {
    kind,
    round: state.round,
    events,
    next: winner ? "gameOver" : kind === "dawn" ? "day" : "night",
    winner,
    soloWinnerId,
  };
  return { ...state, phase: "announce", announcement };
}

/** The host moves the table on from an announcement. */
function proceed(state: GameState): GameState {
  assert(state.phase === "announce" && state.announcement, "There's nothing to move on from.");
  const a = state.announcement;
  const next: GameState = { ...state, announcement: null };
  if (a.next === "gameOver") return finish(next, a.winner!, a.soloWinnerId);
  if (a.next === "day") return { ...next, phase: "dayDiscussion" };
  return beginNight(next);
}

/** The rest of the wolf team, if `id` is on it: who a pack member knows. */
export function packmatesOf(state: GameState, id: PlayerId): PlayerId[] {
  const imagined = state.drunkPack[id];
  if (imagined) return imagined.filter((m) => m !== id); // a swap can hand you your own name
  const roleId = playerById(state, id)?.roleId;
  if (!roleId || !onWolfTeam(roleId)) return [];
  return state.players.filter((p) => p.id !== id && p.roleId && onWolfTeam(p.roleId)).map((p) => p.id);
}

function endNight(state: GameState): GameState {
  assert(state.phase === "night" && state.night, "Not night.");
  const rng = makeRng(state.seed + state.round);
  const steps = state.night.steps;

  // A powerless player's action (the Drunk, or anyone poisoned) has no effect:
  // their fake info was handed out at submit time, and here their submissions
  // are dropped, so no effect kind can ever apply. A one-time power they used is
  // still spent, so its reappearing tomorrow can't give the game away — and a
  // swap is spent even when it fizzles. Raises and bites are spent as they land.
  const used = { ...state.used };
  for (const step of steps) {
    if (!getRole(step.roleId).night?.once) continue;
    for (const [actorId, sub] of Object.entries(step.subs)) {
      const usedIt = sub.t === "swap" || sub.t === "target" || (sub.t === "raise" && sub.target !== null);
      if (usedIt && (sub.t === "swap" || isPowerless(state, actorId))) used[actorId] = true;
    }
  }
  const liveSteps: NightStep[] = steps.map((s) => ({
    ...s,
    subs: Object.fromEntries(Object.entries(s.subs).filter(([id]) => !isPowerless(state, id))),
  }));
  const targetsOf = (kind: NightActionKind) => liveSteps.filter((s) => s.kind === kind).flatMap(stepTargets);

  // Picks, not powers, so taken from the RAW steps: a powerless Doctor is barred
  // from repeating a patient like a real one, and a poisoned Hunter's mark holds.
  const lastTarget = picksOf(steps.filter((st) => getRole(st.roleId).night?.noRepeat));
  const hunterMark = { ...state.hunterMark, ...picksOf(steps.filter((st) => st.kind === "mark")) };

  const protectedIds = new Set(targetsOf("protect"));
  // The pack's step: a Drunk Werewolf's own step is empty by now.
  const killStep = liveSteps.find((s) => s.kind === "kill" && Object.keys(s.subs).length);
  const victimId = killStep ? pluralityTarget(killStep, rng) : null;

  // Witch: heal the victim and/or poison a player, spending potions.
  const witchPotions = { ...state.witchPotions };
  const poisonIds: PlayerId[] = [];
  // From the RAW steps: a poisoned Witch's potion is spent all the same (it just
  // doesn't work), so a full bottle the next night can't tip her off.
  for (const step of steps) {
    if (step.kind !== "witch") continue;
    for (const [actorId, sub] of Object.entries(step.subs)) {
      if (sub.t !== "witch") continue;
      const works = !isPowerless(state, actorId);
      let cur = witchPotions[actorId] ?? { heal: false, poison: false };
      // Drinking it spends it, whether or not the wolves attacked anyone.
      if (sub.heal && cur.heal) {
        if (victimId && works) protectedIds.add(victimId);
        cur = { ...cur, heal: false };
      }
      if (sub.poison !== null && cur.poison) {
        if (works) poisonIds.push(sub.poison);
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

  // The Cursed don't die of a bite: they turn (unless poison gets them anyway).
  // To the town it's a quiet night.
  const victim = victimId ? playerById(state, victimId) : undefined;
  let turned: PlayerId | null = null;
  if (victimId && deaths.has(victimId) && !poisonIds.includes(victimId) && victim?.roleId && getRole(victim.roleId).turnsWhenBitten) {
    deaths.delete(victimId);
    turned = victimId;
  }

  const log = state.log.slice();
  const events: AnnouncementEvent[] = [];
  if (!victimId || turned) {
    log.push({ type: "noDeath", round: state.round, cause: "wolves" });
    events.push({ t: "quiet" });
  } else if (!deaths.has(victimId)) {
    log.push({ type: "saved", round: state.round, playerId: victimId });
    events.push({ t: "saved", playerId: victimId });
  } else if (!wolfProtected) {
    log.push({ type: "death", round: state.round, playerId: victimId, cause: "wolves" });
    events.push({ t: "killed", playerId: victimId });
  } else {
    log.push({ type: "poisoned", round: state.round, playerId: victimId }); // protected but poisoned
    events.push({ t: "poisoned", playerId: victimId });
  }
  for (const id of deaths)
    if (id !== victimId) {
      log.push({ type: "poisoned", round: state.round, playerId: id });
      events.push({ t: "poisoned", playerId: id });
    }

  const killed = markDead(state.players, [...deaths]);
  // Dying Hunters fire at whoever they marked (tonight's pick).
  const afterShots = fireDyingShots(killed.players, killed.deadShooters, hunterMark, events, log, state.round);
  const roleState: RoleState = {
    witchPotions,
    used,
    drunkDisguise: { ...state.drunkDisguise },
    drunkPack: { ...state.drunkPack },
    lastTarget,
    hunterMark,
  };
  // Spend one-time powers (Medium raise, Infector convert) BEFORE swaps, so the
  // spent flag is written under the current id and then travels with the role...
  let players = applyRaises(afterShots, used, liveSteps, log, events, state.round);
  const infected: PlayerId[] = [];
  players = applyConverts(players, used, roleState.drunkDisguise, liveSteps, infected, events, log, state.round);
  for (const id of infected) delete roleState.drunkPack[id]; // bitten for real: meets the real pack
  if (turned) {
    players = players.map((p) => (p.id === turned ? { ...p, roleId: "werewolf" } : p));
    infected.push(turned);
  }
  // ...then the Troublemaker swap carries all that role state to the new holder.
  players = applySwaps(players, roleState, liveSteps);
  // An apprentice whose master died (or was infected, or swapped away) takes over.
  const promotion = promoteSuccessors(players);
  players = promotion.players;

  const next: GameState = {
    ...state,
    ...roleState,
    players,
    drugged: targetsOf("block"), // the Poisoner's pick loses their power tomorrow night
    silenced: targetsOf("silence"), // the Gossip's mark: no talking or voting tomorrow
    night: null,
    log,
  };
  return announce({ ...next, notices: dawnNotices(state, next, infected, promotion.promoted) }, "dawn", events);
}

/**
 * What changed overnight for each player, told only to them: a new role (a
 * swap or an infection), coming back from the dead, a pack that grew or
 * shrank. Compared on the role each player *sees* (a Drunk's disguise), so
 * the notice never gives a Drunk away.
 */
function dawnNotices(
  before: GameState,
  after: GameState,
  infected: PlayerId[],
  promoted: PlayerId[]
): GameState["notices"] {
  const notices: GameState["notices"] = {};
  for (const p of after.players) {
    if (!p.alive) continue;
    const was = before.players.find((x) => x.id === p.id);
    const n: Notice = {};
    const roleNow = effectiveRoleId(after, p.id);
    if (roleNow && roleNow !== effectiveRoleId(before, p.id)) n.roleId = roleNow;
    if (infected.includes(p.id)) n.infected = true;
    if (promoted.includes(p.id)) n.promoted = true;
    if (was && !was.alive) n.raised = true;
    const pack = (s: GameState) => packmatesOf(s, p.id).join();
    if (!n.roleId && pack(before) !== pack(after)) n.packChanged = true;
    if (Object.keys(n).length) notices[p.id] = n;
  }
  return notices;
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
  used: GameState["used"];
  drunkDisguise: GameState["drunkDisguise"];
  drunkPack: GameState["drunkPack"];
  lastTarget: GameState["lastTarget"];
  hunterMark: GameState["hunterMark"];
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
      for (const map of Object.values(roleState)) swapEntry(map, sub.a, sub.b);
    }
  }
  return next;
}

/**
 * Hand a role on when nobody alive holds it: each living successor (the
 * Apprentice Seer) of a role with no living holder takes it up, one per role.
 */
function promoteSuccessors(players: Player[]): { players: Player[]; promoted: PlayerId[] } {
  let next = players;
  const promoted: PlayerId[] = [];
  for (const p of players) {
    const role = p.alive && p.roleId ? getRole(p.roleId).succeeds : undefined;
    if (!role || next.some((x) => x.alive && x.roleId === role)) continue;
    next = next.map((x) => (x.id === p.id ? { ...x, roleId: role } : x));
    promoted.push(p.id);
  }
  return { players: next, promoted };
}

/** Apply Medium raises, mutating the shared log, events and spent flags. */
function applyRaises(
  players: Player[],
  used: GameState["used"],
  steps: NightStep[],
  log: GameState["log"],
  events: AnnouncementEvent[],
  round: number
): Player[] {
  let next = players;
  for (const step of steps) {
    if (step.kind !== "raise") continue;
    for (const [actorId, sub] of Object.entries(step.subs)) {
      if (sub.t !== "raise" || sub.target === null || used[actorId]) continue;
      const target = next.find((p) => p.id === sub.target);
      if (!target || target.alive) continue;
      next = next.map((p) => (p.id === sub.target ? { ...p, alive: true } : p));
      used[actorId] = true;
      log.push({ type: "raised", round, playerId: sub.target });
      events.push({ t: "raised", playerId: sub.target });
    }
  }
  return next;
}

/**
 * Apply Infector conversions: a living non-wolf becomes a Werewolf, and the
 * Infector dies passing the curse on — the pack stays the same size.
 */
function applyConverts(
  players: Player[],
  used: GameState["used"],
  drunkDisguise: GameState["drunkDisguise"],
  steps: NightStep[],
  /** Collects who was infected, so they can be told at dawn. */
  infected: PlayerId[],
  events: AnnouncementEvent[],
  log: GameState["log"],
  round: number
): Player[] {
  let next = players;
  for (const step of steps) {
    if (step.kind !== "convert") continue;
    for (const [actorId, sub] of Object.entries(step.subs)) {
      if (sub.t !== "target" || used[actorId]) continue;
      const target = next.find((p) => p.id === sub.target);
      if (!target?.alive || (target.roleId && onWolfTeam(target.roleId))) continue;
      next = next.map((p) => (p.id === sub.target ? { ...p, roleId: "werewolf" } : p));
      // A converted Drunk becomes a real wolf — drop the fake disguise so it no
      // longer wakes as its old village role (and stops faking effects).
      delete drunkDisguise[sub.target];
      used[actorId] = true;
      infected.push(sub.target);
      if (next.find((p) => p.id === actorId)?.alive) {
        next = markDead(next, [actorId]).players;
        events.push({ t: "died", playerId: actorId });
        log.push({ type: "died", round, playerId: actorId });
      }
    }
  }
  return next;
}

/**
 * The order the town votes in today: every eligible voter, in an order
 * shuffled once per game (so joining last doesn't mean voting last), starting
 * one place further round it each day — going last (seeing every other vote)
 * shouldn't always fall to the same people.
 */
function voteOrderFor(state: GameState): PlayerId[] {
  const n = state.players.length;
  if (n === 0) return [];
  const order = shuffle(state.players, makeRng(state.seed));
  const start = (((state.round - 1) % n) + n) % n;
  const seats = [...order.slice(start), ...order.slice(0, start)];
  const eligible = new Set(eligibleVoters(state).map((p) => p.id));
  return seats.filter((p) => eligible.has(p.id)).map((p) => p.id);
}

/** Whose turn it is to vote, or null once everyone has. */
export function currentVoter(state: GameState): PlayerId | null {
  if (state.phase !== "dayVote") return null;
  return state.voteOrder.find((id) => !(id in state.votes)) ?? null;
}

function startVote(state: GameState): GameState {
  assert(state.phase === "dayDiscussion", "Not in day discussion.");
  return { ...state, phase: "dayVote", votes: {}, voteOrder: voteOrderFor(state) };
}

/**
 * Votes are cast one at a time, in order, and each is public the moment it's
 * cast: later voters vote knowing the earlier ones, as at a real table. Your
 * vote is final.
 */
function castVote(state: GameState, voterId: PlayerId, targetId: PlayerId | null): GameState {
  assert(state.phase === "dayVote", "Not voting.");
  const voter = playerById(state, voterId);
  assert(voter?.alive, "Dead players can't vote.");
  assert(!state.silenced.includes(voterId), "You've been silenced — no vote today.");
  assert(!(voterId in state.votes), "You've already voted.");
  const turn = currentVoter(state);
  assert(turn === voterId, `It's ${playerById(state, turn ?? "")?.name ?? "someone else"}'s turn to vote.`);
  if (targetId !== null) {
    assert(targetId !== voterId, "You can't vote for yourself.");
    const target = playerById(state, targetId);
    assert(target?.alive, "Can't vote for a dead player.");
  }
  return { ...state, votes: { ...state.votes, [voterId]: targetId } };
}

/** Host recovery: the voter whose turn it is has wandered off — record an abstain. */
function skipVoter(state: GameState): GameState {
  assert(state.phase === "dayVote", "Not voting.");
  const turn = currentVoter(state);
  assert(turn, "Everyone has voted.");
  return { ...state, votes: { ...state.votes, [turn]: null } };
}

/** Living players who are allowed to vote (silenced players sit the day out). */
export function eligibleVoters(state: GameState): Player[] {
  return living(state).filter((p) => !state.silenced.includes(p.id));
}

/** True once every eligible voter has cast (or skipped) a vote. */
export function allVotesIn(state: GameState): boolean {
  return eligibleVoters(state).every((p) => p.id in state.votes);
}

/**
 * Count the votes and apply the result — but don't move on yet. Everyone sees
 * an announcement of who went out (or that nobody did), any Hunter's shot, and
 * whether the game is over, until the host continues (proceed).
 */
function resolveVote(state: GameState): GameState {
  assert(state.phase === "dayVote", "Not voting.");
  // The ballot is open: keep who voted for whom, so the town can see it after.
  state = { ...state, voteHistory: [...state.voteHistory, { round: state.round, votes: state.votes }], votes: {} };
  const tally = new Map<PlayerId, number>();
  for (const target of Object.values(state.voteHistory.at(-1)!.votes)) {
    if (target === null) continue;
    tally.set(target, (tally.get(target) ?? 0) + 1);
  }

  const log = state.log.slice();
  if (tally.size === 0) {
    log.push({ type: "noDeath", round: state.round, cause: "lynch" });
    return announce({ ...state, log }, "vote", [{ t: "noVotes" }]);
  }
  const max = Math.max(...tally.values());
  const top = [...tally.entries()].filter(([, c]) => c === max);
  if (top.length > 1) {
    // Tie: no one is lynched. (Deliberate rule — keeps stalls harmless.)
    log.push({ type: "voteTie", round: state.round });
    return announce({ ...state, log }, "vote", [{ t: "tie" }]);
  }

  const lynchedId = top[0][0];
  const lynched = playerById(state, lynchedId)!;
  // The Prince's first trip to the gallows ends with a reveal and a reprieve.
  if (lynched.roleId && getRole(lynched.roleId).sparedOnFirstVote && !state.used[lynchedId]) {
    log.push({ type: "spared", round: state.round, playerId: lynchedId });
    return announce(
      { ...state, log, used: { ...state.used, [lynchedId]: true } },
      "vote",
      [{ t: "spared", playerId: lynchedId, roleId: lynched.roleId }]
    );
  }
  log.push({ type: "lynch", round: state.round, playerId: lynchedId });
  const events: AnnouncementEvent[] = [{ t: "votedOut", playerId: lynchedId }];
  // A lynched Tanner wins outright, before any Hunter shot or team check.
  if (lynched.roleId && getRole(lynched.roleId).winsIfLynched) {
    const { players } = markDead(state.players, [lynchedId]);
    return announce({ ...state, players, log }, "vote", events, lynchedId);
  }
  const { players, deadShooters } = markDead(state.players, [lynchedId]);
  // A lynched Hunter fires at last night's pick.
  const afterShots = fireDyingShots(players, deadShooters, state.hunterMark, events, log, state.round);
  // Lost the Seer to the vote? Their apprentice takes over, and is told so
  // privately (this morning's news is old by now).
  const promotion = promoteSuccessors(afterShots);
  const notices: GameState["notices"] = {};
  for (const id of promotion.promoted)
    notices[id] = { roleId: promotion.players.find((p) => p.id === id)!.roleId!, promoted: true };
  return announce({ ...state, players: promotion.players, log, notices }, "vote", events);
}

function finish(state: GameState, winner: Team, soloWinnerId: PlayerId | null = null): GameState {
  return {
    ...state,
    phase: "gameOver",
    winner,
    soloWinnerId,
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
      revealRoleOnDeath: false,
      nightSummary: "discreet",
      peacefulFirstNight: false,
    },
    round: 0,
    night: null,
    inspects: [],
    detections: [],
    silenced: [],
    used: {},
    drugged: [],
    ready: [],
    redeals: 0,
    announcement: null,
    notices: {},
    hunterMark: {},
    drunkDisguise: {},
    drunkPack: {},
    lastTarget: {},
    dealtRoles: [],
    chat: [],
    votes: {},
    voteOrder: [],
    voteHistory: [],
    witchPotions: {},
    log: [],
    seed,
    winner: null,
    soloWinnerId: null,
  };
}
