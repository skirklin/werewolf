/**
 * Core types for Foul Play: Lord Ashcombe has been murdered during his own
 * party, every player is one of the guests, and one of them did it.
 *
 * The solver underneath is theme-agnostic: an "agent" is a suspect, a
 * "device" is the item used (here, the weapon), and the "handoff" is the act
 * (the murder). The words players read come from the content set's `Theme`
 * and evidence.
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
  /** Why they might have wanted him dead. Flavour only, never evidence. */
  motive: string;
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

/** Everything every player knows from the start. */
export interface Dossier {
  title: string;
  theme: Theme;
  traits: TraitDef[];
  features: FeatureDef[];
  /** The guests at the table, in seat order: agent i is seat i's character. */
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

/** The ground truth behind a scenario. Never sent to an innocent mid-game. */
export interface Secret {
  answer: Answer;
  /** visits[agent] = the rooms that agent set foot in during the evening. */
  visits: RoomId[][];
}

/** A single statement about the case. Every card in play is true. */
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
  /** "X has a solid alibi." `say` picks which witness tells it. */
  | { kind: "notAgent"; agent: AgentId; say?: number }
  /**
   * "A maid saw X slip out of R." True, and no proof of anything, but it fits
   * the story the house tells about X: the kind of card X would rather burn.
   */
  | { kind: "seen"; agent: AgentId; room: RoomId }
  /** "The staff saw only X and Y in R all evening." Exactly who set foot there. */
  | { kind: "visitors"; room: RoomId; agents: AgentId[] }
  /** "X's evening: the Bar and the Library, nowhere else." Exactly where they went. */
  | { kind: "whereabouts"; agent: AgentId; rooms: RoomId[] }
  /** "Signs of a struggle: it happened in R." */
  | { kind: "isRoom"; room: RoomId }
  /** "D is missing from where it was kept." */
  | { kind: "isDevice"; device: DeviceId };

export type Clue = ClueBody & { id: number };

/**
 * Where a player can be: one of the dossier's rooms, or the Hall, where the
 * body was found and everyone starts. The Hall is never the scene.
 */
export type Place = number;

/** A complete, solvable case: the world, its truth, and where the evidence lies. */
export interface Scenario {
  seed: number;
  dossier: Dossier;
  secret: Secret;
  /** The killer's seat, and the accomplice's (or null). */
  killer: number;
  accomplice: number | null;
  /**
   * The story the house tells about each guest: a weapon they could have
   * used and a room they were in that fits. The killer's is the truth; every
   * other one is broken by an alibi or two somewhere in the house.
   */
  stories: Answer[];
  /** Every card in the case. `clues[i].id === i`. */
  clues: Clue[];
  /** memories[seat] = the cards that seat starts with in hand. */
  memories: number[][];
  /** stacks[place] = the face-down evidence there, top first. The Hall is the last place. */
  stacks: number[][];
  /** Fresh evidence about the killer, left on a body if they murder again. */
  spare: number[];
}
