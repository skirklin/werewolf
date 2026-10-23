import { aggregate, type GameRecord } from "@party/werewolf";
import { report, confidenceNote } from "./report.js";
import { readRecords } from "./saved.js";

/**
 * Re-read records saved by an earlier run and print the table again — useful
 * when a new statistic lands and you'd rather not replay the games.
 *
 *   npm run arena:analyze -- runs/a.jsonl runs/b.jsonl
 *
 * Several files are pooled into one report, so this also compares nothing on
 * its own: pass one file per population you care about, one command each.
 */
async function main() {
  const files = process.argv.slice(2).filter((a) => !a.startsWith("--"));
  if (!files.length) {
    console.log("Usage: npm run arena:analyze -- <records.jsonl> [more.jsonl ...]");
    return;
  }

  const records: GameRecord[] = [];
  let skipped = 0;
  for (const file of files) {
    const read = await readRecords(file);
    records.push(...read.records);
    skipped += read.skipped;
  }

  console.log(`${files.join(", ")}\n`);
  console.log(report(records) + confidenceNote(aggregate(records)));
  if (skipped) console.log(`\n${skipped} unreadable line${skipped === 1 ? "" : "s"} skipped.`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
