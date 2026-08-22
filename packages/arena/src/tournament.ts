import { appendFile, mkdir } from "node:fs/promises";
import { dirname } from "node:path";
import { aggregate, recommendedConfig, type GameConfig, type GameRecord } from "@werewolf/shared";
import { Arena, type Said } from "./match.js";
import { LlmStrategy, totalSpend } from "./strategies/llm.js";
import { getPlaybook, PLAYBOOKS } from "./playbooks.js";
import { analyzeSpeech } from "./speech.js";

/**
 * Play prompt variants against each other and rank them.
 *
 * Every playbook sits at the *same* table, so all of them face the same games,
 * the same deals and the same opponents. Roles are dealt at random, so over
 * enough games each variant draws wolf and village in similar proportion and
 * the per-side win rates are comparable.
 *
 * The caveat worth stating up front: teammates share an outcome. A seat can win
 * because a different playbook on its team played well, which dilutes the
 * measured difference rather than inventing one — so this understates gaps, and
 * needs more games than it feels like it should.
 */

const USAGE = `
Play prompt variants against each other.

  npm run arena:tournament -- [options]

Options
  --playbooks A,B[,C]   variants to seat (default "baseline,specialist")
  --games N             games to play (default 10)
  --players N           seats per game (default 7)
  --model ID            model for every seat (default claude-haiku-4-5)
  --discussion N        times round the table before each vote (default 2)
  --out FILE            append the anonymous records here as JSONL

Known playbooks: ${Object.keys(PLAYBOOKS)
  .map((k) => `${k} — ${PLAYBOOKS[k].about}`)
  .join("\n                 ")}

Example
  npm run arena:tournament -- --playbooks baseline,specialist --games 20
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(USAGE);

  const names = String(args.playbooks ?? "baseline,specialist")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (names.length < 2) throw new Error("Need at least two playbooks to compare.");
  for (const name of names) getPlaybook(name); // fail before spending anything

  const players = Number(args.players ?? 7);
  const games = Number(args.games ?? 10);
  const model = args.model ? String(args.model) : undefined;
  if (players < names.length) throw new Error("Need at least one seat per playbook.");

  // Deal seats round-robin so every variant gets a near-equal share of the table.
  const seating = Array.from({ length: players }, (_, i) => names[i % names.length]);
  const config: GameConfig = recommendedConfig(players);
  const outFile = args.out ? String(args.out) : null;
  if (outFile) await ensureDir(outFile);

  console.log(`Tournament: ${names.join(" vs ")}`);
  console.log(`${games} games of ${players} — seats: ${seating.join(", ")}`);
  console.log("Every variant plays the same games, so the comparison is paired.\n");

  const arena = await Arena.open();
  const played: { record: GameRecord; transcript: readonly Said[] }[] = [];
  const seats: LlmStrategy[] = [];
  try {
    for (let i = 0; i < games; i++) {
      const strategies = seating.map(
        (name) => new LlmStrategy({ model, playbook: getPlaybook(name) })
      );
      seats.push(...strategies);
      const result = await arena.play({
        strategies,
        config,
        discussionRounds: Number(args.discussion ?? 2),
      });
      played.push(result);
      if (outFile) await appendFile(outFile, JSON.stringify(result.record) + "\n");
      console.log(`game ${i + 1}/${games}: ${result.record.winner} won`);
    }
  } finally {
    await arena.close();
  }

  console.log(`\n${table(played)}`);

  const spend = totalSpend(seats);
  const cost = spend.dollars === null ? "unpriced model" : `~$${spend.dollars.toFixed(2)}`;
  console.log(`\nAPI: ${spend.calls} calls · ${cost}`);
  if (spend.leaks) console.log(`${spend.leaks} replies read as notes rather than speech.`);
  if (outFile) console.log(`Records appended to ${outFile}`);
}

/** Win rates side by side, plus how much each variant actually bluffed. */
function table(played: { record: GameRecord; transcript: readonly Said[] }[]): string {
  const stats = aggregate(played.map((p) => p.record));
  const speech = analyzeSpeech(played);
  const lines: string[] = [];

  lines.push(`${stats.games} games · village won ${pct(
    stats.teams.find((t) => t.team === "village")?.rate ?? 0
  )} of them`);
  lines.push(
    `Days: ${stats.days.lynched} lynched, ${stats.days.tied} deadlocked` +
      ` (${pct(stats.days.tied / Math.max(stats.days.lynched + stats.days.tied, 1))} wasted)`
  );
  lines.push("");
  lines.push(
    `  ${"playbook".padEnd(22)} ${"seats".padStart(6)} ${"win".padStart(5)} ${"village".padStart(8)} ${"wolf".padStart(6)} ${"bluffs".padStart(7)}`
  );
  for (const s of stats.strategies) {
    const said = speech.get(s.name);
    // A bluff is a role/vision claim from a seat that was a wolf — a wolf has no
    // visions, so claiming one is a lie by construction.
    const bluffRate = said && said.wolfLines ? pct(said.bluffs / said.wolfLines) : "–";
    lines.push(
      `  ${s.name.padEnd(22)} ${String(s.seats).padStart(6)} ${pct(s.winRate).padStart(5)} ` +
        `${(s.asVillage ? pct(s.villageWinRate) : "–").padStart(8)} ` +
        `${(s.asWerewolf ? pct(s.werewolfWinRate) : "–").padStart(6)} ${bluffRate.padStart(7)}`
    );
  }
  lines.push("");
  lines.push("  bluffs = share of a variant's wolf lines that claimed a role or a vision.");
  lines.push(
    `  With ${stats.games} games, differences under ~${Math.round(
      100 / Math.sqrt(Math.max(stats.games, 1))
    )}pp are noise.`
  );
  return lines.join("\n");
}

async function ensureDir(file: string) {
  const dir = dirname(file);
  if (dir && dir !== ".") await mkdir(dir, { recursive: true });
}

function parseArgs(argv: string[]): Record<string, string | boolean> {
  const out: Record<string, string | boolean> = {};
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
