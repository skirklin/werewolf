/**
 * Core types for Foul Play: a deduction game where someone was murdered during
 * a party, and the players trade evidence to work out who did it, with what,
 * and where.
 *
 * The engine itself is theme-agnostic: an "agent" is a suspect, a "device" is
 * the item used (here, the weapon), and the "handoff" is the act (the murder).
 * The words players read come from the content set's `Theme` and evidence.
 *
 * Everything here is plain data so a whole scenario can be serialised, sent
 * over the wire, and replayed from its seed.
 */

/** Indices into the dossier's lists. */
export type AgentId = number;
export type RoomId = number;
export type DeviceId = number;

export interface TraitValue {
  id: string;
  label: string;
  /** Completes "The killer …", e.g. "wears a beret". */
  phrase: string;
  /** Completes "The killer …" in the negative, e.g. "does not wear a beret". */
  negPhrase: string;
  /** The evidence that shows the culprit has this trait, as a full sentence. */
  evidence: string;
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
  /** Completes "somewhere …", e.g. "outdoors". */
  phrase: string;
  /** The negation of `phrase`. */
  negPhrase: string;
  /** The evidence that the act happened somewhere with this feature, and without it. */
  evidence: string;
  notEvidence: string;
}

export interface Room {
  id: RoomId;
  name: string;
  /** "in" or "on": someone is *on* the Terrace. */
  preposition: string;
  features: string[];
}

/**
 * What an item (weapon) demands of the act. This is the source of most of the
 * game's extrapolation: learning the room or the culprit's coat rules
 * weapons out, and vice versa.
 */
export type Requirement =
  | { kind: "feature"; feature: string; is: boolean }
  | { kind: "trait"; trait: string; values: string[] };

export interface Device {
  id: DeviceId;
  name: string;
  /** Where the item was kept. The culprit must have visited this room. */
  location: RoomId;
  requirement: Requirement;
  /** Why the requirement holds, in the story's voice. */
  blurb: string;
}

/** Everything every player knows from the start. */
/** The words a content set uses for the engine's roles. */
export interface Theme {
  /** "the killer" */
  culprit: string;
  /** "the murder" */
  act: string;
  /** "weapon", "weapons" */
  item: string;
  items: string;
  /** The scene-setter shown before play. */
  story: string;
}

export interface Dossier {
  title: string;
  theme: Theme;
  traits: TraitDef[];
  features: FeatureDef[];
  agents: Agent[];
  rooms: Room[];
  devices: Device[];
}

/** What the players are trying to name. */
export interface Answer {
  agent: AgentId;
  device: DeviceId;
  room: RoomId;
}

/** The ground truth behind a scenario. Never sent to a player mid-game. */
export interface Secret {
  answer: Answer;
  /** visits[agent] = the rooms that agent set foot in during the evening. */
  visits: RoomId[][];
}

/** A single piece of intelligence. Always true of the scenario it came from. */
export type ClueBody =
  /** "The butler saw X in R." / "The staff swear X never set foot in R." */
  | { kind: "visited"; agent: AgentId; room: RoomId; is: boolean }
  /** "Nobody who wore V set foot in R all evening." */
  | { kind: "never"; trait: string; value: string; room: RoomId }
  /** Evidence of the culprit's look: "Red fibres on the body…" / "…does not wear V." */
  | { kind: "moleTrait"; trait: string; value: string; is: boolean }
  /** Evidence of where it happened: "Mud on the victim's shoes: outdoors." */
  | { kind: "handoffFeature"; feature: string; is: boolean }
  /** "R was searched: it didn't happen there." */
  | { kind: "notRoom"; room: RoomId }
  /** "No trace on D: not the weapon." */
  | { kind: "notDevice"; device: DeviceId }
  /** "X has a solid alibi." */
  | { kind: "notAgent"; agent: AgentId };

/** Printed on every clue: how much it cuts on its own. 3 cuts broadly; 1 is narrow. */
export type Points = 1 | 2 | 3;

export type Clue = ClueBody & { id: number; points: Points };

/** Something a player can ask another player about. */
export type Subject =
  | { kind: "agent"; id: AgentId }
  | { kind: "room"; id: RoomId }
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
  /** The draw pile, top first: replacements dealt at the end of each round. */
  deck: number[];
}
