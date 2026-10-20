import type { PlayerId } from "./types.js";

/**
 * The moves a device can make in a Werewolf game. They travel inside the
 * platform's `act` message; the room plumbing (joining, the lobby, starting,
 * rematches) is the platform's and lives in @party/core. The pass-the-device
 * client talks to the engine directly and never uses these.
 */
export type WerewolfAction =
  | { type: "startNight" }
  | { type: "nightChoice"; targetId: PlayerId }
  | { type: "witchAction"; healTargetId: PlayerId | null; poisonTargetId: PlayerId | null }
  | { type: "swapAction"; aId: PlayerId; bId: PlayerId }
  | { type: "detectAction"; aId: PlayerId; bId: PlayerId }
  | { type: "raiseAction"; targetId: PlayerId | null }
  | { type: "nightAck" }
  | { type: "endNight" }
  | { type: "startVote" }
  | { type: "castVote"; targetId: PlayerId | null }
  | { type: "resolveVote" }
  | { type: "shoot"; targetId: PlayerId }
  | { type: "skipShot" }
  | { type: "say"; text: string };
