import type { RoleDef } from "./types.js";

/**
 * The role registry. To add a role, add an entry here. If it reuses an
 * existing night `kind` (kill/protect/inspect) no engine changes are needed;
 * a brand-new mechanic is the one place you extend resolveNight in engine.ts.
 */
export const ROLES: Record<string, RoleDef> = {
  villager: {
    id: "villager",
    name: "Villager",
    team: "village",
    emoji: "🧑‍🌾",
    blurb:
      "No powers, no potions — just a pitchfork and a hunch. Your vote is the town's sharpest weapon, and the wolves lose sleep over you.",
  },
  werewolf: {
    id: "werewolf",
    name: "Werewolf",
    team: "werewolf",
    emoji: "🐺",
    blurb:
      "By night, you and the pack pick a neighbor to snack on. By day, gasp louder than anyone. You win the moment wolves match the humans.",
    night: { kind: "kill", order: 10, group: true, canTargetSelf: false },
  },
  henchman: {
    id: "henchman",
    name: "Henchman",
    team: "werewolf",
    emoji: "🦹",
    countsAsWolf: false, // wins with the wolves, but isn't one
    blurb:
      "You're the pack's number-one fan — you know the wolves and cheer them on — but you've got no teeth of your own. If they go down, you go down with them.",
  },
  infector: {
    id: "infector",
    name: "Infector",
    team: "werewolf",
    emoji: "🧛",
    blurb:
      "A wolf with a nasty bite. Once per game, skip the hunt and infect a neighbor instead — they wake up furry and secretly join the pack.",
    night: { kind: "convert", order: 12, canTargetSelf: false },
  },
  seer: {
    id: "seer",
    name: "Seer",
    team: "village",
    emoji: "🔮",
    blurb: "Each night, peek at one player's true role. Then spend all day trying not to look smug about it.",
    drunkMimicable: true,
    night: { kind: "inspect", order: 20, canTargetSelf: false, reveal: "exactRole" },
  },
  auraSeer: {
    id: "auraSeer",
    name: "Aura Seer",
    team: "village",
    emoji: "👁️",
    blurb: "Each night, sense one player's aura — werewolf or not. No details, just the verdict.",
    drunkMimicable: true,
    night: { kind: "inspect", order: 21, canTargetSelf: false, reveal: "isWerewolf" },
  },
  doctor: {
    id: "doctor",
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
    name: "Hunter",
    team: "village",
    emoji: "🏹",
    blurb: "Nobody takes you quietly. The instant you die — fangs or pitchforks — you fire one last shot and drag someone down with you.",
    onDeathShoot: true,
  },
  drunk: {
    id: "drunk",
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
    name: "Tanner",
    team: "solo",
    emoji: "🃏",
    blurb: "You can't stand this town. Your one goal: get voted out. Pull it off and you win — pettily, and all alone.",
    winsIfLynched: true,
  },
  witch: {
    id: "witch",
    name: "Witch",
    team: "village",
    emoji: "🧪",
    blurb:
      "Two potions, one game. Each night, secretly shield someone with your healing draught — if the wolves come for them, they live (and the potion's spent). Or poison anyone you fancy. One use each, no refills, and you never know who the wolves picked.",
    night: { kind: "witch", order: 15 },
  },
  troublemaker: {
    id: "troublemaker",
    name: "Troublemaker",
    team: "village",
    emoji: "🎭",
    blurb:
      "A quiet agent of chaos. Each night, secretly swap two players' roles — they wake up as someone new and never know.",
    drunkMimicable: true,
    night: { kind: "swap", order: 40 },
  },
  silencer: {
    id: "silencer",
    name: "Silencer",
    team: "village",
    emoji: "🤫",
    blurb:
      "Each night, shush one player — no vote for them tomorrow. Perfect for muzzling a smooth talker or a wolf who won't shut up.",
    drunkMimicable: true,
    night: { kind: "silence", order: 35, canTargetSelf: false },
  },
  detective: {
    id: "detective",
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
export const DRUNK_ROLE_ID = "drunk";

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

/** Whether a role counts as a real werewolf for win math (default: wolf team). */
export function roleCountsAsWolf(role: RoleDef): boolean {
  return role.countsAsWolf ?? role.team === "werewolf";
}

/**
 * Roles eligible for a pool: everything except the base Werewolf (whose count
 * comes from the team ratio). Wolf-team specials (Henchman, Infector) ARE
 * included, as are the Villager and every village/solo role.
 */
export function poolEligibleRoles(): RoleDef[] {
  return Object.values(ROLES).filter((r) => r.id !== "werewolf");
}
