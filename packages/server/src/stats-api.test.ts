import { describe, it, expect, afterEach } from "vitest";
import type { FastifyInstance } from "fastify";
import { GAME_RECORD_VERSION, type GameRecord, type Stats } from "@werewolf/shared";
import { createApp } from "./server.js";

/**
 * The stats HTTP surface, driven with `inject` so nothing has to listen on a
 * port. Each test gets its own app (and so its own store and rate limiter).
 */
let app: FastifyInstance | null = null;

afterEach(async () => {
  await app?.close();
  app = null;
});

async function freshApp(): Promise<FastifyInstance> {
  app = await createApp({ serveClient: false, dataDir: null });
  return app;
}

function record(patch: Partial<GameRecord> = {}): GameRecord {
  return {
    v: GAME_RECORD_VERSION,
    finishedAt: "",
    mode: "local",
    playerCount: 3,
    rounds: 2,
    winner: "werewolf",
    soloWinnerRole: null,
    config: {
      selectionMode: "pool",
      revealRoleOnDeath: false,
      nightSummary: "discreet",
      peacefulFirstNight: true,
    },
    seats: [
      { dealt: "werewolf", final: "werewolf", disguise: null, survived: true, won: true, agent: null, said: 0 },
      { dealt: "seer", final: "seer", disguise: null, survived: false, won: false, agent: null, said: 0 },
      { dealt: "villager", final: "villager", disguise: null, survived: true, won: false, agent: null, said: 0 },
    ],
    events: [{ type: "death", round: 1, seat: 1, detail: "wolves" }],
    ...patch,
  };
}

const post = (a: FastifyInstance, payload: unknown, ip = "10.0.0.1") =>
  a.inject({ method: "POST", url: "/api/games", payload: payload as object, remoteAddress: ip });

describe("stats API", () => {
  it("starts empty and answers anyway", async () => {
    const a = await freshApp();
    const stats = (await a.inject({ method: "GET", url: "/api/stats" })).json<Stats>();
    expect(stats.games).toBe(0);
    expect(stats.roles).toEqual([]);
  });

  it("accepts a pass-the-device record and counts it", async () => {
    const a = await freshApp();
    expect((await post(a, record())).statusCode).toBe(200);

    const stats = (await a.inject({ method: "GET", url: "/api/stats" })).json<Stats>();
    expect(stats.games).toBe(1);
    expect(stats.byMode.local).toBe(1);
    expect(stats.teams.find((t) => t.team === "werewolf")!.wins).toBe(1);
    expect(stats.roles.find((r) => r.roleId === "seer")!.winRate).toBe(0);
    expect(stats.options.peacefulFirstNight).toBe(1);
  });

  it("won't let a submission pass itself off as a refereed game", async () => {
    const a = await freshApp();
    await post(a, record({ mode: "online" }));
    const stats = (await a.inject({ method: "GET", url: "/api/stats" })).json<Stats>();
    expect(stats.byMode).toEqual({ online: 0, local: 1, agent: 0 });
  });

  it("stamps its own finish time and ignores the client's", async () => {
    const a = await freshApp();
    await post(a, record({ finishedAt: "1999-01-01T00:00:00.000Z" }));
    const { games } = (await a.inject({ method: "GET", url: "/api/games" })).json<{
      games: GameRecord[];
    }>();
    expect(games[0].finishedAt).not.toBe("1999-01-01T00:00:00.000Z");
    expect(Date.parse(games[0].finishedAt)).toBeGreaterThan(Date.parse("2020-01-01"));
  });

  it("turns away anything that isn't a game record", async () => {
    const a = await freshApp();
    const junk = [{}, { v: 99 }, record({ playerCount: 99 }), { ...record(), seats: [] }, []];
    for (const body of junk) expect((await post(a, body)).statusCode).toBe(400);

    // Valid JSON that simply isn't an object.
    const scalar = await a.inject({
      method: "POST",
      url: "/api/games",
      headers: { "content-type": "application/json" },
      payload: '"nope"',
    });
    expect(scalar.statusCode).toBe(400);

    expect((await a.inject({ method: "GET", url: "/api/stats" })).json<Stats>().games).toBe(0);
  });

  it("caps how much one address can file, without blocking anyone else", async () => {
    const a = await freshApp();
    let rejected = 0;
    for (let i = 0; i < 35; i++) {
      if ((await post(a, record())).statusCode === 429) rejected++;
    }
    expect(rejected).toBe(5); // 30 through, the rest turned away
    expect((await post(a, record(), "10.0.0.2")).statusCode).toBe(200);
  });

  it("serves the raw records, newest last, with a limit", async () => {
    const a = await freshApp();
    for (const rounds of [1, 2, 3]) await post(a, record({ rounds }));
    const all = (await a.inject({ method: "GET", url: "/api/games" })).json<{
      total: number;
      games: GameRecord[];
    }>();
    expect(all.total).toBe(3);
    expect(all.games.map((g) => g.rounds)).toEqual([1, 2, 3]);

    const capped = (await a.inject({ method: "GET", url: "/api/games?limit=2" })).json<{
      games: GameRecord[];
    }>();
    expect(capped.games.map((g) => g.rounds)).toEqual([2, 3]);
  });
});
