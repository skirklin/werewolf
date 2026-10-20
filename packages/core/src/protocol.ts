import type { RosterEntry } from "./module.js";

/**
 * The wire protocol between a device and a room. The room's own messages are
 * spelled out here; a game's moves travel inside `act` and only the game's
 * module knows their shape.
 */

/** Room codes are letters only, so a phone keyboard never has to switch modes. */
export const ROOM_CODE_LENGTH = 4;

export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH);
}

/** What everyone in a room can see about the room itself. */
export interface RoomInfo {
  code: string;
  /** The game module's id. */
  game: string;
  phase: "lobby" | "playing";
  /** True once the current game has finished. */
  over: boolean;
  players: RosterEntry[];
  /** The last game's config, so the host can deal again without redoing it. */
  config: unknown;
}

/** Messages a device sends. */
export type ClientMessage =
  | { type: "createRoom"; game: string; name: string }
  | { type: "joinRoom"; code: string; name: string }
  | { type: "rejoin"; code: string; playerId: string; token: string }
  | { type: "kick"; playerId: string }
  | { type: "startGame"; config: unknown }
  /** After a game ends: back to the lobby with the same room and roster. */
  | { type: "playAgain" }
  /** Leaving on purpose (not just a dropped connection): frees a lobby seat. */
  | { type: "leave" }
  | { type: "act"; action: unknown };

/** Messages the server sends. `View` is the game's per-seat view. */
export type ServerMessage<View = unknown> =
  /**
   * Sent as each connection opens. `build` identifies the client bundle this
   * server shipped (null in dev); a page running a different one is stale and
   * should reload before it sends moves the server no longer understands.
   */
  | { type: "hello"; build: string | null }
  /** This page is an old build; the server won't talk to it. Reload. */
  | { type: "outdated"; build: string }
  | { type: "joined"; playerId: string; token: string; code: string; game: string }
  | { type: "room"; room: RoomInfo }
  | { type: "view"; view: View }
  | { type: "error"; message: string };
