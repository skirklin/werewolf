import type { GameConfig, Player, RoleSelection } from "./types.js";
import { getRole, ROLES, VILLAGER_ROLE_ID } from "./roles.js";
import { shuffle } from "./rng.js";

/** Default target fraction of werewolves in pool mode (~1 per 4 players). */
export const DEFAULT_WEREWOLF_RATIO = 0.26;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** How many wolves for a given player count + ratio, kept in the legal range. */
export function werewolfCountFor(playerCount: number, ratio: number): number {
  const max = Math.max(1, Math.floor((playerCount - 1) / 2)); // wolves*2 < players
  return clamp(Math.round(playerCount * ratio), 1, max);
}

/** Village-team special roles available to seed a pool. */
export function villageSpecialRoles() {
  return Object.values(ROLES).filter(
    (r) => r.team === "village" && r.id !== VILLAGER_ROLE_ID
  );
}

/**
 * Recommend a balanced setup. Defaults to pool mode so the werewolf count
 * always scales with the table — the fix for the "bad random selection"
 * complaint.
 */
export function recommendedConfig(_playerCount: number): GameConfig {
  return {
    selection: {
      mode: "pool",
      pool: villageSpecialRoles().map((r) => r.id),
      werewolfRatio: DEFAULT_WEREWOLF_RATIO,
    },
    revealRoleOnDeath: false,
    nightSummary: "discreet",
  };
}

export interface ConfigProblem {
  message: string;
}

/** Validate a config against a player count. Returns [] when playable. */
export function validateConfig(config: GameConfig, playerCount: number): ConfigProblem[] {
  const problems: ConfigProblem[] = [];
  if (playerCount < 3) problems.push({ message: "Need at least 3 players to start." });

  const sel = config.selection;
  if (sel.mode === "exact") {
    let specialTotal = 0;
    let wolves = 0;
    for (const [roleId, count] of Object.entries(sel.roleCounts)) {
      if (count < 0) problems.push({ message: `${roleId} count cannot be negative.` });
      if (roleId === VILLAGER_ROLE_ID)
        problems.push({ message: "Villagers are automatic; don't set them explicitly." });
      else getRole(roleId); // throws on unknown role id
      specialTotal += Math.max(0, count);
      if (getRole(roleId).team === "werewolf") wolves += Math.max(0, count);
    }
    if (wolves < 1) problems.push({ message: "Need at least 1 werewolf." });
    if (specialTotal > playerCount)
      problems.push({
        message: `Assigned roles (${specialTotal}) exceed player count (${playerCount}).`,
      });
    if (wolves * 2 >= playerCount)
      problems.push({ message: "Too many werewolves — the wolves would start already winning." });
  } else {
    for (const roleId of sel.pool) {
      const role = getRole(roleId); // throws on unknown
      if (role.team === "werewolf")
        problems.push({ message: "Don't add werewolves to the pool — their count comes from the ratio." });
    }
    if (sel.werewolfRatio <= 0) problems.push({ message: "Werewolf ratio must be above zero." });
  }
  return problems;
}

/** Human-readable summary of who will be dealt (used by the UI to preview). */
export function previewComposition(
  config: GameConfig,
  playerCount: number
): { werewolves: number; villageSpecials: number; villagers: number } {
  const sel = config.selection;
  if (sel.mode === "exact") {
    let wolves = 0;
    let specials = 0;
    for (const [roleId, count] of Object.entries(sel.roleCounts)) {
      const c = Math.max(0, count);
      if (getRole(roleId).team === "werewolf") wolves += c;
      else specials += c;
    }
    return {
      werewolves: wolves,
      villageSpecials: specials,
      villagers: Math.max(0, playerCount - wolves - specials),
    };
  }
  const wolves = werewolfCountFor(playerCount, sel.werewolfRatio);
  const villageSpecials = Math.min(sel.pool.length, playerCount - wolves);
  return { werewolves: wolves, villageSpecials, villagers: playerCount - wolves - villageSpecials };
}

/** Build and shuffle the role deck, then deal it. Fair Fisher-Yates over the RNG. */
export function dealRoles(players: Player[], config: GameConfig, rng: () => number): Player[] {
  const deck = buildDeck(config.selection, players.length, rng);
  const dealt = shuffle(deck, rng);
  return players.map((p, i) => ({ ...p, roleId: dealt[i] }));
}

function buildDeck(sel: RoleSelection, playerCount: number, rng: () => number): string[] {
  const deck: string[] = [];
  if (sel.mode === "exact") {
    for (const [roleId, count] of Object.entries(sel.roleCounts)) {
      for (let i = 0; i < Math.max(0, count); i++) deck.push(roleId);
    }
  } else {
    const wolves = werewolfCountFor(playerCount, sel.werewolfRatio);
    for (let i = 0; i < wolves; i++) deck.push("werewolf");
    // Fill remaining non-wolf slots by drawing village specials from the pool
    // (each at most once), then top up with plain villagers.
    const slots = playerCount - wolves;
    const chosen = shuffle(sel.pool, rng).slice(0, Math.max(0, slots));
    deck.push(...chosen);
  }
  while (deck.length < playerCount) deck.push(VILLAGER_ROLE_ID);
  return deck.slice(0, playerCount);
}
