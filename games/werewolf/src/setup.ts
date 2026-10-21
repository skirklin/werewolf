import type { Balance, GameConfig, Player, RoleSelection } from "./types.js";
import { getRole, roleCountsAsWolf, VILLAGER_ROLE_ID } from "./roles.js";
import { shuffle, makeRng } from "./rng.js";

/**
 * Default target fraction of werewolves in pool mode (~3 per 10 players). Was
 * 0.26; tables kept losing to the village, so the default leans a little
 * further toward the wolves.
 */
export const DEFAULT_WEREWOLF_RATIO = 0.3;

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
 * The fewest and most wolves a setup can deal. Equal unless the count varies,
 * in which case it's the ratio's whole count or one more (both kept legal).
 */
export function werewolfRange(sel: RoleSelection, playerCount: number): { min: number; max: number } {
  if (sel.mode === "exact") {
    let n = 0;
    for (const [roleId, count] of Object.entries(sel.roleCounts))
      if (roleCountsAsWolf(getRole(roleId))) n += Math.max(0, count);
    return { min: n, max: n };
  }
  if (!sel.wolfCountVaries) {
    const n = werewolfCountFor(playerCount, sel.werewolfRatio);
    return { min: n, max: n };
  }
  const most = Math.max(1, Math.floor((playerCount - 1) / 2));
  const min = clamp(Math.floor(playerCount * sel.werewolfRatio), 1, most);
  return { min, max: Math.min(min + 1, most) };
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
    // Nobody dies before the town has said a word — the friendlier default.
    peacefulFirstNight: true,
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
    // The whole wolf team counts toward the wolves' majority (a Henchman votes with them).
    const pack = Object.entries(sel.roleCounts).reduce(
      (n, [id, c]) => n + (getRole(id).team === "werewolf" ? Math.max(0, c) : 0),
      0
    );
    if (pack * 2 >= playerCount)
      problems.push({ message: "Too many on the wolf team — the wolves would start already winning." });
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
  playerCount: number,
  /** Preview with this many wolves (pool mode), e.g. each end of werewolfRange. */
  wolfCount?: number
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
  const wolves = wolfCount ?? werewolfRange(sel, playerCount).min;
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
 * Balance targets, in role weight points (see RoleDef.weight). Zero is an even
 * game on the Ultimate Werewolf scale; each side's preset leans four points
 * its way. Tune these as finished games come in.
 */
export const BALANCE_TARGETS: Record<Balance, number> = { wolves: -4, even: 0, village: 4 };
/** How far a deal may land from its target (when the pool can get that close). */
export const BALANCE_TOLERANCE = 2;
/** Candidate decks drawn per deal; plenty to find the in-band ones at any table size. */
const CANDIDATE_DECKS = 400;

/** What the house rules are worth, in the same points: each one helps the village. */
export function houseRuleBalance(config: GameConfig): number {
  return (
    (config.peacefulFirstNight ? 2 : 0) +
    (config.revealRoleOnDeath ? 2 : 0) +
    (config.nightSummary === "detailed" ? 1 : 0)
  );
}

/** A deck's balance: its roles' weights plus the house rules. Positive favors the village. */
export function deckBalance(deck: readonly string[], config: GameConfig): number {
  return deck.reduce((sum, id) => sum + getRole(id).weight, 0) + houseRuleBalance(config);
}

/** The balance a pool deal aims for. */
export function balanceTarget(sel: RoleSelection): number {
  return BALANCE_TARGETS[(sel.mode === "pool" && sel.balance) || "even"];
}

/** Specials that can fill a wolf seat (Infector), and the rest of the pool (village, solo, Henchman). */
function splitPool(pool: readonly string[]) {
  const wolfSpecials = pool.filter((id) => id !== "werewolf" && roleCountsAsWolf(getRole(id)));
  const restPool = pool.filter(
    (id) => id !== "werewolf" && id !== VILLAGER_ROLE_ID && !roleCountsAsWolf(getRole(id))
  );
  return { wolfSpecials, restPool };
}

/**
 * Every candidate deck a pool deal could choose from, given its wolf count:
 * random draws of wolf specials and other specials, Villagers in the seats
 * left over, never a role twice (bar Werewolves and Villagers). Kept: the
 * decks whose balance lands within BALANCE_TOLERANCE of the target, or, if the
 * pool can't get that close, the nearest ones.
 */
function balancedDecks(config: GameConfig, playerCount: number, wolfCount: number, rng: () => number): string[][] {
  const sel = config.selection;
  if (sel.mode !== "pool") return [];
  const { wolfSpecials, restPool } = splitPool(sel.pool);
  const restSeats = Math.max(0, playerCount - wolfCount);
  // Without Villagers in the pool, specials fill every seat they can.
  const villagerAllowed = sel.pool.includes(VILLAGER_ROLE_ID);
  const most = Math.min(restPool.length, restSeats);
  const target = balanceTarget(sel);
  const randInt = (n: number) => Math.floor(rng() * (n + 1)); // 0..n
  const decks: { deck: string[]; off: number }[] = [];
  for (let i = 0; i < CANDIDATE_DECKS; i++) {
    // Always at least one plain Werewolf, so the pack has a killer.
    const nWolfSpecials = randInt(Math.min(wolfSpecials.length, Math.max(0, wolfCount - 1)));
    const k = villagerAllowed ? randInt(most) : most;
    const deck = [
      ...shuffle(wolfSpecials, rng).slice(0, nWolfSpecials),
      ...Array<string>(wolfCount - nWolfSpecials).fill("werewolf"),
      ...shuffle(restPool, rng).slice(0, k),
      ...Array<string>(restSeats - k).fill(VILLAGER_ROLE_ID),
    ];
    // A Henchman votes with the pack, so the whole team must start short of half.
    if (deck.filter((id) => getRole(id).team === "werewolf").length * 2 >= playerCount) continue;
    decks.push({ deck, off: Math.abs(deckBalance(deck, config) - target) });
  }
  if (!decks.length) return [];
  const best = Math.min(...decks.map((d) => d.off));
  const bar = Math.max(best, BALANCE_TOLERANCE);
  return decks.filter((d) => d.off <= bar).map((d) => d.deck);
}

export interface DealPreview {
  werewolves: { min: number; max: number };
  specials: { min: number; max: number };
  villagers: { min: number; max: number };
  /** Balance points of the decks this setup deals (equal for exact counts). */
  balance: { min: number; max: number };
  /** What a pool deal aims for (null for exact counts). */
  target: number | null;
}

/**
 * What this setup will deal, as ranges over the decks it could choose (for the
 * setup screen). Uses a fixed seed, so the preview doesn't flicker.
 */
export function dealPreview(config: GameConfig, playerCount: number): DealPreview {
  const sel = config.selection;
  const decks: string[][] = [];
  if (sel.mode === "exact") {
    const deck = Object.entries(sel.roleCounts).flatMap(([id, c]) => Array<string>(Math.max(0, c)).fill(id));
    while (deck.length < playerCount) deck.push(VILLAGER_ROLE_ID);
    decks.push(deck);
  } else {
    const range = werewolfRange(sel, playerCount);
    for (let w = range.min; w <= range.max; w++) decks.push(...balancedDecks(config, playerCount, w, makeRng(1)));
  }
  const span = (f: (d: string[]) => number) => {
    const xs = decks.map(f);
    return xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : { min: 0, max: 0 };
  };
  const count = (pred: (id: string) => boolean) => (d: string[]) => d.filter(pred).length;
  return {
    werewolves: span(count((id) => getRole(id).team === "werewolf" && roleCountsAsWolf(getRole(id)))),
    specials: span(count((id) => id !== VILLAGER_ROLE_ID && !(getRole(id).team === "werewolf" && roleCountsAsWolf(getRole(id))))),
    villagers: span(count((id) => id === VILLAGER_ROLE_ID)),
    balance: span((d) => deckBalance(d, config)),
    target: sel.mode === "pool" ? balanceTarget(sel) : null,
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
    // Seats the pool's specials can't fill go to Villagers (roles never repeat),
    // so they're possible even when the Villager isn't ticked.
    const { restPool } = splitPool(sel.pool);
    if (restPool.length < playerCount - werewolfRange(sel, playerCount).min) ids.add(VILLAGER_ROLE_ID);
  }
  // Wolves first, then village, then solo — the order players read a setup in.
  const rank = { werewolf: 0, village: 1, solo: 2 } as const;
  return [...ids].sort((a, b) => rank[getRole(a).team] - rank[getRole(b).team]);
}

/** Build and shuffle the role deck, then deal it. Fair Fisher-Yates over the RNG. */
export function dealRoles(players: Player[], config: GameConfig, rng: () => number): Player[] {
  const deck = buildDeck(config, players.length, rng);
  const dealt = shuffle(deck, rng);
  return players.map((p, i) => ({ ...p, roleId: dealt[i] }));
}

function buildDeck(config: GameConfig, playerCount: number, rng: () => number): string[] {
  const sel = config.selection;
  const deck: string[] = [];
  if (sel.mode === "exact") {
    for (const [roleId, count] of Object.entries(sel.roleCounts)) {
      for (let i = 0; i < Math.max(0, count); i++) deck.push(roleId);
    }
  } else {
    const range = werewolfRange(sel, playerCount);
    // Only draw when it can vary, so a fixed count leaves the shuffle untouched.
    const wolfCount = range.max > range.min && rng() < 0.5 ? range.max : range.min;
    const choices = balancedDecks(config, playerCount, wolfCount, rng);
    if (choices.length) deck.push(...choices[Math.floor(rng() * choices.length)]);
    else deck.push(...Array<string>(wolfCount).fill("werewolf"));
  }
  while (deck.length < playerCount) deck.push(VILLAGER_ROLE_ID);
  return deck.slice(0, playerCount);
}
