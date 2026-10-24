import type { Balance, GameConfig, Player, RoleSelection } from "./types.js";
import { getRole, isWolf, onWolfTeam, poolEligibleRoles, VILLAGER_ROLE_ID } from "./roles.js";
import { shuffle, makeRng } from "@party/core";

/**
 * The band of wolf counts a pool deal may use, as shares of the table. The
 * dealer picks the count along with the rest of the deck, by balance points.
 */
const WOLF_SHARE_BAND = { min: 0.22, max: 0.36 } as const;


function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * The biggest wolf team a table can start with: strictly less than n/2 - 1,
 * so the wolves are never one death (a night kill, or a single vote) from
 * winning. The whole team counts — a Henchman votes with the pack. At least
 * one, so a tiny table still has a wolf.
 */
export function maxWolfTeam(playerCount: number): number {
  return Math.max(1, Math.ceil(playerCount / 2) - 2);
}

/**
 * The fewest and most wolves a setup can deal: the configured count for exact
 * counts, else the wolf team's share band (capped by maxWolfTeam).
 */
export function werewolfRange(sel: RoleSelection, playerCount: number): { min: number; max: number } {
  if (sel.mode === "exact") {
    const n = exactDeck(sel, 0).filter(isWolf).length;
    return { min: n, max: n };
  }
  const most = maxWolfTeam(playerCount);
  const min = clamp(Math.round(playerCount * WOLF_SHARE_BAND.min), 1, most);
  return { min, max: clamp(Math.round(playerCount * WOLF_SHARE_BAND.max), min, most) };
}

/** The default setup: a role pool, so the deal scales with the table. */
export function recommendedConfig(_playerCount: number): GameConfig {
  return {
    selection: {
      mode: "pool",
      overrides: {},
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
    if (assigned.filter(onWolfTeam).length > maxWolfTeam(playerCount))
      problems.push({ message: "Too many on the wolf team — one death would hand them the game." });
  } else {
    for (const roleId of Object.keys(sel.overrides)) {
      getRole(roleId); // throws on unknown
      if (roleId === "werewolf")
        problems.push({ message: "Werewolves are added automatically — no need to pool them." });
    }
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

/** The roles a pool deal may use at this table size: the host's overrides, else each role's autoFrom. */
export function rolePool(sel: Extract<RoleSelection, { mode: "pool" }>, playerCount: number): string[] {
  return poolEligibleRoles()
    .filter((r) => sel.overrides[r.id] ?? playerCount >= r.autoFrom)
    .map((r) => r.id);
}

/** Overrides that make the pool exactly these roles (for tools and tests). */
export function onlyRoles(ids: readonly string[]): Record<string, boolean> {
  return Object.fromEntries(poolEligibleRoles().map((r) => [r.id, ids.includes(r.id)]));
}

/** The pool's wolf-team specials (they take wolf seats) and the rest (village and solo). */
function splitPool(pool: readonly string[]) {
  return { wolfSpecials: pool.filter(onWolfTeam), restPool: pool.filter((id) => !onWolfTeam(id)) };
}

/**
 * Every candidate deck a pool deal could choose from: random draws of a wolf
 * team size from the wolf share band — Werewolves, plus any wolf-team
 * specials (Infector, Henchman, Poisoner) in some of those seats — then
 * specials in every other seat, never a role twice. Villagers only fill seats
 * the pool runs out of specials for.
 *
 * Acceptable: within BALANCE_TOLERANCE of the target (or, if the pool can't
 * get that close, as near as it gets). The deal picks among these at random,
 * so games vary.
 */
function balancedDecks(config: GameConfig, playerCount: number, rng: () => number): string[][] {
  const sel = config.selection;
  if (sel.mode !== "pool") return [];
  const pool = rolePool(sel, playerCount);
  const { wolfSpecials, restPool } = splitPool(pool);
  const wolves = werewolfRange(sel, playerCount);
  const target = balanceTarget(sel);
  const randInt = (lo: number, hi: number) => lo + Math.floor(rng() * (hi - lo + 1));
  const decks: { deck: string[]; off: number }[] = [];
  for (let i = 0; i < CANDIDATE_DECKS; i++) {
    const wolfCount = randInt(wolves.min, wolves.max);
    const restSeats = Math.max(0, playerCount - wolfCount);
    const k = Math.min(restPool.length, restSeats);
    // Always at least one plain Werewolf, so the pack has a killer.
    const nWolfSpecials = randInt(0, Math.min(wolfSpecials.length, Math.max(0, wolfCount - 1)));
    const deck = [
      ...shuffle(wolfSpecials, rng).slice(0, nWolfSpecials),
      ...Array<string>(wolfCount - nWolfSpecials).fill("werewolf"),
      ...shuffle(restPool, rng).slice(0, k),
      ...Array<string>(restSeats - k).fill(VILLAGER_ROLE_ID),
    ];
    decks.push({ deck, off: Math.abs(deckBalance(deck, config) - target) });
  }
  const bar = Math.max(Math.min(...decks.map((d) => d.off)), BALANCE_TOLERANCE);
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
    const pool = rolePool(sel, playerCount);
    ids.add("werewolf");
    for (const id of pool) ids.add(id);
    // Seats the pool's specials can't fill go to Villagers (roles never repeat),
    // so they're possible even when the Villager isn't ticked.
    const { restPool } = splitPool(pool);
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
