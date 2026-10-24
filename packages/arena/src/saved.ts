import { readFile } from "node:fs/promises";
import { parseGameRecord, type GameRecord } from "@party/werewolf";
import type { Said } from "./match.js";

/** Reading and writing a run's saved files: JSONL records and the transcript. */

/** One line of a saved transcript: `[game N day R] speaker (strategy): text`. */
export function transcriptLine(game: number, said: Said): string {
  return `[game ${game} day ${said.round}] ${said.speaker} (${said.strategy}): ${said.text}`;
}

export interface TranscriptLine {
  game: number;
  day: number;
  speaker: string;
  text: string;
}

/** Every line of a saved transcript, parsed back from `transcriptLine`. */
export async function readTranscript(file: string): Promise<TranscriptLine[]> {
  const out: TranscriptLine[] = [];
  for (const raw of (await readFile(file, "utf8")).split("\n")) {
    const m = raw.match(/^\[game (\d+) day (\d+)\] (\S+) \([^)]*\): (.*)$/);
    if (m) out.push({ game: Number(m[1]), day: Number(m[2]), speaker: m[3], text: m[4] });
  }
  return out;
}

/** Every readable record in a JSONL file, and how many lines were not. */
export async function readRecords(file: string): Promise<{ records: GameRecord[]; skipped: number }> {
  const records: GameRecord[] = [];
  let skipped = 0;
  for (const line of (await readFile(file, "utf8")).split("\n")) {
    if (!line.trim()) continue;
    const record = safeParse(line);
    if (record) records.push(record);
    else skipped++;
  }
  return { records, skipped };
}

function safeParse(line: string): GameRecord | null {
  try {
    return parseGameRecord(JSON.parse(line));
  } catch {
    return null; // a torn line
  }
}
