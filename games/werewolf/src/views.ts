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
  VoteRecord,
  Announcement,
  Notice,
  NightActionKind,
} from "./types.js";
import { getRole } from "./roles.js";
import { possibleRoles } from "./setup.js";
import {
  living,
  eligibleVoters,
  validNightTargets,
  effectiveRoleId,
  playerById,
  unackedNightResults,
  SKIPPABLE_KINDS,
  nightIdlers,
  currentVoter,
  packmatesOf,
} from "./engine.js";

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

/** A player as visible to someone else — role hidden unless it should be shown. */
export interface PublicPlayer {
  id: PlayerId;
  name: string;
  alive: boolean;
  isHost: boolean;
  connected: boolean;
  /** Revealed only when appropriate (self, fellow wolf, death reveal, game over). */
  roleId: string | null;
  /**
   * The role this player was dealt — shown only once the game is over, so the
   * reveal can say "Villager → Werewolf" for anyone swapped or infected.
   */
  dealtRoleId: string | null;
}

/** The role dealt to each player, by id — public only at game over. */
function dealtAtEnd(state: GameState): (id: PlayerId) => string | null {
  return (id) => {
    if (state.phase !== "gameOver") return null;
    const i = state.players.findIndex((p) => p.id === id);
    return state.dealtRoles[i] ?? null;
  };
}

export interface NightPrompt {
  kind: NightActionKind;
  roleId: string;
  /** Ids this player may target (for kill/protect/inspect, or the swap pool). */
  targetIds: PlayerId[];
  canTargetSelf: boolean;
  /** This power may be held for a later night (send nightSkip). */
  canSkip: boolean;
  /**
   * For the Witch only: what she may do this night. She is never told whom the
   * wolves picked — every night actor chooses blind, with no cross-player info.
   */
  witch?: {
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
  /**
   * You acted tonight and got a private result (a vision, a case reading) you
   * haven't dismissed yet. The night won't end until you do (send nightAck).
   */
  nightAwaitingAck: boolean;
  /**
   * For a living player with no power tonight: a decoy prompt that looks and
   * feels like a real one, so a busy phone gives nobody away. Picking does
   * nothing (send nightIdle); the night waits for it all the same.
   */
  idlePrompt: { targetIds: PlayerId[] } | null;
  /**
   * For a Hunter: who they'd take down with them right now (their latest
   * pick), or null. Only the Hunter sees it.
   */
  myMark: PlayerId | null;
  /** Your seer inspections across all rounds (only yours). */
  myInspects: InspectResult[];
  /** Your detective readings across all rounds (only yours). */
  myDetections: DetectionResult[];
  /** Who has read their role card (phase "roleReveal"; public — everyone has a card). */
  ready: PlayerId[];
  /** Players silenced for the current day (public — they can't vote). */
  silencedIds: PlayerId[];
  /** Your current vote this round (undefined if not cast). */
  myVote?: PlayerId | null;
  /** The town's recent talk (public, oldest first). Capped for payload size. */
  chat: ChatMessage[];
  /** Live vote tally during the day vote (public). */
  voteTally: Record<PlayerId, number>;
  /** Today's voting order (public). Votes are cast one at a time, in this order. */
  voteOrder: PlayerId[];
  /** Whose turn it is to vote, or null (public). */
  voteTurn: PlayerId | null;
  /** Who has voted for whom so far today (public — votes are open). */
  votes: Record<PlayerId, PlayerId | null>;
  /** Every past day's ballot, voter by voter (public). */
  voteHistory: VoteRecord[];
  /** What's being announced (phase "announce"): the dawn, or a vote's result. Public. */
  announcement: Announcement | null;
  /**
   * What changed for you overnight (only yours), shown with the dawn
   * announcement. Null when nothing did — everyone sees a private section either way.
   */
  myNotice: Notice | null;
  votesRemaining: number;
  log: LogEntry[];
  winner: Team | null;
  /** The player who won a solo victory (e.g. a lynched Tanner), if any. */
  soloWinnerId: PlayerId | null;
  config: GameConfig;
  /** Every role that could be in this game (no counts, no owners). Public. */
  possibleRoles: string[];
}

/**
 * Players as visible on a SHARED/public screen (pass-the-device day board,
 * night intro): living roles are always hidden; only dead (if configured) or
 * end-of-game roles are shown. Never tied to any single viewer, so it can't
 * leak a werewolf's knowledge of the pack to onlookers.
 */
export function publicPlayers(state: GameState): PublicPlayer[] {
  const revealAll = state.phase === "gameOver";
  const dealt = dealtAtEnd(state);
  return state.players.map((p) => ({
    id: p.id,
    name: p.name,
    alive: p.alive,
    isHost: p.isHost,
    connected: p.connected,
    roleId:
      revealAll || (!p.alive && state.config.revealRoleOnDeath) ? p.roleId : null,
    dealtRoleId: dealt(p.id),
  }));
}

/**
 * An announcement as the whole table may hear it. With saves kept discreet, a
 * save reads as a quiet night — at the data level, so nothing leaves the
 * server that would reveal a doctor (the same rule as publicLog).
 */
function publicAnnouncement(state: GameState): Announcement | null {
  const a = state.announcement;
  if (!a || state.config.nightSummary === "detailed") return a;
  return { ...a, events: a.events.map((e) => (e.t === "saved" ? { t: "quiet" as const } : e)) };
}

function roleVisibleTo(state: GameState, targetId: PlayerId, viewerId: PlayerId): boolean {
  if (targetId === viewerId) return true;
  if (state.phase === "gameOver") return true;
  const target = playerById(state, targetId);
  const viewer = playerById(state, viewerId);
  if (!target?.roleId || !viewer) return false;
  // Dead players' roles are shown to all if configured.
  if (!target.alive && state.config.revealRoleOnDeath) return true;
  // The wolf team knows each other.
  return packmatesOf(state, viewerId).includes(targetId);
}

export function projectView(state: GameState, viewerId: PlayerId): PlayerView {
  const you = playerById(state, viewerId);
  if (!you) throw new Error(`No such player: ${viewerId}`);

  // The Drunk is shown its disguised role and never learns the truth (until the end).
  const displayRoleId =
    state.phase !== "gameOver" ? effectiveRoleId(state, viewerId) : you.roleId;

  const players: PublicPlayer[] = publicPlayers(state).map((pub, i) => ({
    ...pub,
    roleId: !roleVisibleTo(state, pub.id, viewerId)
      ? null
      : pub.id === viewerId
        ? displayRoleId // keep the disguise consistent with the role card
        : state.players[i].roleId,
  }));

  // Night prompt. Built ONLY from the viewer's own step and public state: no
  // other actor's choice, progress or timing ever reaches it, so nobody can
  // read the wolves' pick (or whether they've picked) off their own screen.
  let nightPrompt: NightPrompt | null = null;
  let nightAwaitingAck = false;
  let idlePrompt: PlayerView["idlePrompt"] = null;
  if (state.phase === "night" && state.night) {
    nightAwaitingAck = unackedNightResults(state).includes(viewerId);
    if (nightIdlers(state).some((p) => p.id === viewerId) && !state.night.idleDone.includes(viewerId))
      idlePrompt = { targetIds: living(state).filter((p) => p.id !== viewerId).map((p) => p.id) };
    const myStep = state.night.steps.find((s) => s.actorIds.includes(viewerId));
    if (myStep && you.alive && !(viewerId in myStep.subs)) {
      const ability = getRole(effectiveRoleId(state, viewerId)!).night!;
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
        canSkip: SKIPPABLE_KINDS.includes(myStep.kind),
        witch:
          myStep.kind === "witch"
            ? {
                healAvailable: !!state.witchPotions[viewerId]?.heal,
                poisonAvailable: !!state.witchPotions[viewerId]?.poison,
              }
            : undefined,
      };
    }
  }

  const myMark = state.hunterMark[viewerId] ?? null;

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
    packmates: packmatesOf(state, viewerId),
    nightPrompt,
    nightAwaitingAck,
    idlePrompt,
    myMark,
    myInspects,
    myDetections,
    ready: state.phase === "roleReveal" ? [...state.ready] : [],
    // Only surface silenced players who are still alive (a silenced-then-killed
    // player shouldn't linger on the day board).
    silencedIds: state.silenced.filter((id) => playerById(state, id)?.alive),
    myVote: viewerId in state.votes ? state.votes[viewerId] : undefined,
    chat: state.chat.slice(-CHAT_IN_VIEW),
    voteTally,
    voteOrder: state.phase === "dayVote" ? state.voteOrder : [],
    voteTurn: currentVoter(state),
    votes: state.phase === "dayVote" ? { ...state.votes } : {},
    voteHistory: state.voteHistory,
    announcement: publicAnnouncement(state),
    myNotice: state.notices[viewerId] ?? null,
    votesRemaining,
    log: publicLog(state),
    winner: state.winner,
    soloWinnerId: state.soloWinnerId,
    config: state.config,
    possibleRoles: possibleRoles(state.config, state.players.length),
  };
}
