import { appendFile } from "node:fs/promises";
import { aggregate, type GameRecord } from "@party/werewolf";
import { ensureDir, parseArgs } from "./args.js";
import { Arena } from "./match.js";
import { report, confidenceNote } from "./report.js";
import { makeStrategy, parseLineup, STRATEGY_HELP } from "./lineup.js";
import { transcriptLine } from "./saved.js";
import { LlmStrategy, spendLine, totalSpend } from "./strategies/llm.js";
import { tableConfig, describeTable } from "./table.js";

const USAGE = `
Agent-vs-agent Werewolf.

  npm run arena -- [options]

Options
  --games N            games to play (default 5)
  --lineup SPEC        who sits at the table (default "heuristic:4,random:3")
  --model ID           model for llm seats (default claude-haiku-4-5)
  --playbook NAME      prompt variant for llm seats (default baseline)
  --discussion N       times round the table before each vote (default 2)
  --peaceful           no werewolf kill on the first night
  --roles a,b,c        role pool to draw from (default villager,seer,doctor)
  --balance B          wolves | even | village: which side the deal favors (default even)
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
  const playbook = args.playbook ? String(args.playbook) : undefined;
  const quiet = !!args.quiet;

  const config = tableConfig(args, lineup.length);

  console.log(
    `Playing ${games} game${games === 1 ? "" : "s"} of ${lineup.length}: ${lineup.join(", ")}`
  );
  console.log(describeTable(config, lineup.length));
  if (lineup.some((s) => s.startsWith("llm")))
    console.log("LLM seats will call the Anthropic API — this costs money.\n");

  // Written as each game finishes, not at the end: a long LLM run is expensive
  // enough that losing it to a crash on the last game would be a real loss.
  const outFile = args.out ? String(args.out) : null;
  const transcriptFile = args.transcript ? String(args.transcript) : null;
  if (outFile) await ensureDir(outFile);
  if (transcriptFile) await ensureDir(transcriptFile);

  const arena = await Arena.open();
  const records: GameRecord[] = [];
  const transcripts: string[] = [];
  const llmSeats: LlmStrategy[] = [];
  try {
    for (let i = 0; i < games; i++) {
      const strategies = lineup.map((spec) => makeStrategy(spec, model, playbook));
      llmSeats.push(...strategies.filter((s): s is LlmStrategy => s instanceof LlmStrategy));
      if (!quiet) console.log(`\n─── game ${i + 1}/${games} ───`);
      const result = await arena.play({
        strategies,
        config,
        discussionRounds: Number(args.discussion ?? 2),
        onEvent: quiet ? undefined : (line) => console.log(line),
      });
      records.push(result.record);
      const lines = result.transcript.map((said) => transcriptLine(i + 1, said));
      transcripts.push(...lines);
      if (outFile) await appendFile(outFile, JSON.stringify(result.record) + "\n");
      if (transcriptFile && lines.length) await appendFile(transcriptFile, lines.join("\n") + "\n");
      // A progress line rather than a dot: piped output buffers, and a long run
      // that looks dead for twenty minutes is indistinguishable from a hung one.
      if (quiet) console.log(`game ${i + 1}/${games}: ${result.record.winner} won`);
    }
  } finally {
    await arena.close();
  }

  console.log(`\n\n${report(records)}${confidenceNote(aggregate(records))}`);

  if (llmSeats.length) console.log(`\n${spendLine(totalSpend(llmSeats), records.length)}`);

  if (outFile) console.log(`\n${records.length} records appended to ${outFile}`);
  if (transcriptFile) console.log(`${transcripts.length} lines of talk in ${transcriptFile}`);
}

main().catch((err) => {
  console.error(`\n${err instanceof Error ? err.message : String(err)}`);
  process.exit(1);
});
