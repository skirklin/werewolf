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
 * Assignment is BY TEAM, mirrored. In one set the wolves all run playbook A and
 * the village all runs B; in the mirror set they swap. A seat picks its
 * playbook from its own role, which it legitimately knows, so nothing leaks.
 *
 * The alternative — alternating playbooks by seat — sounds fairer but mostly
 * measures nothing: with two wolves among seven mixed seats, 57% of games hand
 * you a mixed pack whose members win or lose together, so the majority of the
 * sample cannot tell the variants apart. Splitting by team costs twice the
 * games and makes every one of them discriminate.
 *
 * Because each variant ends up with wolf seats from one set and village seats
 * from the other, the ordinary per-side win rates answer the question directly:
 * A-as-wolves against B-as-wolves, and the same for the village.
 */

const USAGE = `
Play prompt variants against each other, assigned by team and mirrored.

  npm run arena:tournament -- [options]

Options
  --playbooks A,B[,C]   variants to compare (default "baseline,specialist")
  --games N             games per side, per pairing (default 10)
  --players N           seats per game (default 7)
  --model ID            model for every seat (default claude-haiku-4-5)
  --discussion N        times round the table before each vote (default 2)
  --lethal              let the wolves kill on night one (default: they do not)
  --out FILE            append the anonymous records here as JSONL
  --transcript FILE     append everything said here, tagged with the playbook

Every unordered pair is played twice: once with the first variant on the wolf
team, once with it in the village. Total games = pairs x 2 x --games.

Known playbooks: ${Object.keys(PLAYBOOKS)
  .map((k) => `${k} — ${PLAYBOOKS[k].about}`)
  .join("\n                 ")}

Example
  npm run arena:tournament -- --playbooks baseline,specialist --games 12
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
  const perSide = Number(args.games ?? 10);
  const model = args.model ? String(args.model) : undefined;

  // Every unordered pair, each played from both sides.
  const pairings: [string, string][] = [];
  for (let i = 0; i < names.length; i++)
    for (let j = i + 1; j < names.length; j++) {
      pairings.push([names[i], names[j]]);
      pairings.push([names[j], names[i]]);
    }
  const total = pairings.length * perSide;

  // Peaceful first night by default: with a lethal one, a seven-player village
  // must find a wolf on day one AND day two or lose, which floors the win rate
  // near zero and leaves prompt differences nowhere to show up.
  const config: GameConfig = {
    ...recommendedConfig(players),
    peacefulFirstNight: !args.lethal,
  };
  const outFile = args.out ? String(args.out) : null;
  const transcriptFile = args.transcript ? String(args.transcript) : null;
  if (outFile) await ensureDir(outFile);
  if (transcriptFile) await ensureDir(transcriptFile);

  console.log(`Tournament: ${names.join(" vs ")}`);
  console.log(
    `${total} games of ${players}${config.peacefulFirstNight ? ", peaceful first night" : ""}` +
      ` — ${perSide} per side, per pairing:`
  );
  for (const [wolves, village] of pairings)
    console.log(`  wolves ${wolves} vs village ${village}`);
  console.log("");

  const arena = await Arena.open();
  const played: { record: GameRecord; transcript: readonly Said[] }[] = [];
  const seats: LlmStrategy[] = [];
  let done = 0;
  try {
    for (const [wolfSide, villageSide] of pairings) {
      for (let i = 0; i < perSide; i++) {
        // Each seat asks only about its own role, so this assigns by team
        // without any seat learning anything about another.
        const strategies = Array.from(
          { length: players },
          () =>
            new LlmStrategy({
              model,
              playbook: (team) => getPlaybook(team === "werewolf" ? wolfSide : villageSide),
            })
        );
        seats.push(...strategies);
        const result = await arena.play({
          strategies,
          config,
          discussionRounds: Number(args.discussion ?? 2),
        });
        played.push(result);
        if (outFile) await appendFile(outFile, JSON.stringify(result.record) + "\n");
        if (transcriptFile && result.transcript.length)
          await appendFile(
            transcriptFile,
            result.transcript
              .map(
                (t) =>
                  `[game ${done + 1} day ${t.round}] ${t.speaker} (${t.strategy}): ${t.text}`
              )
              .join("\n") + "\n"
          );
        done++;
        console.log(
          `game ${done}/${total} (wolves ${wolfSide}): ${result.record.winner} won`
        );
      }
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
  if (transcriptFile) console.log(`Transcript appended to ${transcriptFile}`);
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
  // Names carry the model when it was pinned, so size the column to fit.
  const width = Math.max(8, ...stats.strategies.map((s) => s.name.length));
  lines.push(
    `  ${"playbook".padEnd(width)} ${"seats".padStart(6)} ${"win".padStart(5)} ${"village".padStart(8)} ${"wolf".padStart(6)} ${"bluffs".padStart(7)}`
  );
  for (const s of stats.strategies) {
    const said = speech.get(s.name);
    // A bluff is a role/vision claim from a seat that was a wolf — a wolf has no
    // visions, so claiming one is a lie by construction.
    const bluffRate = said && said.wolfLines ? pct(said.bluffs / said.wolfLines) : "–";
    lines.push(
      `  ${s.name.padEnd(width)} ${String(s.seats).padStart(6)} ${pct(s.winRate).padStart(5)} ` +
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
