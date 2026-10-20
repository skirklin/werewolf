import type { GameConfig, Player, RoleSelection } from "./types.js";
import { getRole, roleCountsAsWolf, VILLAGER_ROLE_ID } from "./roles.js";
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
    peacefulFirstNight: false,
    chat: true,
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
      // Count only REAL wolves (a Henchman is wolf-team but not a wolf).
      if (roleCountsAsWolf(getRole(roleId))) wolves += Math.max(0, count);
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
      getRole(roleId); // throws on unknown
      if (roleId === "werewolf")
        problems.push({ message: "The base Werewolf is added automatically by the ratio — no need to pool it." });
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
  const restSlots = Math.max(0, playerCount - wolves);
  const restPoolLen = sel.pool.filter(
    (id) => id !== "werewolf" && id !== VILLAGER_ROLE_ID && !roleCountsAsWolf(getRole(id))
  ).length;
  const villagerAllowed = sel.pool.includes(VILLAGER_ROLE_ID);
  const distinct = Math.min(restPoolLen, restSlots);
  return {
    werewolves: wolves, // wolf-team specials (Infector) fill part of this count
    villageSpecials: villagerAllowed ? distinct : restSlots,
    villagers: villagerAllowed ? restSlots - distinct : 0,
  };
}

/**
 * Every role that COULD be in this game — never counts, never who holds what.
 * Public: knowing the menu lets the town reason (and lets a wolf pick a
 * believable cover). In pool mode this is the whole pool, so it can include
 * roles that weren't dealt; in exact mode it's what was set, plus Villagers
 * if any seats fill with them.
 */
export function possibleRoles(config: GameConfig, playerCount: number): string[] {
  const sel = config.selection;
  const ids = new Set<string>();
  if (sel.mode === "exact") {
    let total = 0;
    for (const [roleId, count] of Object.entries(sel.roleCounts)) {
      if (count > 0) ids.add(roleId);
      total += Math.max(0, count);
    }
    if (total < playerCount) ids.add(VILLAGER_ROLE_ID);
  } else {
    ids.add("werewolf");
    for (const id of sel.pool) ids.add(id);
    // A pool with no Villager still pads with repeats, never Villagers, unless
    // it has nothing else to pad with.
    const restPool = sel.pool.filter((id) => id !== VILLAGER_ROLE_ID && !roleCountsAsWolf(getRole(id)));
    if (restPool.length === 0) ids.add(VILLAGER_ROLE_ID);
  }
  // Wolves first, then village, then solo — the order players read a setup in.
  const rank = { werewolf: 0, village: 1, solo: 2 } as const;
  return [...ids].sort((a, b) => rank[getRole(a).team] - rank[getRole(b).team]);
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
    const wolfCount = werewolfCountFor(playerCount, sel.werewolfRatio);
    // Wolf slots: draw wolf-team specials (Infector) from the pool, but always
    // keep at least one plain Werewolf so the pack has a killer.
    const wolfSpecials = sel.pool.filter((id) => id !== "werewolf" && roleCountsAsWolf(getRole(id)));
    const nWolfSpecials = Math.min(wolfSpecials.length, Math.max(0, wolfCount - 1));
    deck.push(...shuffle(wolfSpecials, rng).slice(0, nWolfSpecials));
    for (let i = nWolfSpecials; i < wolfCount; i++) deck.push("werewolf");

    // Remaining slots: village specials, solo roles, and the Henchman (a
    // wolf-ally that doesn't count as a wolf), then villagers or repeats.
    const restSlots = Math.max(0, playerCount - wolfCount);
    const restPool = sel.pool.filter(
      (id) => id !== "werewolf" && id !== VILLAGER_ROLE_ID && !roleCountsAsWolf(getRole(id))
    );
    const villagerAllowed = sel.pool.includes(VILLAGER_ROLE_ID);
    const chosen = shuffle(restPool, rng).slice(0, restSlots);
    deck.push(...chosen);
    for (let i = chosen.length; i < restSlots; i++) {
      deck.push(villagerAllowed || restPool.length === 0 ? VILLAGER_ROLE_ID : pick(restPool, rng));
    }
  }
  while (deck.length < playerCount) deck.push(VILLAGER_ROLE_ID);
  return deck.slice(0, playerCount);
}
