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
    blurb: "Each night, inspect one player to learn whether they are a werewolf.",
    night: { kind: "inspect", order: 20, canTargetSelf: false },
  },
  doctor: {
    id: "doctor",
    name: "Doctor",
    team: "village",
    emoji: "💉",
    blurb: "Each night, protect one player from the wolves. You may protect yourself.",
    night: { kind: "protect", order: 30, canTargetSelf: true },
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
