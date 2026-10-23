import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import {
  aggregate,
  recommendedConfig,
  werewolfRange,
  type GameConfig,
  type GameRecord,
} from "@party/werewolf";
import { Arena } from "./match.js";
import { makeStrategy } from "./lineup.js";
import { LlmStrategy, totalSpend } from "./strategies/llm.js";

/**
 * Sweep table size against wolf count and report how the odds move.
 *
 * Each cell is a fixed deck (exact counts: that many wolves, one of each pool
 * special, Villagers for the rest), so it measures the wolf count itself
 * rather than whatever the balanced dealer would pair with it.
 *
 * Read the result with the difference between floor and ceiling in mind. A
 * `random` sweep measures what a table with no information wins, which is the
 * floor; perfect play wins every time from any of these positions. A setup
 * where the floor is already near half is balanced but has little room for
 * skill; one where the floor is near zero punishes an ordinary mistake with the
 * whole game.
 */

const USAGE = `
Sweep table size against wolf count.

  npm run arena:sweep -- [options]

Options
  --players 5,7,9      table sizes to try (default 5,7,9,11)
  --wolves 1,2,3       wolf counts to try (default 1,2,3)
  --games N            games per combination (default 200)
  --lineup KIND        strategy in every seat: random | heuristic | llm (default random)
  --lethal             let the wolves kill on night one (default: they do not)
  --roles a,b,c        role pool (default villager,seer,doctor)
  --out FILE           append the records here as JSONL

random and heuristic cost nothing, so a wide sweep at high --games is free.
An llm sweep bills per game; check the printed estimate before leaving it.
`;

interface Cell {
  players: number;
  wolves: number;
  games: number;
  villageWins: number;
  lynches: number;
  wolfLynches: number;
  deadlocks: number;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(USAGE);

  const players = numbers(args.players, [5, 7, 9, 11]);
  const wolfCounts = numbers(args.wolves, [1, 2, 3]);
  const games = Number(args.games ?? 200);
  const kind = String(args.lineup ?? "random");
  const outFile = args.out ? String(args.out) : null;
  if (outFile) await ensureDir(outFile);

  // Only combinations the engine will actually deal: at least one wolf, and
  // never so many that the wolves begin at parity.
  const combos = players.flatMap((p) =>
    wolfCounts.filter((w) => w >= 1 && w * 2 < p).map((w) => ({ players: p, wolves: w }))
  );
  if (!combos.length) throw new Error("No legal combination in that range.");

  console.log(
    `Sweeping ${combos.length} combinations x ${games} games, all seats "${kind}"` +
      `${args.lethal ? ", lethal first night" : ", peaceful first night"}`
  );
  if (kind.startsWith("llm"))
    console.log(`That is ${combos.length * games} LLM games — this will cost real money.\n`);

  const arena = await Arena.open();
  const cells: Cell[] = [];
  const seats: LlmStrategy[] = [];
  try {
    for (const { players: p, wolves: w } of combos) {
      const config = configFor(p, w, args);
      const records: GameRecord[] = [];
      for (let i = 0; i < games; i++) {
        const strategies = Array.from({ length: p }, () => makeStrategy(kind));
        seats.push(...strategies.filter((s): s is LlmStrategy => s instanceof LlmStrategy));
        const { record } = await arena.play({ strategies, config, discussionRounds: 2 });
        records.push(record);
        if (outFile) await appendFile(outFile, JSON.stringify(record) + "\n");
      }
      const stats = aggregate(records);
      cells.push({
        players: p,
        wolves: w,
        games: records.length,
        villageWins: stats.teams.find((t) => t.team === "village")?.wins ?? 0,
        lynches: stats.days.lynched,
        wolfLynches: stats.days.wolvesLynched,
        deadlocks: stats.days.tied,
      });
      console.log(`  ${p} players, ${w} wolves: village ${pct(cells.at(-1)!.villageWins / games)}`);
    }
  } finally {
    await arena.close();
  }

  console.log(`\n${grid(cells)}`);
  if (seats.length) {
    const spend = totalSpend(seats);
    console.log(`\nAPI: ${spend.calls} calls · ~$${(spend.dollars ?? 0).toFixed(2)}`);
  }
  if (outFile) console.log(`Records appended to ${outFile}`);
}

function configFor(players: number, wolves: number, args: Args): GameConfig {
  const base = recommendedConfig(players);
  const pool =
    typeof args.roles === "string"
      ? args.roles.split(",").map((r) => r.trim()).filter(Boolean)
      : ["villager", "seer", "doctor"];
  const roleCounts: Record<string, number> = { werewolf: wolves };
  for (const id of pool) if (id !== "villager") roleCounts[id] = 1;
  return {
    ...base,
    selection: { mode: "exact", roleCounts },
    peacefulFirstNight: !args.lethal,
  };
}

/** Village win rate as a grid, plus what the shipped default lands on. */
function grid(cells: Cell[]): string {
  const players = [...new Set(cells.map((c) => c.players))].sort((a, b) => a - b);
  const wolves = [...new Set(cells.map((c) => c.wolves))].sort((a, b) => a - b);
  const lines: string[] = ["Village win rate", ""];
  lines.push(`  ${"players".padEnd(9)}${wolves.map((w) => `${w} wolf`.padStart(10)).join("")}`);
  for (const p of players) {
    const row = wolves.map((w) => {
      const cell = cells.find((c) => c.players === p && c.wolves === w);
      return (cell ? pct(cell.villageWins / cell.games) : "–").padStart(10);
    });
    lines.push(`  ${String(p).padEnd(9)}${row.join("")}`);
  }

  lines.push("");
  lines.push("Wolf counts the shipped dealer may pick from");
  for (const p of players) {
    const { min, max } = werewolfRange(recommendedConfig(p).selection, p);
    lines.push(`  ${String(p).padEnd(3)} players → ${min === max ? min : `${min}-${max}`} wolves`);
  }

  lines.push("");
  // The analytic figure is day-one only. As villagers die the wolf share of the
  // survivors rises, so later lynches are likelier to land by luck alone — which
  // is why a random table can measure above this line without any skill at all.
  // For judging a strategy, compare against a measured random run, not this.
  lines.push("Lynch accuracy vs day-one chance (wolves ÷ others), and wasted days");
  for (const c of cells) {
    const chance = c.wolves / (c.players - 1);
    lines.push(
      `  ${c.players}p/${c.wolves}w  lynches hit a wolf ${pct(c.wolfLynches / Math.max(c.lynches, 1))}` +
        ` (day-one chance ${pct(chance)}) · ${pct(c.deadlocks / Math.max(c.lynches + c.deadlocks, 1))} of days deadlocked`
    );
  }
  return lines.join("\n");
}

type Args = Record<string, string | boolean>;

function numbers(value: string | boolean | undefined, fallback: number[]): number[] {
  if (typeof value !== "string") return fallback;
  const out = value
    .split(",")
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return out.length ? out : fallback;
}

async function ensureDir(file: string) {
  const dir = dirname(file);
  if (dir && dir !== ".") await mkdir(dir, { recursive: true });
}

function parseArgs(argv: string[]): Args {
  const out: Args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith("--")) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next && !next.startsWith("--")) {
      out[key] = next;
      i++;
    } else out[key] = true;
  }
  if ("help" in out || "h" in out) out.help = true;
  return out;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
