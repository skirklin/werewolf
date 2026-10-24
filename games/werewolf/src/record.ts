import type { GameState, LogEntry, PlayerId, Team } from "./types.js";
import { ROLES } from "./roles.js";
import { wonGame } from "./engine.js";

/**
 * The anonymous record of a finished game, kept so we can answer questions like
 * "how often does the village win?" or "is the Tanner hopeless?".
 *
 * Everything that identifies a person or a session is dropped on the way in:
 * no names, no player ids (seats are plain indices), no room code, no seed.
 * What's left is the shape of the game — who was dealt what, who survived, who
 * won, and the beat-by-beat timeline.
 */
export const GAME_RECORD_VERSION = 2;

/**
 * Where the game came from. "online" and "local" are people playing; "agent" is
 * the arena, kept separate so bot games never muddy the house numbers.
 */
export type GameMode = "online" | "local" | "agent";

/** One seat's story, with the person behind it removed. */
export interface SeatRecord {
  /** The role this seat was dealt at the start. */
  dealt: string;
  /** The role it held at the end — swaps and conversions move roles around. */
  final: string;
  /** The role a Drunk secretly believed they had, if this seat was the Drunk. */
  disguise: string | null;
  survived: boolean;
  won: boolean;
  /**
   * The strategy that played this seat, for arena games. Null for people —
   * naming a human player is exactly what this record exists not to do.
   */
  agent: string | null;
  /** How many times this seat spoke. The words themselves are never kept. */
  said: number;
}

/**
 * One beat of the game's timeline. A flattened `LogEntry`: player ids become
 * seat numbers, and the entry's one qualifier (death cause, winning team) is
 * folded into `detail`.
 */
export interface RecordEvent {
  type: LogEntry["type"];
  round: number;
  /** The seat this beat is about, when it's about someone in particular. */
  seat?: number;
  detail?: string;
}

export interface RecordConfig {
  selectionMode: "exact" | "pool";
  revealRoleOnDeath: boolean;
  nightSummary: "discreet" | "detailed";
  peacefulFirstNight: boolean;
}

export interface GameRecord {
  v: number;
  /** When the game finished. Always stamped by the server, never the client. */
  finishedAt: string;
  mode: GameMode;
  playerCount: number;
  rounds: number;
  winner: Team;
  /** The role that won alone (a lynched Tanner), if the win was a solo one. */
  soloWinnerRole: string | null;
  config: RecordConfig;
  seats: SeatRecord[];
  events: RecordEvent[];
}

/** Ceilings that keep a single record small enough to store and cheap to parse. */
const MAX_PLAYERS = 30;
const MAX_ROUNDS = 200;
const MAX_EVENTS = 2000;
const MAX_AGENT_NAME = 40;
const TEAMS: Team[] = ["village", "werewolf", "solo"];
const MODES: GameMode[] = ["online", "local", "agent"];

/**
 * Build the record for a finished game. Returns null while a game is still
 * running, so callers can hand it any state without checking first.
 */
export function toGameRecord(state: GameState, mode: GameMode): GameRecord | null {
  if (state.phase !== "gameOver" || !state.winner) return null;
  const winner = state.winner;
  const seatOf = new Map<PlayerId, number>(state.players.map((p, i) => [p.id, i]));

  const said = new Map<PlayerId, number>();
  for (const msg of state.chat) said.set(msg.playerId, (said.get(msg.playerId) ?? 0) + 1);

  const seats: SeatRecord[] = state.players.map((p, i) => {
    const final = p.roleId ?? "villager";
    return {
      dealt: state.dealtRoles[i] ?? final,
      final,
      disguise: state.drunkDisguise[p.id] ?? null,
      survived: p.alive,
      won: wonGame(p, winner, state.soloWinnerId),
      agent: null, // the arena labels its own seats after the fact
      said: said.get(p.id) ?? 0,
    };
  });

  const soloWinner = state.soloWinnerId
    ? state.players.find((p) => p.id === state.soloWinnerId)
    : undefined;

  return {
    v: GAME_RECORD_VERSION,
    finishedAt: "", // stamped on arrival at the server
    mode,
    playerCount: state.players.length,
    rounds: state.round,
    winner,
    soloWinnerRole: soloWinner?.roleId ?? null,
    config: {
      selectionMode: state.config.selection.mode,
      revealRoleOnDeath: state.config.revealRoleOnDeath,
      nightSummary: state.config.nightSummary,
      peacefulFirstNight: state.config.peacefulFirstNight,
    },
    seats,
    events: state.log.slice(0, MAX_EVENTS).map((e) => toEvent(e, seatOf)),
  };
}

function toEvent(entry: LogEntry, seatOf: Map<PlayerId, number>): RecordEvent {
  const event: RecordEvent = { type: entry.type, round: entry.round };
  if ("playerId" in entry) event.seat = seatOf.get(entry.playerId);
  if ("cause" in entry) event.detail = entry.cause;
  if (entry.type === "gameOver") event.detail = entry.winner;
  return event;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

/**
 * Parse an untrusted record (the pass-the-device client posts its own), keeping
 * only what is well-formed. Returns null on anything the shape doesn't allow —
 * unknown roles, impossible counts, oversized arrays — so a hostile body can't
 * poison the numbers or bloat the store.
 */
export function parseGameRecord(raw: unknown): GameRecord | null {
  if (!isObject(raw)) return null;
  // v1 predates strategy labels and speech counts; those seats read as blank.
  if (raw.v !== 1 && raw.v !== GAME_RECORD_VERSION) return null;
  if (!MODES.includes(raw.mode as GameMode)) return null;

  const playerCount = asInt(raw.playerCount, 3, MAX_PLAYERS);
  const rounds = asInt(raw.rounds, 0, MAX_ROUNDS);
  if (playerCount === null || rounds === null) return null;
  if (!TEAMS.includes(raw.winner as Team)) return null;
  if (raw.soloWinnerRole !== null && !isRoleId(raw.soloWinnerRole)) return null;

  const config = parseConfig(raw.config);
  if (!config) return null;

  if (!Array.isArray(raw.seats) || raw.seats.length !== playerCount) return null;
  const seats: SeatRecord[] = [];
  for (const s of raw.seats) {
    if (!isObject(s)) return null;
    if (!isRoleId(s.dealt) || !isRoleId(s.final)) return null;
    if (s.disguise !== null && !isRoleId(s.disguise)) return null;
    if (typeof s.survived !== "boolean" || typeof s.won !== "boolean") return null;
    if (s.agent !== undefined && s.agent !== null) {
      if (typeof s.agent !== "string" || s.agent.length > MAX_AGENT_NAME) return null;
    }
    const spoke = s.said === undefined ? 0 : asInt(s.said, 0, MAX_EVENTS);
    if (spoke === null) return null;
    seats.push({
      dealt: s.dealt,
      final: s.final,
      disguise: s.disguise as string | null,
      survived: s.survived,
      won: s.won,
      agent: (s.agent as string | null) ?? null,
      said: spoke,
    });
  }

  if (!Array.isArray(raw.events) || raw.events.length > MAX_EVENTS) return null;
  const events: RecordEvent[] = [];
  for (const e of raw.events) {
    if (!isObject(e)) return null;
    if (typeof e.type !== "string" || e.type.length > 24) return null;
    const round = asInt(e.round, 0, MAX_ROUNDS);
    if (round === null) return null;
    const event: RecordEvent = { type: e.type as LogEntry["type"], round };
    if (e.seat !== undefined) {
      const seat = asInt(e.seat, 0, playerCount - 1);
      if (seat === null) return null;
      event.seat = seat;
    }
    if (e.detail !== undefined) {
      if (typeof e.detail !== "string" || e.detail.length > 24) return null;
      event.detail = e.detail;
    }
    events.push(event);
  }

  return {
    v: GAME_RECORD_VERSION,
    finishedAt: typeof raw.finishedAt === "string" ? raw.finishedAt : "",
    mode: raw.mode as GameMode,
    playerCount,
    rounds,
    winner: raw.winner as Team,
    soloWinnerRole: (raw.soloWinnerRole as string | null) ?? null,
    config,
    seats,
    events,
  };
}

function parseConfig(raw: unknown): RecordConfig | null {
  if (!isObject(raw)) return null;
  if (raw.selectionMode !== "exact" && raw.selectionMode !== "pool") return null;
  if (raw.nightSummary !== "discreet" && raw.nightSummary !== "detailed") return null;
  if (typeof raw.revealRoleOnDeath !== "boolean") return null;
  if (typeof raw.peacefulFirstNight !== "boolean") return null;
  return {
    selectionMode: raw.selectionMode,
    revealRoleOnDeath: raw.revealRoleOnDeath,
    nightSummary: raw.nightSummary,
    peacefulFirstNight: raw.peacefulFirstNight,
  };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

function isRoleId(v: unknown): v is string {
  return typeof v === "string" && Object.hasOwn(ROLES, v);
}

function asInt(v: unknown, lo: number, hi: number): number | null {
  return typeof v === "number" && Number.isInteger(v) && v >= lo && v <= hi ? v : null;
}
