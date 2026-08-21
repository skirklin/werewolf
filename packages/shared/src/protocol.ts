import type { GameConfig, PlayerId } from "./types.js";
import type { PlayerView } from "./views.js";

/**
 * Wire protocol for multi-device play. The pass-the-device client talks to the
 * engine directly and never uses these; only the WebSocket transport does.
 */

/** Room codes are letters only, so a phone keyboard never has to switch modes. */
export const ROOM_CODE_LENGTH = 4;

export function normalizeRoomCode(raw: string): string {
  return raw.toUpperCase().replace(/[^A-Z]/g, "").slice(0, ROOM_CODE_LENGTH);
}

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
  | { type: "witchAction"; save: boolean; poisonTargetId: PlayerId | null }
  | { type: "swapAction"; aId: PlayerId; bId: PlayerId }
  | { type: "detectAction"; aId: PlayerId; bId: PlayerId }
  | { type: "raiseAction"; targetId: PlayerId | null }
  | { type: "endNight" }
  | { type: "startVote" }
  | { type: "castVote"; targetId: PlayerId | null }
  | { type: "resolveVote" }
  | { type: "shoot"; targetId: PlayerId }
  | { type: "skipShot" }
  | { type: "kick"; playerId: PlayerId }
  | { type: "playAgain" };

/** Messages the server sends to a client. */
export type ServerMessage =
  | { type: "joined"; playerId: PlayerId; token: string; code: string }
  | { type: "view"; view: PlayerView }
  | { type: "error"; message: string };
