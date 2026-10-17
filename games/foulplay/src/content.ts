import type { FeatureDef, Requirement, Theme, TraitDef } from "./types.js";

/**
 * The first content set: a murder at a country-house party. The engine only
 * knows suspects with traits, rooms with features, and items with a hiding
 * place and a requirement; everything players read comes from here, so
 * another setting is a matter of writing another one of these.
 *
 * Every link is meant to be evidence you could picture someone finding: a
 * fibre on the body, a missing candlestick, a shot nobody heard.
 */

export const TITLE = "Murder at Ashcombe Manor";

export const THEME: Theme = {
  culprit: "the killer",
  act: "the murder",
  item: "weapon",
  items: "weapons",
  story:
    "Lord Ashcombe promised his guests an announcement at midnight, rumoured to be a new will. Midnight came " +
    "and he didn't. At a quarter past twelve the butler found him dead at the foot of the grand staircase in " +
    "the Hall. He didn't die there: someone killed him elsewhere and moved him to look like a fall. The roads " +
    "are flooded and the inspector can't arrive until dawn. One of you did it.",
};

export const TRAITS: TraitDef[] = [
  {
    id: "headwear",
    label: "Headwear",
    values: [
      {
        id: "fedora",
        label: "Fedora",
        phrase: "wears a fedora",
        negPhrase: "does not wear a fedora",
        pastPhrase: "wore a fedora",
        evidence: "A felt fedora was found under the body: the killer wears a fedora.",
      },
      {
        id: "beret",
        label: "Beret",
        phrase: "wears a beret",
        negPhrase: "does not wear a beret",
        pastPhrase: "wore a beret",
        evidence: "A wool beret was dropped at the scene: the killer wears a beret.",
      },
      {
        id: "none",
        label: "Bareheaded",
        phrase: "is bareheaded",
        negPhrase: "wears a hat",
        pastPhrase: "was bareheaded",
        evidence: "Loose hairs in the victim's grip: the killer was bareheaded.",
      },
    ],
  },
  {
    id: "coat",
    label: "Coat",
    values: [
      {
        id: "black",
        label: "Black",
        phrase: "wears a black coat",
        negPhrase: "does not wear a black coat",
        pastPhrase: "wore a black coat",
        evidence: "Black wool fibres were found on the body: the killer wears a black coat.",
      },
      {
        id: "grey",
        label: "Grey",
        phrase: "wears a grey coat",
        negPhrase: "does not wear a grey coat",
        pastPhrase: "wore a grey coat",
        evidence: "Grey wool fibres were found on the body: the killer wears a grey coat.",
      },
      {
        id: "camel",
        label: "Camel",
        phrase: "wears a camel coat",
        negPhrase: "does not wear a camel coat",
        pastPhrase: "wore a camel coat",
        evidence: "Camel-hair fibres were found on the body: the killer wears a camel coat.",
      },
      {
        id: "red",
        label: "Red",
        phrase: "wears a red coat",
        negPhrase: "does not wear a red coat",
        pastPhrase: "wore a red coat",
        evidence: "Red wool fibres were found on the body: the killer wears a red coat.",
      },
    ],
  },
  {
    id: "height",
    label: "Height",
    values: [
      {
        id: "tall",
        label: "Tall",
        phrase: "is tall",
        negPhrase: "is not tall",
        pastPhrase: "was tall",
        evidence: "The blow came from above: the killer is tall.",
      },
      {
        id: "short",
        label: "Short",
        phrase: "is short",
        negPhrase: "is not short",
        pastPhrase: "was short",
        evidence: "The blow came from below: the killer is short.",
      },
    ],
  },
  {
    id: "hand",
    label: "Handedness",
    values: [
      {
        id: "left",
        label: "Left",
        phrase: "is left-handed",
        negPhrase: "is not left-handed",
        pastPhrase: "was left-handed",
        evidence: "The wound was struck from the left: the killer is left-handed.",
      },
      {
        id: "right",
        label: "Right",
        phrase: "is right-handed",
        negPhrase: "is not right-handed",
        pastPhrase: "was right-handed",
        evidence: "The wound was struck from the right: the killer is right-handed.",
      },
    ],
  },
  {
    id: "glasses",
    label: "Glasses",
    values: [
      {
        id: "yes",
        label: "Glasses",
        phrase: "wears glasses",
        negPhrase: "does not wear glasses",
        pastPhrase: "wore glasses",
        evidence: "A shard of a spectacle lens lay by the body: the killer wears glasses.",
      },
      {
        id: "no",
        label: "No glasses",
        phrase: "wears no glasses",
        negPhrase: "wears glasses",
        pastPhrase: "wore no glasses",
        evidence: "The butler saw the killer read a note by the door, without spectacles.",
      },
    ],
  },
  {
    id: "gloves",
    label: "Gloves",
    values: [
      {
        id: "yes",
        label: "Gloves",
        phrase: "wears gloves",
        negPhrase: "does not wear gloves",
        pastPhrase: "wore gloves",
        evidence: "Not a fingerprint anywhere: the killer wore gloves.",
      },
      {
        id: "no",
        label: "Bare hands",
        phrase: "is bare-handed",
        negPhrase: "wears gloves",
        pastPhrase: "was bare-handed",
        evidence: "Smudged fingerprints on the doorframe: the killer was bare-handed.",
      },
    ],
  },
];

export const FEATURES: FeatureDef[] = [
  {
    id: "outdoors",
    label: "Outdoors",
    phrase: "outdoors",
    negPhrase: "indoors",
    evidence: "There was mud and grass on the victim's shoes: the murder happened outdoors.",
    notEvidence: "The victim's shoes were spotless: the murder happened indoors.",
  },
  {
    id: "crowded",
    label: "Crowded",
    phrase: "crowded",
    negPhrase: "uncrowded",
    evidence: "Spilled champagne and trampled canapés: the murder happened somewhere crowded.",
    notEvidence: "Nobody was there to see it: the murder didn't happen anywhere crowded.",
  },
  {
    id: "quiet",
    label: "Quiet",
    phrase: "quiet",
    negPhrase: "noisy",
    evidence: "A guest nearby heard a faint cry: the murder happened somewhere quiet.",
    notEvidence: "Nobody heard a thing over the din: the murder didn't happen anywhere quiet.",
  },
  {
    id: "dark",
    label: "Dark",
    phrase: "dark",
    negPhrase: "well lit",
    evidence: "A spent match by the body: the murder happened somewhere dark.",
    notEvidence: "The victim's watch reflected a lamp: the murder didn't happen anywhere dark.",
  },
  {
    id: "seating",
    label: "Seating",
    phrase: "with seating",
    negPhrase: "without seating",
    evidence: "An overturned chair: the murder happened somewhere with seating.",
    notEvidence: "Not a chair in sight in the struggle: the murder happened somewhere without seating.",
  },
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

/** The weapons. Each one's requirement is something its use would leave behind. */
export const DEVICES: DeviceTemplate[] = [
  {
    name: "Revolver",
    requirement: { kind: "feature", feature: "crowded", is: true },
    blurb: "A shot anywhere quieter would have been heard. It must have been somewhere crowded.",
  },
  {
    name: "Garden shears",
    requirement: { kind: "feature", feature: "outdoors", is: true },
    blurb: "Nobody carries shears through the house unnoticed. It happened outdoors.",
  },
  {
    name: "Rope",
    requirement: { kind: "feature", feature: "quiet", is: true },
    blurb: "Strangling takes time. It needed somewhere quiet.",
  },
  {
    name: "Cushion",
    requirement: { kind: "feature", feature: "seating", is: true },
    blurb: "Smothered with a cushion from a chair or sofa: somewhere with seating.",
  },
  {
    name: "Letter opener",
    requirement: { kind: "feature", feature: "dark", is: true },
    blurb: "A quick stab, unseen. It happened somewhere dark.",
  },
  {
    name: "Candlestick",
    requirement: { kind: "trait", trait: "height", values: ["tall"] },
    blurb: "A heavy blow to the top of the head: only a tall killer could land it.",
  },
  {
    name: "Poison vial",
    requirement: { kind: "trait", trait: "gloves", values: ["yes"] },
    blurb: "The vial is wiped clean of prints. The poisoner wore gloves.",
  },
  {
    name: "Hatpin",
    requirement: { kind: "trait", trait: "headwear", values: ["fedora", "beret"] },
    blurb: "A long pin taken from a hat. The killer wears one.",
  },
  {
    name: "Carving knife",
    requirement: { kind: "trait", trait: "coat", values: ["black", "grey"] },
    blurb: "Blood would show on a light coat; nobody saw any. The killer wore black or grey.",
  },
];

/**
 * The guests. Their looks are fixed, so a table can learn the cast; what
 * changes from game to game is the evidence. Each trait splits the cast
 * roughly in half, and no two guests share more than four of the six.
 */
export const CAST: { name: string; motive: string; traits: Record<string, string> }[] = [
  {
    name: "Lady Ashcombe",
    motive: "The new will was said to leave her nothing.",
    traits: { headwear: "none", coat: "red", height: "short", hand: "right", glasses: "no", gloves: "yes" },
  },
  {
    name: "Julian Ashcombe",
    motive: "The nephew, who inherits under the old will.",
    traits: { headwear: "fedora", coat: "black", height: "tall", hand: "left", glasses: "no", gloves: "no" },
  },
  {
    name: "Dr. Moreau",
    motive: "Owed Lord Ashcombe more than he could ever repay.",
    traits: { headwear: "none", coat: "grey", height: "tall", hand: "right", glasses: "yes", gloves: "yes" },
  },
  {
    name: "Mr. Okafor",
    motive: "His business partner, about to be bought out on bad terms.",
    traits: { headwear: "fedora", coat: "camel", height: "tall", hand: "right", glasses: "no", gloves: "yes" },
  },
  {
    name: "Miss Tanaka",
    motive: "The secretary who typed the new will, so she knew what was in it.",
    traits: { headwear: "beret", coat: "black", height: "short", hand: "left", glasses: "yes", gloves: "no" },
  },
  {
    name: "Signor Bellini",
    motive: "The art dealer whose Old Masters Lord Ashcombe had begun to doubt.",
    traits: { headwear: "beret", coat: "camel", height: "short", hand: "right", glasses: "yes", gloves: "yes" },
  },
  {
    name: "Colonel Petrov",
    motive: "An old army friend who had been paying for his silence for years.",
    traits: { headwear: "none", coat: "grey", height: "tall", hand: "left", glasses: "no", gloves: "no" },
  },
  {
    name: "Madame Duval",
    motive: "The medium. Lord Ashcombe had promised to expose her as a fraud.",
    traits: { headwear: "beret", coat: "red", height: "short", hand: "right", glasses: "yes", gloves: "no" },
  },
];
