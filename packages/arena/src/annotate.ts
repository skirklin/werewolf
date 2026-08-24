import { readFile } from "node:fs/promises";
import { ROLES, parseGameRecord, type GameRecord } from "@werewolf/shared";
import { SEAT_NAMES } from "./match.js";
import { ACCUSE, CLAIM } from "./speech.js";

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

/**
 * A wolf line that gives its own side away: naming a packmate, or admitting to
 * being a wolf. These are model formatting failures rather than play, but while
 * they were going into the game they were free wins for the village — so it is
 * worth asking how many of a run's village wins rested on one.
 */
const CONFESSION = /\b(my packmate|fellow (?:wolf|werewolf)|i(?:'m| am) (?:a|the) (?:wolf|werewolf)|we killed)\b/i;

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
  /** game number -> a wolf gave the pack away in it */
  const confessed = new Set<number>();

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
    if (!dead && wolf && CONFESSION.test(line.text)) confessed.add(line.game);
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

  // Did the village's wins come from its own play, or from wolves blurting?
  const villageWins = (games: number[]) =>
    games.filter((g) => records[g - 1]?.winner === "village").length;
  const all = records.map((_, i) => i + 1);
  const leaked = [...confessed].sort((a, b) => a - b);
  const clean = all.filter((g) => !confessed.has(g));
  console.log(
    `\n  wolves gave themselves away in ${leaked.length}/${records.length} games` +
      `\n    village won ${villageWins(leaked)}/${leaked.length} of those` +
      ` (${pct(villageWins(leaked), leaked.length)})` +
      `\n    village won ${villageWins(clean)}/${clean.length} of the rest` +
      ` (${pct(villageWins(clean), clean.length)})`
  );
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
