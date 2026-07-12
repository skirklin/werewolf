import type { GameConfig, Player, RoleSelection } from "./types.js";
import { getRole, VILLAGER_ROLE_ID } from "./roles.js";
import { shuffle, pick } from "./rng.js";

/** Default target fraction of werewolves in pool mode (~1 per 4 players). */
export const DEFAULT_WEREWOLF_RATIO = 0.26;

/** A conservative, familiar default pool (the rest can be toggled on). */
const DEFAULT_POOL = ["villager", "seer", "doctor"];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** How many wolves for a given player count + ratio, kept in the legal range. */
export function werewolfCountFor(playerCount: number, ratio: number): number {
  const max = Math.max(1, Math.floor((playerCount - 1) / 2)); // wolves*2 < players
  return clamp(Math.round(playerCount * ratio), 1, max);
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
      pool: [...DEFAULT_POOL],
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
    if (sel.pool.length === 0) problems.push({ message: "Add at least one role to the pool." });
    const hasVillageSide = sel.pool.some(
      (id) => id === VILLAGER_ROLE_ID || getRole(id).team === "village"
    );
    if (sel.pool.length > 0 && !hasVillageSide)
      problems.push({ message: "Add a Villager or a village role so the town has a side." });
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
  const slots = Math.max(0, playerCount - wolves);
  const specialPoolLen = sel.pool.filter((r) => r !== VILLAGER_ROLE_ID).length;
  const villagerAllowed = sel.pool.includes(VILLAGER_ROLE_ID);
  const distinct = Math.min(specialPoolLen, slots);
  // Without villagers, the remaining slots draw more (possibly repeated) specials.
  const villageSpecials = villagerAllowed ? distinct : slots;
  return {
    werewolves: wolves,
    villageSpecials,
    villagers: villagerAllowed ? slots - distinct : 0,
  };
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
    const slots = Math.max(0, playerCount - wolves);
    const specialPool = sel.pool.filter((r) => r !== VILLAGER_ROLE_ID);
    const villagerAllowed = sel.pool.includes(VILLAGER_ROLE_ID);
    // Distinct specials first (each at most once)...
    const chosen = shuffle(specialPool, rng).slice(0, slots);
    deck.push(...chosen);
    // ...then fill the rest: villagers if allowed, else repeated specials.
    for (let i = chosen.length; i < slots; i++) {
      deck.push(villagerAllowed || specialPool.length === 0 ? VILLAGER_ROLE_ID : pick(specialPool, rng));
    }
  }
  while (deck.length < playerCount) deck.push(VILLAGER_ROLE_ID);
  return deck.slice(0, playerCount);
}
