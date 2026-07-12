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
      "The heart of the town. No night powers — but your voice, your vote, and your read on people are what bring the wolves down. Trusted, and dangerous to the pack.",
  },
  werewolf: {
    id: "werewolf",
    name: "Werewolf",
    team: "werewolf",
    emoji: "🐺",
    blurb: "Each night, you and your pack secretly devour one villager. Win when wolves equal the town.",
    night: { kind: "kill", order: 10, group: true, canTargetSelf: false },
  },
  seer: {
    id: "seer",
    name: "Seer",
    team: "village",
    emoji: "🔮",
    blurb: "Each night, inspect one player to learn their exact role.",
    night: { kind: "inspect", order: 20, canTargetSelf: false, reveal: "exactRole" },
  },
  auraSeer: {
    id: "auraSeer",
    name: "Aura Seer",
    team: "village",
    emoji: "👁️",
    blurb: "Each night, read one player's aura to learn only whether they are a werewolf.",
    night: { kind: "inspect", order: 21, canTargetSelf: false, reveal: "isWerewolf" },
  },
  doctor: {
    id: "doctor",
    name: "Doctor",
    team: "village",
    emoji: "💉",
    blurb: "Each night, protect one player from the wolves. You may protect yourself.",
    night: { kind: "protect", order: 30, canTargetSelf: true },
  },
  hunter: {
    id: "hunter",
    name: "Hunter",
    team: "village",
    emoji: "🏹",
    blurb: "If you die — by wolves or by the vote — you fire one last shot, taking another player with you.",
    onDeathShoot: true,
  },
  drunk: {
    id: "drunk",
    name: "Village Drunk",
    team: "village",
    emoji: "🍺",
    // Presents itself as the Seer; the player never learns they're the Drunk.
    blurb: "Each night, inspect one player to learn their exact role.",
    disguiseAs: "seer",
    night: { kind: "inspect", order: 22, canTargetSelf: false, reveal: "fabricated" },
  },
  tanner: {
    id: "tanner",
    name: "Tanner",
    team: "solo",
    emoji: "🃏",
    blurb: "You hate your life. You win — alone — if the town votes to lynch you.",
    winsIfLynched: true,
  },
  witch: {
    id: "witch",
    name: "Witch",
    team: "village",
    emoji: "🧪",
    blurb:
      "You hold two potions for the whole game: one heals the wolves' victim, one poisons a player of your choice. Each may be used only once. Each night you learn who the wolves struck.",
    night: { kind: "witch", order: 15 },
  },
  troublemaker: {
    id: "troublemaker",
    name: "Troublemaker",
    team: "village",
    emoji: "🎭",
    blurb:
      "Each night, secretly swap the roles of two other players. Neither is told — they simply wake up as someone new.",
    night: { kind: "swap", order: 40 },
  },
};

export const VILLAGER_ROLE_ID = "villager";

export function getRole(id: string): RoleDef {
  const role = ROLES[id];
  if (!role) throw new Error(`Unknown role: ${id}`);
  return role;
}

/** All roles that can be configured into a game (everything except plain villager). */
export function assignableSpecialRoles(): RoleDef[] {
  return Object.values(ROLES).filter((r) => r.id !== VILLAGER_ROLE_ID);
}

/**
 * Roles eligible for a pool: everything except werewolves (their count comes
 * from the team ratio). The plain Villager IS included, so a host can leave it
 * in (extra slots become villagers) or take it out (a villager-free game where
 * extra slots draw more specials).
 */
export function poolEligibleRoles(): RoleDef[] {
  return Object.values(ROLES).filter((r) => r.team !== "werewolf");
}
