import type { Balance, GameConfig, Player, RoleSelection } from "./types.js";
import { getRole, isWolf, onWolfTeam, VILLAGER_ROLE_ID } from "./roles.js";
import { shuffle, makeRng } from "@party/core";

/**
 * The band of wolf counts a pool deal may use, as shares of the table. The
 * dealer picks the count along with the rest of the deck, by balance points.
 */
const WOLF_SHARE_BAND = { min: 0.22, max: 0.36 } as const;

/** A conservative, familiar default pool (the rest can be toggled on). */
const DEFAULT_POOL = ["villager", "seer", "doctor"];

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * The fewest and most wolves a setup can deal: the configured count for exact
 * counts, else the wolf share band (kept legal: never half the table).
 */
export function werewolfRange(sel: RoleSelection, playerCount: number): { min: number; max: number } {
  if (sel.mode === "exact") {
    const n = exactDeck(sel, 0).filter(isWolf).length;
    return { min: n, max: n };
  }
  const most = Math.max(1, Math.floor((playerCount - 1) / 2)); // wolves*2 < players
  const min = clamp(Math.round(playerCount * WOLF_SHARE_BAND.min), 1, most);
  return { min, max: clamp(Math.round(playerCount * WOLF_SHARE_BAND.max), min, most) };
}

/** The default setup: a role pool, so the deal scales with the table. */
export function recommendedConfig(_playerCount: number): GameConfig {
  return {
    selection: {
      mode: "pool",
      pool: [...DEFAULT_POOL],
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
    for (const [roleId, count] of Object.entries(sel.roleCounts)) {
      if (count < 0) problems.push({ message: `${roleId} count cannot be negative.` });
      if (roleId === VILLAGER_ROLE_ID)
        problems.push({ message: "Villagers are automatic; don't set them explicitly." });
      else getRole(roleId); // throws on unknown role id
    }
    const assigned = exactDeck(sel, 0);
    if (!assigned.some(isWolf)) problems.push({ message: "Need at least 1 werewolf." });
    if (assigned.length > playerCount)
      problems.push({ message: `Assigned roles (${assigned.length}) exceed player count (${playerCount}).` });
    // The whole wolf team counts toward the wolves' majority (a Henchman votes with them).
    if (assigned.filter(onWolfTeam).length * 2 >= playerCount)
      problems.push({ message: "Too many on the wolf team — the wolves would start already winning." });
  } else {
    for (const roleId of sel.pool) {
      getRole(roleId); // throws on unknown
      if (roleId === "werewolf")
        problems.push({ message: "Werewolves are added automatically — no need to pool them." });
    }
    if (sel.pool.length === 0) problems.push({ message: "Add at least one role to the pool." });
    const hasVillageSide = sel.pool.some(
      (id) => id === VILLAGER_ROLE_ID || getRole(id).team === "village"
    );
    if (sel.pool.length > 0 && !hasVillageSide)
      problems.push({ message: "Add a Villager or a village role so the town has a side." });
  }
  return problems;
}

/**
 * Balance targets, in role weight points (see RoleDef.weight). Zero is an even
 * game on the Ultimate Werewolf scale; each side's preset leans four points
 * its way. Tune these as finished games come in.
 */
const BALANCE_TARGETS: Record<Balance, number> = { wolves: -4, even: 0, village: 4 };
/** How far a deal may land from its target (when the pool can get that close). */
export const BALANCE_TOLERANCE = 2;
/** Candidate decks drawn per deal; plenty to find the in-band ones at any table size. */
const CANDIDATE_DECKS = 600;

/** What the house rules are worth, in the same points: each one helps the village. */
function houseRuleBalance(config: GameConfig): number {
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
function balanceTarget(sel: RoleSelection): number {
  return BALANCE_TARGETS[(sel.mode === "pool" && sel.balance) || "even"];
}

/** Specials that can fill a wolf seat (Infector), and the rest of the pool (village, solo, Henchman). */
function splitPool(pool: readonly string[]) {
  const wolfSpecials = pool.filter((id) => id !== "werewolf" && isWolf(id));
  const restPool = pool.filter(
    (id) => id !== "werewolf" && id !== VILLAGER_ROLE_ID && !isWolf(id)
  );
  return { wolfSpecials, restPool };
}

/**
 * Every candidate deck a pool deal could choose from: random draws of a wolf
 * count from the wolf share band, wolf specials and other specials, Villagers
 * in the seats left over, never a role twice (bar Werewolves and Villagers).
 *
 * Acceptable: within BALANCE_TOLERANCE of the target (or, if the pool can't
 * get that close, as near as it gets), with at most a quarter of the table
 * plain Villagers (or as few as the pool allows) — a table of Villagers is no
 * fun. The deal picks among these at random, so games vary.
 */
function balancedDecks(config: GameConfig, playerCount: number, rng: () => number): string[][] {
  const sel = config.selection;
  if (sel.mode !== "pool") return [];
  const { wolfSpecials, restPool } = splitPool(sel.pool);
  const wolves = werewolfRange(sel, playerCount);
  // Without Villagers in the pool, specials fill every seat they can.
  const villagerAllowed = sel.pool.includes(VILLAGER_ROLE_ID);
  const target = balanceTarget(sel);
  const randInt = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const villagers = (deck: string[]) => deck.filter((id) => id === VILLAGER_ROLE_ID).length;
  const decks: { deck: string[]; off: number; villagers: number }[] = [];
  for (let i = 0; i < CANDIDATE_DECKS; i++) {
    const wolfCount = randInt(wolves.min, wolves.max);
    const restSeats = Math.max(0, playerCount - wolfCount);
    const most = Math.min(restPool.length, restSeats);
    // Always at least one plain Werewolf, so the pack has a killer.
    const nWolfSpecials = randInt(0, Math.min(wolfSpecials.length, Math.max(0, wolfCount - 1)));
    const k = villagerAllowed ? randInt(0, most) : most;
    const deck = [
      ...shuffle(wolfSpecials, rng).slice(0, nWolfSpecials),
      ...Array<string>(wolfCount - nWolfSpecials).fill("werewolf"),
      ...shuffle(restPool, rng).slice(0, k),
      ...Array<string>(restSeats - k).fill(VILLAGER_ROLE_ID),
    ];
    // A Henchman votes with the pack, so the whole team must start short of half.
    if (deck.filter(onWolfTeam).length * 2 >= playerCount) continue;
    decks.push({ deck, off: Math.abs(deckBalance(deck, config) - target), villagers: villagers(deck) });
  }
  // Every draw put the wolf team at half the table: fall back to plain wolves and Villagers.
  if (!decks.length) {
    const wolves = Array<string>(werewolfRange(sel, playerCount).min).fill("werewolf");
    return [[...wolves, ...Array<string>(Math.max(0, playerCount - wolves.length)).fill(VILLAGER_ROLE_ID)]];
  }
  const bar = Math.max(Math.min(...decks.map((d) => d.off)), BALANCE_TOLERANCE);
  const near = decks.filter((d) => d.off <= bar);
  const cap = Math.max(Math.floor(playerCount / 4), Math.min(...near.map((d) => d.villagers)));
  return near.filter((d) => d.villagers <= cap).map((d) => d.deck);
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
    decks.push(exactDeck(sel, playerCount));
  } else {
    decks.push(...balancedDecks(config, playerCount, makeRng(1)));
  }
  const span = (f: (d: string[]) => number) => {
    const xs = decks.map(f);
    return xs.length ? { min: Math.min(...xs), max: Math.max(...xs) } : { min: 0, max: 0 };
  };
  const count = (pred: (id: string) => boolean) => (d: string[]) => d.filter(pred).length;
  return {
    werewolves: span(count(isWolf)),
    specials: span(count((id) => id !== VILLAGER_ROLE_ID && !isWolf(id))),
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

/** An exact-counts deck: the configured roles, then Villagers up to `playerCount`. */
function exactDeck(sel: Extract<RoleSelection, { mode: "exact" }>, playerCount: number): string[] {
  const deck = Object.entries(sel.roleCounts).flatMap(([id, c]) => Array<string>(Math.max(0, c)).fill(id));
  while (deck.length < playerCount) deck.push(VILLAGER_ROLE_ID);
  return deck;
}

function buildDeck(config: GameConfig, playerCount: number, rng: () => number): string[] {
  const sel = config.selection;
  if (sel.mode === "exact") return exactDeck(sel, playerCount).slice(0, playerCount);
  const choices = balancedDecks(config, playerCount, rng);
  return choices[Math.floor(rng() * choices.length)];
}
