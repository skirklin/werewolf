import { describe, it, expect } from "vitest";
import type { GameConfig, GameState, Player } from "./types.js";
import { createGame, reduce } from "./engine.js";
import { GAME_RECORD_VERSION, parseGameRecord, toGameRecord, type GameRecord } from "./record.js";

const config: GameConfig = {
  selection: { mode: "exact", roleCounts: {} },
  revealRoleOnDeath: true,
  nightSummary: "discreet",
  peacefulFirstNight: false,
};

/** A game in roleReveal with explicit roles and recognisable personal details. */
function gameWith(roles: string[]): GameState {
  const players: Player[] = roles.map((roleId, i) => ({
    id: `uuid-secret-${i}`,
    name: `RealName${i}`,
    roleId,
    alive: true,
    connected: true,
    isHost: i === 0,
  }));
  return {
    ...createGame("WXYZ", 4242),
    phase: "roleReveal",
    players,
    dealtRoles: [...roles],
    config,
  };
}

/** Wolf eats p1, then the town votes out the wolf: a village win in one round. */
function villageWin(): GameState {
  let s = gameWith(["werewolf", "villager", "villager", "villager"]);
  s = reduce(s, { type: "startNight" });
  s = reduce(s, { type: "nightChoice", actorId: "uuid-secret-0", targetId: "uuid-secret-1" });
  s = reduce(s, { type: "endNight" });
  s = reduce(s, { type: "startVote" });
  s = reduce(s, { type: "castVote", voterId: "uuid-secret-0", targetId: "uuid-secret-2" });
  s = reduce(s, { type: "castVote", voterId: "uuid-secret-2", targetId: "uuid-secret-0" });
  s = reduce(s, { type: "castVote", voterId: "uuid-secret-3", targetId: "uuid-secret-0" });
  return reduce(s, { type: "resolveVote" });
}

describe("game records", () => {
  it("is only produced once a game has actually finished", () => {
    expect(toGameRecord(gameWith(["werewolf", "villager", "villager"]), "online")).toBeNull();
  });

  it("keeps nothing that identifies a person, a session or the deal", () => {
    const state = villageWin();
    const json = JSON.stringify(toGameRecord(state, "online"));
    for (const p of state.players) {
      expect(json).not.toContain(p.name);
      expect(json).not.toContain(p.id);
    }
    expect(json).not.toContain(state.code);
    expect(json).not.toContain(String(state.seed));
  });

  it("records who was dealt what, who lived and who won", () => {
    const rec = toGameRecord(villageWin(), "online")!;
    expect(rec.v).toBe(GAME_RECORD_VERSION);
    expect(rec.mode).toBe("online");
    expect(rec.winner).toBe("village");
    expect(rec.playerCount).toBe(4);
    expect(rec.rounds).toBe(1);
    expect(rec.seats.map((s) => s.dealt)).toEqual(["werewolf", "villager", "villager", "villager"]);
    expect(rec.seats.map((s) => s.won)).toEqual([false, true, true, true]);
    expect(rec.seats.map((s) => s.survived)).toEqual([false, false, true, true]);
    expect(rec.config.peacefulFirstNight).toBe(false);
    expect(rec.soloWinnerRole).toBeNull();
  });

  it("turns the timeline into seat numbers", () => {
    const rec = toGameRecord(villageWin(), "online")!;
    const death = rec.events.find((e) => e.type === "death")!;
    expect(death).toMatchObject({ seat: 1, round: 1, detail: "wolves" });
    const lynch = rec.events.find((e) => e.type === "lynch")!;
    expect(lynch.seat).toBe(0); // the wolf
    expect(rec.events.every((e) => e.seat === undefined || Number.isInteger(e.seat))).toBe(true);
  });

  it("credits a lone Tanner win to the Tanner alone", () => {
    let s = gameWith(["werewolf", "tanner", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "uuid-secret-0", targetId: "uuid-secret-2" });
    s = reduce(s, { type: "endNight" });
    s = reduce(s, { type: "startVote" });
    s = reduce(s, { type: "castVote", voterId: "uuid-secret-0", targetId: "uuid-secret-1" });
    s = reduce(s, { type: "castVote", voterId: "uuid-secret-1", targetId: "uuid-secret-0" });
    s = reduce(s, { type: "castVote", voterId: "uuid-secret-3", targetId: "uuid-secret-1" });
    s = reduce(s, { type: "resolveVote" });
    const rec = toGameRecord(s, "local")!;
    expect(rec.winner).toBe("solo");
    expect(rec.soloWinnerRole).toBe("tanner");
    expect(rec.seats.filter((seat) => seat.won)).toHaveLength(1);
    expect(rec.seats[1].won).toBe(true);
  });

  it("counts what each seat said without keeping a word of it", () => {
    const spoken = "I saw p0 do something strange last night";
    const s = {
      ...villageWin(),
      chat: [
        { round: 1, playerId: "uuid-secret-2", text: spoken },
        { round: 1, playerId: "uuid-secret-2", text: "vote p0" },
        { round: 1, playerId: "uuid-secret-3", text: "agreed" },
      ],
    };
    const rec = toGameRecord(s, "agent")!;
    expect(rec.seats.map((seat) => seat.said)).toEqual([0, 0, 2, 1]);
    // Speech is the one thing people write themselves, so it never goes in.
    expect(JSON.stringify(rec)).not.toContain(spoken);
    expect(JSON.stringify(rec)).not.toContain("agreed");
  });

  it("leaves the strategy label blank for the engine to fill in later", () => {
    const rec = toGameRecord(villageWin(), "agent")!;
    expect(rec.mode).toBe("agent");
    expect(rec.seats.every((seat) => seat.agent === null)).toBe(true);
  });

  it("notes what a Drunk thought they were", () => {
    const s = { ...villageWin(), drunkDisguise: { "uuid-secret-2": "seer" } };
    const rec = toGameRecord(s, "online")!;
    expect(rec.seats[2].disguise).toBe("seer");
    expect(rec.seats[0].disguise).toBeNull();
  });
});

describe("game record validation", () => {
  const valid = (): GameRecord => toGameRecord(villageWin(), "online")!;

  it("accepts a record the engine just produced, unchanged", () => {
    const rec = valid();
    expect(parseGameRecord(JSON.parse(JSON.stringify(rec)))).toEqual(rec);
  });

  it.each([
    ["not an object", 42],
    ["null", null],
    ["an array", []],
    ["a wrong version", { ...{}, v: 99 }],
  ])("rejects %s", (_label, body) => {
    expect(parseGameRecord(body)).toBeNull();
  });

  it("rejects made-up roles, counts and modes", () => {
    const bend = (patch: Partial<Record<string, unknown>>) =>
      parseGameRecord({ ...valid(), ...patch });
    expect(bend({ mode: "admin" })).toBeNull();
    expect(bend({ playerCount: 2 })).toBeNull(); // below the minimum table
    expect(bend({ playerCount: 5 })).toBeNull(); // no longer matches seats.length
    expect(bend({ rounds: -1 })).toBeNull();
    expect(bend({ rounds: 1.5 })).toBeNull();
    expect(bend({ winner: "lizards" })).toBeNull();
    expect(bend({ soloWinnerRole: "dragon" })).toBeNull();
    expect(
      bend({ seats: valid().seats.map((s) => ({ ...s, dealt: "dragon" })) })
    ).toBeNull();
    expect(bend({ seats: valid().seats.map((s) => ({ ...s, won: "yes" })) })).toBeNull();
    expect(bend({ config: { ...valid().config, nightSummary: "loud" } })).toBeNull();
    expect(bend({ config: undefined })).toBeNull();
  });

  it("refuses oversized or out-of-range event lists", () => {
    const rec = valid();
    const filler = { type: "night", round: 1 };
    expect(parseGameRecord({ ...rec, events: Array(2001).fill(filler) })).toBeNull();
    expect(parseGameRecord({ ...rec, events: [{ type: "death", round: 1, seat: 99 }] })).toBeNull();
    expect(parseGameRecord({ ...rec, events: [{ type: "death", round: 1, detail: "x".repeat(25) }] })).toBeNull();
    expect(parseGameRecord({ ...rec, events: "lots" })).toBeNull();
  });

  it("still reads a version 1 record, filling in what it predates", () => {
    const modern = valid();
    const v1 = {
      ...modern,
      v: 1,
      seats: modern.seats.map(({ agent, said, ...rest }) => rest),
    };
    const parsed = parseGameRecord(v1)!;
    expect(parsed).not.toBeNull();
    expect(parsed.v).toBe(GAME_RECORD_VERSION);
    expect(parsed.seats.every((s) => s.agent === null && s.said === 0)).toBe(true);
  });

  it("refuses an over-long strategy label", () => {
    const rec = valid();
    expect(
      parseGameRecord({ ...rec, seats: rec.seats.map((s) => ({ ...s, agent: "x".repeat(41) })) })
    ).toBeNull();
    expect(
      parseGameRecord({ ...rec, seats: rec.seats.map((s) => ({ ...s, said: -1 })) })
    ).toBeNull();
  });

  it("drops a client-supplied timestamp rather than trusting its type", () => {
    const parsed = parseGameRecord({ ...valid(), finishedAt: { evil: true } });
    expect(parsed!.finishedAt).toBe("");
  });
});
