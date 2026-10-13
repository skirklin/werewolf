import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { mkdtemp, rm, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GAME_RECORD_VERSION, type GameRecord } from "@party/werewolf";
import { GameStore } from "./store.js";

function record(patch: Partial<GameRecord> = {}): GameRecord {
  return {
    v: GAME_RECORD_VERSION,
    finishedAt: "2026-08-21T00:00:00.000Z",
    mode: "online",
    playerCount: 3,
    rounds: 1,
    winner: "village",
    soloWinnerRole: null,
    config: {
      selectionMode: "pool",
      revealRoleOnDeath: false,
      nightSummary: "discreet",
      peacefulFirstNight: false,
    },
    seats: [
      { dealt: "werewolf", final: "werewolf", disguise: null, survived: false, won: false, agent: null, said: 0 },
      { dealt: "villager", final: "villager", disguise: null, survived: true, won: true, agent: null, said: 0 },
      { dealt: "seer", final: "seer", disguise: null, survived: true, won: true, agent: null, said: 0 },
    ],
    events: [{ type: "lynch", round: 1, seat: 0 }],
    ...patch,
  };
}

let dir: string;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "werewolf-store-"));
});
afterEach(async () => {
  await rm(dir, { recursive: true, force: true });
});

/** appendFile is fire-and-forget, so give the write a tick to land. */
const settle = () => new Promise((r) => setTimeout(r, 20));

describe("game store", () => {
  it("keeps records in memory when there's nowhere to write", async () => {
    const store = await GameStore.open(null);
    store.add(record());
    expect(store.all()).toHaveLength(1);
  });

  it("survives a restart", async () => {
    const first = await GameStore.open(dir);
    first.add(record({ rounds: 7 }));
    first.add(record({ winner: "werewolf" }));
    await settle();

    const second = await GameStore.open(dir);
    expect(second.all()).toHaveLength(2);
    expect(second.all()[0].rounds).toBe(7);
    expect(second.all()[1].winner).toBe("werewolf");
  });

  it("starts clean in a directory that doesn't exist yet", async () => {
    const store = await GameStore.open(join(dir, "nested", "deeper"));
    expect(store.all()).toEqual([]);
    store.add(record());
    await settle();
    expect((await GameStore.open(join(dir, "nested", "deeper"))).all()).toHaveLength(1);
  });

  it("skips torn and junk lines rather than losing the file", async () => {
    const store = await GameStore.open(dir);
    store.add(record({ rounds: 3 }));
    await settle();
    const file = join(dir, "games.jsonl");
    const good = await readFile(file, "utf8");
    await writeFile(file, `${good}{"v":1,"trunca\nnot json at all\n${good}`);

    const reopened = await GameStore.open(dir);
    expect(reopened.all()).toHaveLength(2); // both intact lines, neither ruin
    expect(reopened.all().every((r) => r.rounds === 3)).toBe(true);
  });

  it("writes one line per game", async () => {
    const store = await GameStore.open(dir);
    store.add(record());
    store.add(record());
    await settle();
    const lines = (await readFile(join(dir, "games.jsonl"), "utf8")).trim().split("\n");
    expect(lines).toHaveLength(2);
    expect(JSON.parse(lines[0]).v).toBe(GAME_RECORD_VERSION);
  });
});
