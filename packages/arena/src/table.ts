import {
  DEFAULT_WEREWOLF_RATIO,
  getRole,
  previewComposition,
  recommendedConfig,
  validateConfig,
  werewolfCountFor,
  type GameConfig,
} from "@werewolf/shared";

/**
 * What's actually on the table.
 *
 * Worth being deliberate about: the default pool is villager/seer/doctor, which
 * at seven seats forces exactly one composition — 2 wolves, 1 seer, 1 doctor,
 * 3 villagers, every single game. That makes the Seer the village's only
 * information source and the Doctor its only protection, so results from it say
 * nothing about how agents handle a Hunter's dying shot, a Detective's
 * same-team read, or a Drunk confidently reporting a vision that never happened.
 */

export interface TableArgs {
  roles?: string | boolean;
  ratio?: string | boolean;
  peaceful?: string | boolean;
}

/** Build the game config from `--roles` / `--ratio` / `--peaceful`. */
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

  const ratio = typeof args.ratio === "string" ? Number(args.ratio) : DEFAULT_WEREWOLF_RATIO;
  if (!Number.isFinite(ratio) || ratio <= 0) throw new Error("--ratio must be above zero.");

  const config: GameConfig = {
    ...base,
    selection: pool
      ? { mode: "pool", pool, werewolfRatio: ratio }
      : { ...base.selection, ...(base.selection.mode === "pool" ? { werewolfRatio: ratio } : {}) },
    peacefulFirstNight: !!args.peaceful,
  };

  const problems = validateConfig(config, players);
  if (problems.length) throw new Error(`Unplayable table: ${problems[0].message}`);
  return config;
}

/**
 * One line describing what will be dealt. Prints the fixed composition when the
 * pool cannot fill the table, since "pool mode" reads as more varied than it is.
 */
export function describeTable(config: GameConfig, players: number): string {
  const comp = previewComposition(config, players);
  const night = config.peacefulFirstNight ? "peaceful first night" : "lethal first night";
  if (config.selection.mode !== "pool")
    return `Table: exact counts, ${night}`;

  const pool = config.selection.pool;
  const wolves = werewolfCountFor(players, config.selection.werewolfRatio);
  const drawable = pool.filter((id) => id !== "villager" && getRole(id).team !== "werewolf");
  const fixed = drawable.length <= players - wolves;
  return (
    `Table: ${wolves} wolves + pool [${pool.join(", ")}], ${night}\n` +
    `  ${comp.werewolves} werewolf · ${comp.villageSpecials} special · ${comp.villagers} villager` +
    (fixed
      ? "  (pool fits the table, so every game deals the same roles)"
      : "  (pool exceeds the table, so the specials vary game to game)")
  );
}
