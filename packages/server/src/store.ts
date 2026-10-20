import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parseGameRecord, type GameRecord } from "@party/werewolf";

/**
 * Append-only storage for finished games: one JSON record per line. Records are
 * tiny and write-once, so a text file on a volume beats a database here — you
 * can read it with `tail`, and a corrupt line costs one game, not the file.
 *
 * The whole file is loaded into memory at startup and served from there; writes
 * go to both. Nothing here holds anything that identifies a player (see
 * `toGameRecord`).
 */

/** Most recent records kept in memory (and therefore served). */
const MAX_RECORDS = 20_000;

export class GameStore {
  private records: GameRecord[] = [];
  private failedWrite = false;
  /**
   * The last pending write. Each append waits for the one before it: two
   * appendFile calls in flight at once run on the thread pool and can land
   * in either order, which would file two games that ended together out of
   * sequence.
   */
  private writes: Promise<void> = Promise.resolve();

  private constructor(private readonly file: string | null) {}

  /**
   * Open the store at `dir`, reading back whatever is already there. Pass no
   * directory for an in-memory store (tests, and any deploy without a volume).
   */
  static async open(dir: string | null | undefined): Promise<GameStore> {
    if (!dir) return new GameStore(null);
    const file = join(dir, "games.jsonl");
    const store = new GameStore(file);
    try {
      await mkdir(dir, { recursive: true });
      const text = await readFile(file, "utf8");
      for (const line of text.split("\n")) {
        if (!line.trim()) continue;
        const record = safeParse(line);
        if (record) store.records.push(record);
      }
      store.trim();
    } catch (err) {
      // A missing file is the normal first-run case; anything else is worth a
      // line in the log, but never a reason to refuse to start.
      if ((err as NodeJS.ErrnoException).code !== "ENOENT")
        console.error("Could not read game records:", err);
    }
    return store;
  }

  add(record: GameRecord): void {
    this.records.push(record);
    this.trim();
    if (!this.file) return;
    const file = this.file;
    const line = JSON.stringify(record) + "\n";
    this.writes = this.writes.then(() => appendFile(file, line)).catch((err) => {
      // Log the first failure only — a full or read-only volume would otherwise
      // print once per finished game forever.
      if (!this.failedWrite) {
        this.failedWrite = true;
        console.error("Could not persist a game record:", err);
      }
    });
  }

  /** Resolves once every record added so far is on disk. */
  flushed(): Promise<void> {
    return this.writes;
  }

  /** Every retained record, oldest first. */
  all(): readonly GameRecord[] {
    return this.records;
  }

  private trim() {
    if (this.records.length > MAX_RECORDS)
      this.records = this.records.slice(-MAX_RECORDS);
  }
}

function safeParse(line: string): GameRecord | null {
  try {
    return parseGameRecord(JSON.parse(line));
  } catch {
    return null; // a torn line (e.g. killed mid-write) — skip it
  }
}
