import { mkdir } from "node:fs/promises";
import { dirname } from "node:path";

/** Small helpers shared by the arena's command-line scripts. */

export type Args = Record<string, string | boolean>;

/** Bare-bones `--flag value` / `--flag` parsing; no dependency needed for this. */
export function parseArgs(argv: string[]): Args {
  const out: Args = {};
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

/** Make sure the directory an output file goes in exists. */
export async function ensureDir(file: string) {
  const dir = dirname(file);
  if (dir && dir !== ".") await mkdir(dir, { recursive: true });
}

export const pct = (n: number) => `${Math.round(n * 100)}%`;
