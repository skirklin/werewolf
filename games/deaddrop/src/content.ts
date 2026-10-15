import type { FeatureDef, Requirement, TraitDef } from "./types.js";

/**
 * The first content set: a reception at an embassy. The engine only knows
 * about traits, features, rooms, devices and hours, so another setting is a
 * matter of writing another one of these.
 */

export const TITLE = "The Embassy Reception";

export const TRAITS: TraitDef[] = [
  {
    id: "headwear",
    label: "Headwear",
    values: [
      { id: "fedora", label: "Fedora", phrase: "wears a fedora", negPhrase: "does not wear a fedora", pastPhrase: "wore a fedora" },
      { id: "beret", label: "Beret", phrase: "wears a beret", negPhrase: "does not wear a beret", pastPhrase: "wore a beret" },
      { id: "none", label: "Bareheaded", phrase: "is bareheaded", negPhrase: "wears a hat", pastPhrase: "was bareheaded" },
    ],
  },
  {
    id: "coat",
    label: "Coat",
    values: [
      { id: "black", label: "Black", phrase: "wears a black coat", negPhrase: "does not wear a black coat", pastPhrase: "wore a black coat" },
      { id: "grey", label: "Grey", phrase: "wears a grey coat", negPhrase: "does not wear a grey coat", pastPhrase: "wore a grey coat" },
      { id: "camel", label: "Camel", phrase: "wears a camel coat", negPhrase: "does not wear a camel coat", pastPhrase: "wore a camel coat" },
      { id: "red", label: "Red", phrase: "wears a red coat", negPhrase: "does not wear a red coat", pastPhrase: "wore a red coat" },
    ],
  },
  {
    id: "height",
    label: "Height",
    values: [
      { id: "tall", label: "Tall", phrase: "is tall", negPhrase: "is not tall", pastPhrase: "was tall" },
      { id: "short", label: "Short", phrase: "is short", negPhrase: "is not short", pastPhrase: "was short" },
    ],
  },
  {
    id: "hand",
    label: "Handedness",
    values: [
      { id: "left", label: "Left", phrase: "is left-handed", negPhrase: "is not left-handed", pastPhrase: "was left-handed" },
      { id: "right", label: "Right", phrase: "is right-handed", negPhrase: "is not right-handed", pastPhrase: "was right-handed" },
    ],
  },
  {
    id: "glasses",
    label: "Glasses",
    values: [
      { id: "yes", label: "Glasses", phrase: "wears glasses", negPhrase: "does not wear glasses", pastPhrase: "wore glasses" },
      { id: "no", label: "No glasses", phrase: "wears no glasses", negPhrase: "wears glasses", pastPhrase: "wore no glasses" },
    ],
  },
  {
    id: "gloves",
    label: "Gloves",
    values: [
      { id: "yes", label: "Gloves", phrase: "wears gloves", negPhrase: "does not wear gloves", pastPhrase: "wore gloves" },
      { id: "no", label: "Bare hands", phrase: "is bare-handed", negPhrase: "wears gloves", pastPhrase: "was bare-handed" },
    ],
  },
];

export const FEATURES: FeatureDef[] = [
  { id: "outdoors", label: "Outdoors", phrase: "outdoors", negPhrase: "indoors" },
  { id: "crowded", label: "Crowded", phrase: "crowded", negPhrase: "uncrowded" },
  { id: "quiet", label: "Quiet", phrase: "quiet", negPhrase: "noisy" },
  { id: "dark", label: "Dark", phrase: "dark", negPhrase: "well lit" },
  { id: "seating", label: "Seating", phrase: "with seating", negPhrase: "without seating" },
];

/** The house. */
export const ROOMS: { name: string; preposition?: string; features: string[] }[] = [
  { name: "Ballroom", features: ["crowded"] },
  { name: "Bar", features: ["crowded", "seating"] },
  { name: "Library", features: ["quiet", "seating"] },
  { name: "Study", features: ["quiet", "dark"] },
  { name: "Terrace", preposition: "on", features: ["outdoors", "seating"] },
  { name: "Garden", features: ["outdoors", "quiet", "dark"] },
];

export interface DeviceTemplate {
  name: string;
  requirement: Requirement;
  blurb: string;
}

export const DEVICES: DeviceTemplate[] = [
  {
    name: "Umbrella",
    requirement: { kind: "feature", feature: "outdoors", is: true },
    blurb: "A hollow handle. Nobody opens an umbrella indoors.",
  },
  {
    name: "Folded newspaper",
    requirement: { kind: "feature", feature: "seating", is: true },
    blurb: "Swapped across a table, so it needs somewhere to sit.",
  },
  {
    name: "Hollow coin",
    requirement: { kind: "feature", feature: "crowded", is: true },
    blurb: "Palmed in a handshake; it needs a crowd for cover.",
  },
  {
    name: "Marked book",
    requirement: { kind: "feature", feature: "quiet", is: true },
    blurb: "A message between the pages; it needs a quiet room.",
  },
  {
    name: "Lipstick camera",
    requirement: { kind: "feature", feature: "dark", is: false },
    blurb: "Useless without good light.",
  },
  {
    name: "Glove lining",
    requirement: { kind: "trait", trait: "gloves", values: ["yes"] },
    blurb: "A note sewn inside a glove; the courier had to be wearing them.",
  },
  {
    name: "Hatband",
    requirement: { kind: "trait", trait: "headwear", values: ["fedora", "beret"] },
    blurb: "Microfilm tucked in a hatband; the courier had to wear a hat.",
  },
  {
    name: "Spectacle lens",
    requirement: { kind: "trait", trait: "glasses", values: ["yes"] },
    blurb: "A microdot on a lens; the courier had to wear glasses.",
  },
  {
    name: "Top-shelf ledger",
    requirement: { kind: "trait", trait: "height", values: ["tall"] },
    blurb: "Left on a shelf only a tall guest could reach.",
  },
  {
    name: "Signet ring",
    requirement: { kind: "trait", trait: "hand", values: ["left"] },
    blurb: "The ring's catch only works for a left-handed courier.",
  },
  {
    name: "Coat swap",
    requirement: { kind: "trait", trait: "coat", values: ["black", "grey"] },
    blurb: "Two dark coats swapped at the cloakroom.",
  },
];

export const AGENT_NAMES = [
  "Countess Varga",
  "Mr. Okafor",
  "Attaché Lindqvist",
  "Dr. Moreau",
  "Colonel Petrov",
  "Miss Tanaka",
  "Signor Bellini",
  "Mrs. Ashworth",
  "Herr Brandt",
  "Madame Duval",
  "Señor Ruiz",
  "Professor Haddad",
];
