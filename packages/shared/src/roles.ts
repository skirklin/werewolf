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
    blurb: "A regular townsperson. No special powers — just your wits and your vote.",
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
 * Roles eligible for a pool: any non-villager, non-werewolf role. Wolves are
 * excluded because their count comes from the team ratio, not the pool.
 */
export function poolEligibleRoles(): RoleDef[] {
  return Object.values(ROLES).filter(
    (r) => r.id !== VILLAGER_ROLE_ID && r.team !== "werewolf"
  );
}
