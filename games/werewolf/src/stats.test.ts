import { describe, it, expect } from "vitest";
import { GAME_RECORD_VERSION, type GameRecord, type SeatRecord } from "./record.js";
import { aggregate } from "./stats.js";

const seat = (
  dealt: string,
  won: boolean,
  survived: boolean,
  agent: string | null = null,
  said = 0
): SeatRecord => ({
  dealt,
  final: dealt,
  disguise: null,
  survived,
  won,
  agent,
  said,
});

function record(patch: Partial<GameRecord> = {}): GameRecord {
  return {
    v: GAME_RECORD_VERSION,
    finishedAt: "2026-08-21T00:00:00.000Z",
    mode: "online",
    playerCount: 4,
    rounds: 2,
    winner: "village",
    soloWinnerRole: null,
    config: {
      selectionMode: "pool",
      revealRoleOnDeath: false,
      nightSummary: "discreet",
      peacefulFirstNight: false,
    },
    seats: [
      seat("werewolf", false, false),
      seat("seer", true, true),
      seat("villager", true, false),
      seat("villager", true, true),
    ],
    events: [
      { type: "death", round: 1, seat: 2, detail: "wolves" },
      { type: "lynch", round: 2, seat: 0 },
    ],
    ...patch,
  };
}

describe("stats", () => {
  it("survives having nothing to count", () => {
    const s = aggregate([]);
    expect(s.games).toBe(0);
    expect(s.avgRounds).toBe(0);
    expect(s.roles).toEqual([]);
    expect(s.teams.every((t) => t.rate === 0)).toBe(true);
  });

  it("splits wins by team", () => {
    const s = aggregate([record(), record(), record({ winner: "werewolf" })]);
    expect(s.games).toBe(3);
    const byTeam = Object.fromEntries(s.teams.map((t) => [t.team, t]));
    expect(byTeam.village.wins).toBe(2);
    expect(byTeam.village.rate).toBeCloseTo(2 / 3);
    expect(byTeam.werewolf.wins).toBe(1);
    expect(byTeam.solo.wins).toBe(0);
  });

  it("scores each role by the seat it was dealt to", () => {
    const s = aggregate([record(), record({ winner: "werewolf", seats: [
      seat("werewolf", true, true),
      seat("seer", false, false),
      seat("villager", false, false),
      seat("villager", false, true),
    ] })]);
    const byRole = Object.fromEntries(s.roles.map((r) => [r.roleId, r]));
    expect(byRole.villager.dealt).toBe(4); // two seats in each of two games
    expect(byRole.villager.games).toBe(2); // but only two games
    expect(byRole.seer.dealt).toBe(2);
    expect(byRole.seer.wins).toBe(1);
    expect(byRole.seer.winRate).toBeCloseTo(0.5);
    expect(byRole.seer.survivalRate).toBeCloseTo(0.5);
    expect(byRole.werewolf.winRate).toBeCloseTo(0.5);
    // Busiest role first.
    expect(s.roles[0].roleId).toBe("villager");
  });

  it("scores each strategy separately, and by the side it played", () => {
    const s = aggregate([
      record({
        mode: "agent",
        winner: "werewolf",
        seats: [
          seat("werewolf", true, true, "llm", 4),
          seat("seer", false, false, "random"),
          seat("villager", false, false, "random"),
          seat("villager", false, true, "llm", 2),
        ],
      }),
      record({
        mode: "agent",
        winner: "village",
        seats: [
          seat("werewolf", false, false, "random"),
          seat("seer", true, true, "llm", 6),
          seat("villager", true, true, "llm"),
          seat("villager", true, true, "random"),
        ],
      }),
    ]);
    const byName = Object.fromEntries(s.strategies.map((x) => [x.name, x]));
    expect(byName.llm.seats).toBe(4);
    expect(byName.llm.wins).toBe(3);
    expect(byName.llm.winRate).toBeCloseTo(0.75);
    expect(byName.llm.asWerewolf).toBe(1);
    expect(byName.llm.werewolfWinRate).toBe(1);
    expect(byName.llm.asVillage).toBe(3);
    expect(byName.llm.villageWinRate).toBeCloseTo(2 / 3);
    expect(byName.llm.saidPerSeat).toBeCloseTo(3); // 4 + 2 + 6 + 0 over four seats
    expect(byName.random.winRate).toBeCloseTo(0.25);
    // Best win rate leads the table.
    expect(s.strategies[0].name).toBe("llm");
    expect(s.byMode.agent).toBe(2);
  });

  it("leaves the strategy table empty for games people played", () => {
    expect(aggregate([record()]).strategies).toEqual([]);
  });

  it("tallies how people went out, plus saves and raises", () => {
    const s = aggregate([
      record(),
      record({
        events: [
          { type: "saved", round: 1, seat: 1 },
          { type: "poisoned", round: 2, seat: 3 },
          { type: "raised", round: 3, seat: 3 },
          { type: "hunterShot", round: 3, seat: 0 },
        ],
      }),
    ]);
    expect(s.deaths["eaten by wolves"]).toBe(1);
    expect(s.deaths["voted out"]).toBe(1);
    expect(s.deaths["poisoned"]).toBe(1);
    expect(s.deaths["hunter's dying shot"]).toBe(1);
    expect(s.saves).toBe(1);
    expect(s.raises).toBe(1);
  });

  it("separates days that achieved something from days that deadlocked", () => {
    const s = aggregate([
      // Seat 0 is the werewolf in the default fixture; seat 1 is the seer.
      record({
        events: [
          { type: "lynch", round: 1, seat: 0 }, // hits a wolf
          { type: "voteTie", round: 2 },
          { type: "noDeath", round: 3, detail: "lynch" },
          { type: "noDeath", round: 3, detail: "wolves" }, // a quiet night, not a day
        ],
      }),
      record({ events: [{ type: "lynch", round: 1, seat: 1 }] }), // hits a villager
    ]);
    expect(s.days).toEqual({ lynched: 2, tied: 2, wolvesLynched: 1 });
  });

  it("counts table sizes, averages and which house rules were on", () => {
    const s = aggregate([
      record(),
      record({ playerCount: 8, rounds: 4, mode: "local" }),
      record({
        playerCount: 8,
        config: {
          selectionMode: "exact",
          revealRoleOnDeath: true,
          nightSummary: "detailed",
          peacefulFirstNight: true,
        },
      }),
    ]);
    expect(s.byPlayerCount).toEqual({ "4": 1, "8": 2 });
    expect(s.avgPlayers).toBeCloseTo(20 / 3);
    expect(s.avgRounds).toBeCloseTo(8 / 3);
    expect(s.byMode).toEqual({ online: 2, local: 1, agent: 0 });
    expect(s.options).toEqual({
      peacefulFirstNight: 1,
      revealRoleOnDeath: 1,
      detailedSummary: 1,
    });
  });
});
