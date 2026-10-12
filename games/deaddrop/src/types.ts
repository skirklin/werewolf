/**
 * Core types for Dead Drop: a deduction game where a mole passed secrets to a
 * handler during an evening reception, and the players trade intelligence to
 * work out who did it, how, where and when.
 *
 * Everything here is plain data so a whole scenario can be serialised, sent
 * over the wire, and replayed from its seed.
 */

/** Indices into the dossier's lists. */
export type AgentId = number;
export type RoomId = number;
export type DeviceId = number;
/** Index into `Dossier.hours`. Earlier hours have lower indices. */
export type Hour = number;

export interface TraitValue {
  id: string;
  label: string;
  /** Completes "The mole …", e.g. "wears a beret". */
  phrase: string;
  /** Completes "The mole …" in the negative, e.g. "does not wear a beret". */
  negPhrase: string;
  /** Completes "Nobody who …", e.g. "wore a beret". */
  pastPhrase: string;
}

/** A visible characteristic of every agent: headwear, coat colour, … */
export interface TraitDef {
  id: string;
  label: string;
  values: TraitValue[];
}

export interface Agent {
  id: AgentId;
  name: string;
  /** trait id → value id. Every agent has a value for every trait. */
  traits: Record<string, string>;
}

/** A property a room has or lacks: outdoors, crowded, … */
export interface FeatureDef {
  id: string;
  label: string;
  /** Completes "The handoff happened somewhere …". */
  phrase: string;
  /** The negation of `phrase`. */
  negPhrase: string;
}

export interface Room {
  id: RoomId;
  name: string;
  /** "in" or "on": someone is *on* the Terrace. */
  preposition: string;
  features: string[];
  /** Rooms a guest can walk to in one hour (staying put is always allowed). */
  adjacent: RoomId[];
}

/**
 * What a concealment device demands of the handoff. This is the source of most
 * of the game's extrapolation: learning the room or the mole's coat rules
 * devices out, and vice versa.
 */
export type Requirement =
  | { kind: "feature"; feature: string; is: boolean }
  | { kind: "trait"; trait: string; values: string[] }
  | { kind: "hours"; from: Hour; to: Hour };

export interface Device {
  id: DeviceId;
  name: string;
  /** Where the device was waiting. The mole must pass through here first. */
  location: RoomId;
  requirement: Requirement;
  /** Why the requirement holds, in the story's voice. */
  blurb: string;
}

/** Everything every player knows from the start. */
export interface Dossier {
  title: string;
  traits: TraitDef[];
  features: FeatureDef[];
  agents: Agent[];
  rooms: Room[];
  devices: Device[];
  hours: string[];
}

/** What the players are trying to name. */
export interface Answer {
  agent: AgentId;
  device: DeviceId;
  room: RoomId;
  hour: Hour;
}

/** The ground truth behind a scenario. Never sent to a player mid-game. */
export interface Secret {
  answer: Answer;
  /** schedule[agent][hour] = the room that agent was in. */
  schedule: RoomId[][];
}

/** A single piece of intelligence. Always true of the scenario it came from. */
export type ClueBody =
  /** "X was (not) in R at H." */
  | { kind: "at"; agent: AgentId; room: RoomId; hour: Hour; is: boolean }
  /** "Nobody who wore V set foot in R all evening." */
  | { kind: "never"; trait: string; value: string; room: RoomId }
  /** "The mole (does not) wear V." */
  | { kind: "moleTrait"; trait: string; value: string; is: boolean }
  /** "The handoff happened somewhere (not) outdoors." */
  | { kind: "handoffFeature"; feature: string; is: boolean }
  /** "The handoff happened before / after / not at H." */
  | { kind: "handoffHour"; cmp: "before" | "after" | "not"; hour: Hour }
  /** "The handoff did not happen in R." */
  | { kind: "notRoom"; room: RoomId }
  /** "D was not used." */
  | { kind: "notDevice"; device: DeviceId }
  /** "X is not the mole." */
  | { kind: "notAgent"; agent: AgentId };

export type Clue = ClueBody & { id: number };

/** Something a player can ask another player about. */
export type Subject =
  | { kind: "agent"; id: AgentId }
  | { kind: "room"; id: RoomId }
  | { kind: "hour"; id: Hour }
  | { kind: "device"; id: DeviceId }
  | { kind: "trait"; id: string }
  | { kind: "feature"; id: string };

/** A complete, solvable game: the world, its truth, and how the clues were dealt. */
export interface Scenario {
  seed: number;
  dossier: Dossier;
  secret: Secret;
  /** Every clue in play. `clues[i].id === i`. */
  clues: Clue[];
  /** Clue ids everyone starts with. */
  publicClues: number[];
  /** hands[seat] = clue ids that seat starts with (excluding public ones). */
  hands: number[][];
}
