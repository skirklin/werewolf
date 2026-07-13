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
  henchman: {
    id: "henchman",
    name: "Henchman",
    team: "werewolf",
    emoji: "🦹",
    countsAsWolf: false, // wins with the wolves, but isn't one
    blurb:
      "You know who the werewolves are and you win with them — but you have no bite of your own. If the wolves are wiped out, you fall with them.",
  },
  infector: {
    id: "infector",
    name: "Infector",
    team: "werewolf",
    emoji: "🧛",
    blurb:
      "A werewolf who wins with the pack. Once in the game, instead of resting, spread the curse: turn a living non-wolf into a werewolf, who secretly joins the pack.",
    night: { kind: "convert", order: 12, canTargetSelf: false },
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
    // In-game the player is shown the Seer's card (disguiseAs) and never learns
    // the truth; this honest blurb is what the setup/reveal screens display.
    blurb:
      "You're certain you're the Seer — but you're three sheets to the wind. Your nightly 'visions' are pure nonsense. A villager at heart.",
    disguiseAs: "seer",
    night: { kind: "inspect", order: 22, canTargetSelf: false, reveal: "fabricated" },
  },
  tanner: {
    id: "tanner",
    name: "Tanner",
    team: "solo",
    emoji: "🃏",
    blurb: "You hate your life. You win — alone — if the town votes to eliminate you.",
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
  silencer: {
    id: "silencer",
    name: "Silencer",
    team: "village",
    emoji: "🤫",
    blurb:
      "Each night, choose a player to silence. They cannot cast a vote on the following day. Use it to shut down a manipulator — or a suspected wolf.",
    night: { kind: "silence", order: 35, canTargetSelf: false },
  },
  detective: {
    id: "detective",
    name: "Detective",
    team: "village",
    emoji: "🕵️",
    blurb:
      "Each night, investigate two players and learn whether they are on the same team — without learning which team.",
    night: { kind: "detect", order: 25, canTargetSelf: false },
  },
  medium: {
    id: "medium",
    name: "Medium",
    team: "village",
    emoji: "👻",
    blurb:
      "Once in the game, on a night of your choosing, you may raise a single dead player back to life.",
    night: { kind: "raise", order: 5 },
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
