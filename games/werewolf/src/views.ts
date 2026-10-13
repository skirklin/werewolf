import type {
  GameState,
  PlayerId,
  Phase,
  Team,
  GameConfig,
  LogEntry,
  InspectResult,
  DetectionResult,
  ChatMessage,
} from "./types.js";

/**
 * How much of the transcript rides along in every view. The whole thing is
 * public, but it's broadcast on each action, so only the recent tail is sent.
 */
const CHAT_IN_VIEW = 100;

/**
 * The log as safe to show anyone. In "discreet" mode a protected kill is
 * rewritten to a quiet night at the DATA level (not just the wording), so the
 * revealing entry never leaves the server and a doctor stays hidden.
 */
export function publicLog(state: GameState): LogEntry[] {
  if (state.config.nightSummary === "detailed") return state.log;
  return state.log.map((e): LogEntry =>
    e.type === "saved" ? { type: "noDeath", round: e.round, cause: "wolves" } : e
  );
}
import { getRole } from "./roles.js";
import { living, eligibleVoters, validNightTargets, validShootTargets, wolfVictim, effectiveRoleId, playerById } from "./engine.js";
import type { NightActionKind, NightStep } from "./types.js";

/** Tally of pack picks by targetId (for the werewolves' shared view). */
function stepTargetTally(step: NightStep): Record<PlayerId, number> {
  const tally: Record<PlayerId, number> = {};
  for (const sub of Object.values(step.subs)) {
    if (sub.t === "target") tally[sub.target] = (tally[sub.target] ?? 0) + 1;
  }
  return tally;
}

/** A player as visible to someone else — role hidden unless it should be shown. */
export interface PublicPlayer {
  id: PlayerId;
  name: string;
  alive: boolean;
  isHost: boolean;
  connected: boolean;
  /** Revealed only when appropriate (self, fellow wolf, death reveal, game over). */
  roleId: string | null;
}

export interface NightPrompt {
  kind: NightActionKind;
  roleId: string;
  /** Ids this player may target (for kill/protect/inspect, or the swap pool). */
  targetIds: PlayerId[];
  canTargetSelf: boolean;
  /** For pack (werewolf) steps: live tally of pack picks by targetId. */
  groupChoices?: Record<PlayerId, number>;
  /** For the Witch only: what she may do this night. */
  witch?: {
    /** The wolves' victim this night (null if the wolves haven't chosen yet). */
    victimId: PlayerId | null;
    healAvailable: boolean;
    poisonAvailable: boolean;
  };
}

/** The redacted, per-player snapshot sent to a single device. */
export interface PlayerView {
  code: string;
  phase: Phase;
  round: number;
  you: {
    id: PlayerId;
    name: string;
    roleId: string | null;
    alive: boolean;
    isHost: boolean;
  };
  players: PublicPlayer[];
  /** Ids of your fellow werewolves (only if you are one). */
  packmates: PlayerId[];
  /** Your night action, if it's your turn and you haven't acted. */
  nightPrompt: NightPrompt | null;
  /** Number of night actors across the table still to submit. */
  nightWaitingOn: number;
  /** If you are a fallen Hunter whose dying shot is pending, who you may hit. */
  shootPrompt: { targetIds: PlayerId[] } | null;
  /** Your seer inspections across all rounds (only yours). */
  myInspects: InspectResult[];
  /** Your detective readings across all rounds (only yours). */
  myDetections: DetectionResult[];
  /** Players silenced for the current day (public — they can't vote). */
  silencedIds: PlayerId[];
  /** Your current vote this round (undefined if not cast). */
  myVote?: PlayerId | null;
  /** The town's recent talk (public, oldest first). Capped for payload size. */
  chat: ChatMessage[];
  /** Live vote tally during the day vote (public). */
  voteTally: Record<PlayerId, number>;
  votesRemaining: number;
  log: LogEntry[];
  winner: Team | null;
  /** The player who won a solo victory (e.g. a lynched Tanner), if any. */
  soloWinnerId: PlayerId | null;
  config: GameConfig;
}

/**
 * Players as visible on a SHARED/public screen (pass-the-device day board,
 * night intro): living roles are always hidden; only dead (if configured) or
 * end-of-game roles are shown. Never tied to any single viewer, so it can't
 * leak a werewolf's knowledge of the pack to onlookers.
 */
export function publicPlayers(state: GameState): PublicPlayer[] {
  const revealAll = state.phase === "gameOver";
  return state.players.map((p) => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    isHost: p.isHost,
    connected: p.connected,
    roleId:
      revealAll || (!p.alive && state.config.revealRoleOnDeath) ? p.roleId : null,
  }));
}

function roleVisibleTo(state: GameState, targetId: PlayerId, viewerId: PlayerId): boolean {
  if (targetId === viewerId) return true;
  if (state.phase === "gameOver") return true;
  const target = playerById(state, targetId);
  const viewer = playerById(state, viewerId);
  if (!target?.roleId || !viewer) return false;
  // Dead players' roles are shown to all if configured.
  if (!target.alive && state.config.revealRoleOnDeath) return true;
  // Werewolves recognise each other.
  if (
    viewer.roleId &&
    getRole(viewer.roleId).team === "werewolf" &&
    getRole(target.roleId).team === "werewolf"
  )
    return true;
  return false;
}

export function projectView(state: GameState, viewerId: PlayerId): PlayerView {
  const you = playerById(state, viewerId);
  if (!you) throw new Error(`No such player: ${viewerId}`);

  // The Drunk is shown its disguised role and never learns the truth (until the end).
  const displayRoleId =
    state.phase !== "gameOver" ? effectiveRoleId(state, viewerId) : you.roleId;

  const players: PublicPlayer[] = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    isHost: p.isHost,
    connected: p.connected,
    roleId: !roleVisibleTo(state, p.id, viewerId)
      ? null
      : p.id === viewerId
        ? displayRoleId // keep the disguise consistent with the role card
        : p.roleId,
  }));

  const packmates =
    you.roleId && getRole(you.roleId).team === "werewolf"
      ? state.players
          .filter(
            (p) =>
              p.id !== viewerId && p.roleId && getRole(p.roleId).team === "werewolf"
          )
          .map((p) => p.id)
      : [];

  // Night prompt + waiting count.
  let nightPrompt: NightPrompt | null = null;
  let nightWaitingOn = 0;
  if (state.phase === "night" && state.night) {
    for (const step of state.night.steps) {
      for (const actorId of step.actorIds) {
        if (!(actorId in step.subs)) nightWaitingOn++;
      }
    }
    const killStep = state.night.steps.find((s) => s.kind === "kill");
    const killReady = !killStep || killStep.done;
    const myStep = state.night.steps.find((s) => s.actorIds.includes(viewerId));
    // The Witch must wait for the wolves before her prompt appears.
    const witchReady = myStep?.kind !== "witch" || killReady;
    if (myStep && you.alive && !(viewerId in myStep.subs) && witchReady) {
      const ability = getRole(effectiveRoleId(state, viewerId)!).night!;
      const groupChoices = myStep.group
        ? stepTargetTally(myStep)
        : undefined;
      nightPrompt = {
        kind: myStep.kind,
        // myStep.roleId is already the effective (disguised) role, so a Drunk
        // sees itself acting as the role it impersonates.
        roleId: myStep.roleId,
        targetIds:
          myStep.kind === "witch" || myStep.kind === "swap" || myStep.kind === "detect"
            ? living(state).filter((p) => p.id !== viewerId).map((p) => p.id)
            : myStep.kind === "raise"
              ? state.players.filter((p) => !p.alive).map((p) => p.id) // dead players to raise
              : validNightTargets(state, viewerId).map((p) => p.id),
        canTargetSelf: !!ability.canTargetSelf,
        groupChoices,
        witch:
          myStep.kind === "witch"
            ? {
                victimId: wolfVictim(state),
                healAvailable: !!state.witchPotions[viewerId]?.heal,
                poisonAvailable: !!state.witchPotions[viewerId]?.poison,
              }
            : undefined,
      };
    }
  }

  // A fallen Hunter at the front of the queue gets to take their shot.
  const shootPrompt =
    state.phase === "hunterShot" && state.pendingShots[0] === viewerId
      ? { targetIds: validShootTargets(state).map((p) => p.id) }
      : null;

  const myInspects = state.inspects.filter((r) => r.seerId === viewerId);
  const myDetections = state.detections.filter((r) => r.detectiveId === viewerId);

  const voteTally: Record<PlayerId, number> = {};
  for (const t of Object.values(state.votes)) {
    if (t !== null) voteTally[t] = (voteTally[t] ?? 0) + 1;
  }
  const votesRemaining =
    state.phase === "dayVote"
      ? eligibleVoters(state).filter((p) => !(p.id in state.votes)).length
      : 0;

  return {
    code: state.code,
    phase: state.phase,
    round: state.round,
    you: {
      id: you.id,
      name: you.name,
      roleId: displayRoleId,
      alive: you.alive,
      isHost: you.isHost,
    },
    players,
    packmates,
    nightPrompt,
    nightWaitingOn,
    shootPrompt,
    myInspects,
    myDetections,
    // Only surface silenced players who are still alive (a silenced-then-killed
    // player shouldn't linger on the day board).
    silencedIds: state.silenced.filter((id) => playerById(state, id)?.alive),
    myVote: viewerId in state.votes ? state.votes[viewerId] : undefined,
    chat: state.chat.slice(-CHAT_IN_VIEW),
    voteTally,
    votesRemaining,
    log: publicLog(state),
    winner: state.winner,
    soloWinnerId: state.soloWinnerId,
    config: state.config,
  };
}
