import {
  getRole,
  dealPreview,
  recommendedConfig,
  validateConfig,
  type GameConfig,
} from "@party/werewolf";

/**
 * What's actually on the table.
 *
 * Worth being deliberate about: the default pool is villager/seer/doctor. The
 * balanced dealer varies which of those two specials appear, but it's still a
 * narrow table: results from it say nothing about how agents handle a Hunter's
 * dying shot, a Detective's same-team read, or a Drunk confidently reporting a
 * vision that never happened.
 */

export interface TableArgs {
  roles?: string | boolean;
  balance?: string | boolean;
  peaceful?: string | boolean;
}

/** Build the game config from `--roles` / `--balance` / `--peaceful`. */
export function tableConfig(args: TableArgs, players: number): GameConfig {
  const base = recommendedConfig(players);
  const pool =
    typeof args.roles === "string"
      ? args.roles
          .split(",")
          .map((r) => r.trim())
          .filter(Boolean)
      : null;
  if (pool) for (const id of pool) getRole(id); // fail loudly on a typo, before spending

  const balance = typeof args.balance === "string" ? args.balance : "even";
  if (balance !== "wolves" && balance !== "even" && balance !== "village")
    throw new Error("--balance must be wolves, even or village.");

  const config: GameConfig = {
    ...base,
    selection: { mode: "pool", pool: pool ?? (base.selection.mode === "pool" ? base.selection.pool : []), balance },
    peacefulFirstNight: !!args.peaceful,
  };

  const problems = validateConfig(config, players);
  if (problems.length) throw new Error(`Unplayable table: ${problems[0].message}`);
  return config;
}

/**
 * One line describing what will be dealt. Says so when every game deals the
 * same roles, since "pool mode" reads as more varied than it may be.
 */
export function describeTable(config: GameConfig, players: number): string {
  const night = config.peacefulFirstNight ? "peaceful first night" : "lethal first night";
  if (config.selection.mode !== "pool")
    return `Table: exact counts, ${night}`;

  const deal = dealPreview(config, players);
  const span = ({ min, max }: { min: number; max: number }) => (min === max ? `${min}` : `${min}-${max}`);
  const fixed = [deal.werewolves, deal.specials, deal.villagers, deal.balance].every((r) => r.min === r.max);
  return (
    `Table: pool [${config.selection.pool.join(", ")}], ${config.selection.balance ?? "even"} balance, ${night}\n` +
    `  ${span(deal.werewolves)} werewolf · ${span(deal.specials)} special · ${span(deal.villagers)} villager` +
    ` · balance ${span(deal.balance)}` +
    (fixed ? "  (every game deals the same roles)" : "  (the specials vary game to game)")
  );
}
