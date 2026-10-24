import type { PlayerId } from "./types.js";

/**
 * The moves a device can make in a Werewolf game. They travel inside the
 * platform's `act` message; the room plumbing (joining, the lobby, starting,
 * rematches) is the platform's and lives in @party/core. The pass-the-device
 * client talks to the engine directly and never uses these.
 */
export type WerewolfAction =
  | { type: "startNight" } // host: start without waiting for everyone to be ready
  | { type: "ready" } // I've read my role card
  | { type: "nightChoice"; targetId: PlayerId }
  /** `heal`: save whoever the wolves attack tonight (the Witch never learns who). */
  | { type: "witchAction"; heal: boolean; poisonTargetId: PlayerId | null }
  /** Hold an optional one-time power (Troublemaker, Infector) for another night. */
  | { type: "nightSkip" }
  | { type: "swapAction"; aId: PlayerId; bId: PlayerId }
  | { type: "detectAction"; aId: PlayerId; bId: PlayerId }
  | { type: "raiseAction"; targetId: PlayerId | null }
  | { type: "nightAck" }
  /** A player with no power tonight taps through their decoy prompt. */
  | { type: "nightIdle"; targetId: PlayerId }
  | { type: "endNight" }
  | { type: "startVote" }
  | { type: "castVote"; targetId: PlayerId | null }
  | { type: "skipVoter" }
  | { type: "resolveVote" }
  /** Host: move the table on from an announcement (dawn, or a vote's result). */
  | { type: "proceed" }
  | { type: "redeal" } // host: start over with a fresh deal
  | { type: "say"; text: string };
