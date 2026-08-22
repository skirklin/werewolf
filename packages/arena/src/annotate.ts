import { readFile } from "node:fs/promises";
import { ROLES, parseGameRecord, type GameRecord } from "@werewolf/shared";
import { SEAT_NAMES } from "./match.js";

/**
 * Join a saved transcript back to its records so you can read the talk with
 * roles attached — the only way to ask whether the wolves actually lied.
 *
 *   npm run arena:annotate -- runs/x.jsonl runs/x.txt [--wolves] [--claims] [--game N]
 *
 * Seat names are assigned by index (see SEAT_NAMES) and records list seats in
 * the same order, so speaker → seat → role is exact, not guesswork.
 *
 * Roles are secret *during* play; this reads finished games from the outside,
 * which is the one vantage point that gets to know everything.
 */

/** Phrases that suggest somebody is claiming a role or first-hand knowledge. */
const CLAIM = /\b(i(?:'m| am)\s+(?:the\s+)?(?:seer|doctor|villager|werewolf|wolf|medium|detective|hunter|witch)|my (?:vision|read|check|investigation)|i (?:checked|saw|inspected|protected|healed|investigated)|as the (?:seer|doctor))\b/i;
/** Phrases that point a finger at somebody. */
const ACCUSE = /\b(vote (?:for|out)|is a wolf|is the wolf|suspicious of|i suspect|has to be|it's got to be)\b/i;

interface Line {
  game: number;
  day: number;
  speaker: string;
  text: string;
}

async function main() {
  const args = process.argv.slice(2);
  const files = args.filter((a) => !a.startsWith("--"));
  const [recordsFile, transcriptFile] = files;
  if (!recordsFile || !transcriptFile) {
    console.log(
      "Usage: npm run arena:annotate -- <records.jsonl> <transcript.txt> [--wolves] [--claims] [--game N]"
    );
    return;
  }
  const wolvesOnly = args.includes("--wolves");
  const claimsOnly = args.includes("--claims");
  const onlyGame = args.includes("--game") ? Number(args[args.indexOf("--game") + 1]) : null;

  const records = await loadRecords(recordsFile);
  const lines = await loadTranscript(transcriptFile);

  let wolfLines = 0;
  let villageLines = 0;
  let wolfAccusations = 0;
  let wolfClaims = 0;
  let villageClaims = 0;
  let deadLines = 0;

  for (const line of lines) {
    const record = records[line.game - 1];
    if (!record) continue;
    if (onlyGame && line.game !== onlyGame) continue;

    const seat = SEAT_NAMES.indexOf(line.speaker);
    const info = seat >= 0 ? record.seats[seat] : undefined;
    if (!info) continue;

    const wolf = ROLES[info.dealt]?.team === "werewolf";
    const dead = diedBefore(record, seat, line.day);
    if (dead) deadLines++;
    else if (wolf) wolfLines++;
    else villageLines++;

    const claims = CLAIM.test(line.text);
    const accuses = ACCUSE.test(line.text);
    if (!dead && wolf && accuses) wolfAccusations++;
    if (!dead && claims) (wolf ? (wolfClaims += 1) : (villageClaims += 1));

    if (wolvesOnly && !wolf) continue;
    if (claimsOnly && !claims) continue;
    const tag = `${wolf ? "🐺" : "🏡"}${dead ? "💀" : "  "} ${info.dealt.padEnd(10)}`;
    console.log(`g${line.game} d${line.day} ${tag} ${line.speaker}: ${line.text}`);
  }

  const spoken = wolfLines + villageLines;
  console.log(`\n── ${spoken} lines spoken across ${records.length} games ──`);
  console.log(`  wolf-team lines      ${wolfLines} (${pct(wolfLines, spoken)})`);
  console.log(`  village lines        ${villageLines} (${pct(villageLines, spoken)})`);
  console.log(`  wolves accusing      ${wolfAccusations} (${pct(wolfAccusations, wolfLines)} of wolf lines)`);
  console.log(`  wolves claiming      ${wolfClaims} (${pct(wolfClaims, wolfLines)} of wolf lines)`);
  console.log(`  villagers claiming   ${villageClaims} (${pct(villageClaims, villageLines)} of village lines)`);
  if (deadLines)
    console.log(`  ${deadLines} lines from already-dead seats (a pre-fix transcript; the engine refused these)`);
}

/**
 * Whether this seat was already out when the given day's talk began. Night N
 * runs *before* day N, so a seat eaten in round N is gone for that same day;
 * a lynch in round N happens after that day's talk, so it only counts from the
 * next day on.
 */
function diedBefore(record: GameRecord, seat: number, day: number): boolean {
  return record.events.some((e) => {
    if (e.seat !== seat) return false;
    if (e.type === "death" || e.type === "poisoned") return e.round <= day;
    if (e.type === "lynch" || e.type === "hunterShot") return e.round < day;
    return false;
  });
}

async function loadRecords(file: string): Promise<GameRecord[]> {
  const text = await readFile(file, "utf8");
  const out: GameRecord[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      const rec = parseGameRecord(JSON.parse(line));
      if (rec) out.push(rec);
    } catch {
      /* skip a torn line */
    }
  }
  return out;
}

async function loadTranscript(file: string): Promise<Line[]> {
  const text = await readFile(file, "utf8");
  const out: Line[] = [];
  for (const raw of text.split("\n")) {
    const m = raw.match(/^\[game (\d+) day (\d+)\] (\S+) \([^)]*\): (.*)$/);
    if (m) out.push({ game: Number(m[1]), day: Number(m[2]), speaker: m[3], text: m[4] });
  }
  return out;
}

const pct = (part: number, whole: number) =>
  whole === 0 ? "0%" : `${Math.round((part / whole) * 100)}%`;

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
