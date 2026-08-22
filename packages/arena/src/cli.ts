import { appendFile, mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { aggregate, recommendedConfig, type GameConfig, type GameRecord } from "@werewolf/shared";
import { Arena } from "./match.js";
import { report, confidenceNote } from "./report.js";
import { makeStrategy, parseLineup, STRATEGY_HELP } from "./lineup.js";
import { LlmStrategy, totalSpend } from "./strategies/llm.js";

const USAGE = `
Agent-vs-agent Werewolf.

  npm run arena -- [options]

Options
  --games N            games to play (default 5)
  --lineup SPEC        who sits at the table (default "heuristic:4,random:3")
  --model ID           model for llm seats (default claude-haiku-4-5)
  --discussion N       times round the table before each vote (default 2)
  --peaceful           no werewolf kill on the first night
  --out FILE           append the anonymous game records here as JSONL
  --transcript FILE    write everything that was said here
  --quiet              only print the final table

${STRATEGY_HELP}

Examples
  npm run arena -- --games 20 --lineup random:7
  npm run arena -- --games 10 --lineup llm:4,heuristic:3
  npm run arena -- --games 6 --lineup llm:3,llm@claude-sonnet-5:4
`;

async function main() {
  const args = parseArgs(process.argv.slice(2));
  if (args.help) return console.log(USAGE);

  const lineup = parseLineup(String(args.lineup ?? "heuristic:4,random:3"));
  if (lineup.length < 3) throw new Error("Need at least 3 seats to play.");
  const games = Number(args.games ?? 5);
  const model = args.model ? String(args.model) : undefined;
  const quiet = !!args.quiet;

  const config: GameConfig = {
    ...recommendedConfig(lineup.length),
    peacefulFirstNight: !!args.peaceful,
  };

  console.log(
    `Playing ${games} game${games === 1 ? "" : "s"} of ${lineup.length}: ${lineup.join(", ")}`
  );
  if (lineup.some((s) => s.startsWith("llm")))
    console.log("LLM seats will call the Anthropic API — this costs money.\n");

  const arena = await Arena.open();
  const records: GameRecord[] = [];
  const transcripts: string[] = [];
  const llmSeats: LlmStrategy[] = [];
  try {
    for (let i = 0; i < games; i++) {
      const strategies = lineup.map((spec) => makeStrategy(spec, model));
      llmSeats.push(...strategies.filter((s): s is LlmStrategy => s instanceof LlmStrategy));
      if (!quiet) console.log(`\n─── game ${i + 1}/${games} ───`);
      const result = await arena.play({
        strategies,
        config,
        discussionRounds: Number(args.discussion ?? 2),
        onEvent: quiet ? undefined : (line) => console.log(line),
      });
      records.push(result.record);
      for (const said of result.transcript)
        transcripts.push(`[game ${i + 1} day ${said.round}] ${said.speaker} (${said.strategy}): ${said.text}`);
      if (quiet) process.stdout.write(".");
    }
  } finally {
    await arena.close();
  }

  console.log(`\n\n${report(records)}${confidenceNote(aggregate(records))}`);

  if (llmSeats.length) {
    const spend = totalSpend(llmSeats);
    const cost = spend.dollars === null ? "unpriced model" : `~$${spend.dollars.toFixed(2)}`;
    const perGame =
      spend.dollars !== null && records.length
        ? ` · $${(spend.dollars / records.length).toFixed(3)}/game`
        : "";
    console.log(
      `\nAPI: ${spend.calls} calls · ${fmt(spend.inputTokens)} in / ${fmt(spend.outputTokens)} out · ${cost}${perGame}` +
        (spend.failures ? `\n${spend.failures} calls fell back to a random move.` : "")
    );
  }

  if (args.out) {
    await ensureDir(String(args.out));
    await appendFile(String(args.out), records.map((r) => JSON.stringify(r)).join("\n") + "\n");
    console.log(`\nRecords appended to ${args.out}`);
  }
  if (args.transcript) {
    await ensureDir(String(args.transcript));
    await writeFile(String(args.transcript), transcripts.join("\n") + "\n");
    console.log(`Transcript written to ${args.transcript}`);
  }
}

const fmt = (n: number) => (n >= 1000 ? `${Math.round(n / 1000)}k` : String(n));

async function ensureDir(file: string) {
  const dir = dirname(file);
  if (dir && dir !== ".") await mkdir(dir, { recursive: true });
}

/** Bare-bones `--flag value` / `--flag` parsing; no dependency needed for this. */
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

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
