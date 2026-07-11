import type { GameConfig, PlayerId } from "./types.js";
import type { PlayerView } from "./views.js";

/**
 * Wire protocol for multi-device play. The pass-the-device client talks to the
 * engine directly and never uses these; only the WebSocket transport does.
 */

export interface RoomSummary {
  code: string;
  players: { id: PlayerId; name: string; isHost: boolean; connected: boolean }[];
  phase: string;
  playerCount: number;
}

/** Messages a client sends to the server. */
export type ClientMessage =
  | { type: "createRoom"; name: string }
  | { type: "joinRoom"; code: string; name: string }
  | { type: "rejoin"; code: string; playerId: PlayerId; token: string }
  | { type: "startGame"; config: GameConfig }
  | { type: "startNight" }
  | { type: "nightChoice"; targetId: PlayerId }
  | { type: "endNight" }
  | { type: "startVote" }
  | { type: "castVote"; targetId: PlayerId | null }
  | { type: "resolveVote" }
  | { type: "kick"; playerId: PlayerId };

/** Messages the server sends to a client. */
export type ServerMessage =
  | { type: "joined"; playerId: PlayerId; token: string; code: string }
  | { type: "view"; view: PlayerView }
  | { type: "error"; message: string };
