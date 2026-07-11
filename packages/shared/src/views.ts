import type {
  GameState,
  PlayerId,
  Phase,
  Team,
  GameConfig,
  LogEntry,
  InspectResult,
} from "./types.js";

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
import { living, validNightTargets, playerById } from "./engine.js";

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
  kind: "kill" | "protect" | "inspect";
  roleId: string;
  /** Ids this player may target. */
  targetIds: PlayerId[];
  canTargetSelf: boolean;
  /** For pack (werewolf) steps: live tally of pack picks by targetId. */
  groupChoices?: Record<PlayerId, number>;
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
  /** Your seer inspections across all rounds (only yours). */
  myInspects: InspectResult[];
  /** Your current vote this round (undefined if not cast). */
  myVote?: PlayerId | null;
  /** Live vote tally during the day vote (public). */
  voteTally: Record<PlayerId, number>;
  votesRemaining: number;
  log: LogEntry[];
  winner: Team | null;
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

  const players: PublicPlayer[] = state.players.map((p) => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    isHost: p.isHost,
    connected: p.connected,
    roleId: roleVisibleTo(state, p.id, viewerId) ? p.roleId : null,
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
        if (!(actorId in step.choices)) nightWaitingOn++;
      }
    }
    const myStep = state.night.steps.find((s) => s.actorIds.includes(viewerId));
    if (myStep && you.alive && !(viewerId in myStep.choices)) {
      const ability = getRole(you.roleId!).night!;
      const groupChoices = myStep.group
        ? Object.values(myStep.choices).reduce<Record<PlayerId, number>>((acc, t) => {
            acc[t] = (acc[t] ?? 0) + 1;
            return acc;
          }, {})
        : undefined;
      nightPrompt = {
        kind: myStep.kind,
        roleId: myStep.roleId,
        targetIds: validNightTargets(state, viewerId).map((p) => p.id),
        canTargetSelf: !!ability.canTargetSelf,
        groupChoices,
      };
    }
  }

  const myInspects = state.inspects.filter((r) => r.seerId === viewerId);

  const voteTally: Record<PlayerId, number> = {};
  for (const t of Object.values(state.votes)) {
    if (t !== null) voteTally[t] = (voteTally[t] ?? 0) + 1;
  }
  const votesRemaining =
    state.phase === "dayVote"
      ? living(state).filter((p) => !(p.id in state.votes)).length
      : 0;

  return {
    code: state.code,
    phase: state.phase,
    round: state.round,
    you: {
      id: you.id,
      name: you.name,
      roleId: you.roleId,
      alive: you.alive,
      isHost: you.isHost,
    },
    players,
    packmates,
    nightPrompt,
    nightWaitingOn,
    myInspects,
    myVote: viewerId in state.votes ? state.votes[viewerId] : undefined,
    voteTally,
    votesRemaining,
    log: publicLog(state),
    winner: state.winner,
    config: state.config,
  };
}
