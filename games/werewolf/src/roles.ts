import type { RoleDef } from "./types.js";

/**
 * The role registry. To add a role, add an entry here: one that reuses a
 * night `kind`, or a RoleDef flag (sparedOnFirstVote, succeeds, ...), needs no
 * engine change; a brand-new mechanic is resolved in endNight (engine.ts).
 *
 * Weights start from Ultimate Werewolf's published scale, adjusted for how the
 * roles work here. They're a prior, meant to be tuned from real games.
 */
export const ROLES: Record<string, RoleDef> = {
  villager: {
    id: "villager",
    weight: 1,
    autoFrom: 0,
    name: "Villager",
    team: "village",
    emoji: "🧑‍🌾",
    blurb:
      "No powers, no potions — just a pitchfork and a hunch. Your vote is the town's sharpest weapon, and the wolves lose sleep over you.",
  },
  werewolf: {
    id: "werewolf",
    weight: -6,
    autoFrom: 0,
    name: "Werewolf",
    team: "werewolf",
    emoji: "🐺",
    blurb:
      "By night, you and the pack pick a neighbor to snack on. By day, gasp louder than anyone. You win the moment wolves match the humans.",
    night: { kind: "kill", order: 10, group: true, canTargetSelf: false },
  },
  henchman: {
    id: "henchman",
    weight: -4,
    autoFrom: 8,
    name: "Henchman",
    team: "werewolf",
    emoji: "🦹",
    countsAsWolf: false, // wins with the wolves, but isn't one
    blurb:
      "You're the pack's number-one fan — you know the wolves and cheer them on — but you've got no teeth of your own. If they go down, you go down with them.",
  },
  infector: {
    id: "infector",
    weight: -8,
    autoFrom: 11,
    name: "Infector",
    team: "werewolf",
    emoji: "🧛",
    blurb:
      "A wolf with a nasty bite. Once per game, on a night of your choosing, infect a neighbor — at dawn they wake up furry and secretly join the pack.",
    night: { kind: "convert", order: 12, canTargetSelf: false },
  },
  seer: {
    id: "seer",
    weight: 7,
    autoFrom: 0,
    name: "Seer",
    team: "village",
    emoji: "🔮",
    blurb: "Each night, peek at one player's true role. Then spend all day trying not to look smug about it.",
    drunkMimicable: true,
    night: { kind: "inspect", order: 20, canTargetSelf: false, reveal: "exactRole" },
  },
  auraSeer: {
    id: "auraSeer",
    weight: 4,
    autoFrom: 10,
    name: "Aura Seer",
    team: "village",
    emoji: "👁️",
    blurb: "Each night, sense one player's aura — werewolf or not. No details, just the verdict.",
    drunkMimicable: true,
    night: { kind: "inspect", order: 21, canTargetSelf: false, reveal: "isWerewolf" },
  },
  doctor: {
    id: "doctor",
    weight: 4,
    autoFrom: 0,
    name: "Doctor",
    team: "village",
    emoji: "💉",
    blurb:
      "Each night, patch someone up (yourself counts) — but never the same patient two nights running. If the wolves come knocking, your patient just shrugs it off.",
    drunkMimicable: true,
    night: { kind: "protect", order: 30, canTargetSelf: true },
  },
  hunter: {
    id: "hunter",
    weight: 3,
    autoFrom: 6,
    name: "Hunter",
    team: "village",
    emoji: "🏹",
    blurb:
      "Nobody takes you quietly. Each night, pick who you'd take with you. If you die before the next night — fangs or pitchforks — they go down with you.",
    onDeathShoot: true,
    // Picked every night, while still alive: the shot fires automatically on death.
    night: { kind: "mark", order: 45, canTargetSelf: false },
  },
  drunk: {
    id: "drunk",
    weight: -1,
    autoFrom: 12,
    name: "Village Drunk",
    team: "village",
    emoji: "🍺",
    // At deal time the Drunk is secretly assigned a random mimicable role
    // (state.drunkDisguise); in-game they're shown THAT role's card and action,
    // which quietly does nothing. This honest blurb is only for setup/reveal.
    blurb:
      "You're convinced you have a special role — you don't. Whatever power you think you have is useless, and you'll never know. Just an ordinary villager.",
  },
  tanner: {
    id: "tanner",
    weight: -2,
    autoFrom: 8,
    name: "Tanner",
    team: "solo",
    emoji: "🃏",
    blurb: "You can't stand this town. Your one goal: get voted out. Pull it off and you win — pettily, and all alone.",
    winsIfLynched: true,
  },
  prince: {
    id: "prince",
    weight: 3,
    autoFrom: 7,
    name: "Prince",
    team: "village",
    emoji: "👑",
    sparedOnFirstVote: true,
    blurb:
      "Royalty has its perks. The first time the town votes you out, you reveal your crown and they think better of it. The second time, they don't.",
  },
  apprenticeSeer: {
    id: "apprenticeSeer",
    weight: 4,
    autoFrom: 9,
    name: "Apprentice Seer",
    team: "village",
    emoji: "🔭",
    succeeds: "seer",
    blurb:
      "You've been studying under the Seer. While they live, you're just a villager with good posture. If the Seer is gone, you take up the crystal ball.",
  },
  cursed: {
    id: "cursed",
    weight: -3,
    autoFrom: 8,
    name: "Cursed",
    team: "village",
    emoji: "😈",
    turnsWhenBitten: true,
    blurb:
      "You're on the village's side — for now. If the wolves ever sink their teeth into you, you won't die: you'll wake up one of them.",
  },
  poisoner: {
    id: "poisoner",
    weight: -5,
    autoFrom: 9,
    name: "Poisoner",
    team: "werewolf",
    emoji: "🍄",
    countsAsWolf: false, // on the pack's side, but no fangs
    blurb:
      "You brew for the pack. Each night, spike someone's supper: the following night their power quietly fails, and they never know. Never the same person two nights running.",
    night: { kind: "block", order: 8, canTargetSelf: false },
  },
  witch: {
    id: "witch",
    weight: 4,
    autoFrom: 7,
    name: "Witch",
    team: "village",
    emoji: "🧪",
    blurb:
      "Two potions, one game. Uncork the healing draught on any night and whoever the wolves attack lives — but it's gone either way, so pick your night. The poison takes out anyone you fancy. You never learn who the wolves picked.",
    night: { kind: "witch", order: 15 },
  },
  troublemaker: {
    id: "troublemaker",
    weight: -1,
    autoFrom: 12,
    name: "Troublemaker",
    team: "village",
    emoji: "🎭",
    blurb:
      "A quiet agent of chaos with one trick per game: on a night of your choosing, secretly swap two players' roles. The swap lands at dawn — they wake up as someone new and never know.",
    drunkMimicable: true,
    night: { kind: "swap", order: 40 },
  },
  // Id kept as "silencer" so saved setups and stats still line up.
  silencer: {
    id: "silencer",
    weight: 1,
    autoFrom: 10,
    name: "Gossip",
    team: "village",
    emoji: "🗣️",
    blurb:
      "Each night, start a juicy rumor about someone. Tomorrow the town gives them the cold shoulder: they can't speak up or vote. Never the same person two nights running.",
    drunkMimicable: true,
    night: { kind: "silence", order: 35, canTargetSelf: false },
  },
  detective: {
    id: "detective",
    weight: 4,
    autoFrom: 9,
    name: "Detective",
    team: "village",
    emoji: "🕵️",
    blurb:
      "Each night, compare two players and learn whether they're on the same team — but not which one.",
    drunkMimicable: true,
    night: { kind: "detect", order: 25, canTargetSelf: false },
  },
  medium: {
    id: "medium",
    weight: 2,
    autoFrom: 10,
    name: "Medium",
    team: "village",
    emoji: "👻",
    blurb:
      "You've got exactly one séance in you. Once per game, on a night you choose, yank a dead player back to the land of the living.",
    drunkMimicable: true,
    night: { kind: "raise", order: 5 },
  },
};

export const VILLAGER_ROLE_ID = "villager";

export function getRole(id: string): RoleDef {
  const role = ROLES[id];
  if (!role) throw new Error(`Unknown role: ${id}`);
  return role;
}

/** Roles the Drunk may be secretly assigned to impersonate. */
export function mimicableRoleIds(): string[] {
  return Object.values(ROLES)
    .filter((r) => r.drunkMimicable)
    .map((r) => r.id);
}

/** All roles that can be configured into a game (everything except plain villager). */
export function assignableSpecialRoles(): RoleDef[] {
  return Object.values(ROLES).filter((r) => r.id !== VILLAGER_ROLE_ID);
}

/** On the wolves' side: wins with them and knows them (the Henchman and Poisoner included). */
export function onWolfTeam(roleId: string): boolean {
  return getRole(roleId).team === "werewolf";
}

/** A real werewolf, for the win check, the Aura Seer and the wolf count (not the Henchman). */
export function isWolf(roleId: string): boolean {
  const role = getRole(roleId);
  return role.countsAsWolf ?? role.team === "werewolf";
}

/**
 * Roles eligible for a pool: everything except the base Werewolf (whose count
 * comes from the wolf band). Wolf-team specials (Henchman, Infector) ARE
 * included, as are the Villager and every village/solo role.
 */
export function poolEligibleRoles(): RoleDef[] {
  return Object.values(ROLES).filter((r) => r.id !== "werewolf");
}
