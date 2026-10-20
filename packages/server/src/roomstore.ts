import { readFileSync, renameSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import type { RoomSnapshot } from "./rooms.js";

/**
 * Live rooms on disk, so a deploy (or any clean restart) doesn't end the games
 * in progress. The server writes them on shutdown and every little while as a
 * backstop for an unclean exit; the next server reads them back on start.
 *
 * Writes are synchronous and atomic (temp file + rename): synchronous so the
 * shutdown save finishes before the process exits and no move can land halfway
 * through a snapshot, atomic so a crash mid-write never leaves a torn file.
 */
export class RoomStore {
  private readonly file: string;
  private last = "";
  private failed = false;

  constructor(dir: string) {
    mkdirSync(dir, { recursive: true });
    this.file = join(dir, "rooms.json");
  }

  /** The rooms the previous server left, or none. Never throws. */
  load(): RoomSnapshot[] {
    try {
      const parsed = JSON.parse(readFileSync(this.file, "utf8")) as { rooms?: unknown };
      return Array.isArray(parsed.rooms) ? (parsed.rooms as RoomSnapshot[]) : [];
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") console.error("Could not read saved rooms:", err);
      return [];
    }
  }

  /** Write the rooms if anything changed since the last write. Never throws. */
  save(rooms: RoomSnapshot[]): void {
    const text = JSON.stringify({ savedAt: new Date().toISOString(), rooms });
    // Compare without the timestamp, so an idle server doesn't rewrite forever.
    const body = JSON.stringify(rooms);
    if (body === this.last) return;
    try {
      const tmp = `${this.file}.tmp`;
      writeFileSync(tmp, text);
      renameSync(tmp, this.file);
      this.last = body;
      this.failed = false;
    } catch (err) {
      // Once per failure streak: a full or read-only volume shouldn't flood the log.
      if (!this.failed) console.error("Could not save rooms:", err);
      this.failed = true;
    }
  }
}
