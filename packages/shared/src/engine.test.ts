import { describe, it, expect } from "vitest";
import type { GameState, Player, GameConfig } from "./types.js";
import {
  reduce,
  createGame,
  checkWinner,
  living,
  allNightStepsDone,
  allVotesIn,
} from "./engine.js";
import { projectView, publicPlayers } from "./views.js";
import { recommendedConfig, validateConfig, dealRoles, werewolfCountFor, previewComposition } from "./setup.js";
import { makeRng } from "./rng.js";

const exact = (roleCounts: Record<string, number>): GameConfig => ({
  selection: { mode: "exact", roleCounts },
  revealRoleOnDeath: true,
  seerLearnsExactRole: false,
  nightSummary: "discreet",
});

/** Build a game already in roleReveal with explicit roles (bypasses shuffle). */
function gameWith(roles: string[], config?: Partial<GameConfig>): GameState {
  const players: Player[] = roles.map((roleId, i) => ({
    id: `p${i}`,
    name: `P${i}`,
    roleId,
    alive: true,
    connected: true,
    isHost: i === 0,
  }));
  return {
    ...createGame("TEST", 12345),
    phase: "roleReveal",
    players,
    config: { ...exact({}), ...config },
  };
}

function countRoles(players: Player[]): Record<string, number> {
  return players.reduce<Record<string, number>>((acc, p) => {
    acc[p.roleId!] = (acc[p.roleId!] ?? 0) + 1;
    return acc;
  }, {});
}

describe("role selection", () => {
  it("scales werewolves with the table and never leaves 7 players with 1 wolf", () => {
    const r = recommendedConfig(7);
    expect(r.selection.mode).toBe("pool");
    expect(werewolfCountFor(4, 0.26)).toBe(1);
    expect(werewolfCountFor(7, 0.26)).toBe(2); // the exact complaint, fixed
    expect(werewolfCountFor(12, 0.26)).toBe(3);
  });

  it("never lets wolves start at or past parity", () => {
    for (let n = 3; n <= 20; n++) {
      const w = werewolfCountFor(n, 0.5); // even an absurd ratio is clamped
      expect(w * 2).toBeLessThan(n);
    }
  });

  it("pool mode: derives wolf count from ratio, fills rest from pool then villagers", () => {
    const players: Player[] = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, roleId: null, alive: true, connected: true, isHost: false,
    }));
    const config: GameConfig = {
      selection: { mode: "pool", pool: ["seer", "doctor"], werewolfRatio: 0.26 },
      revealRoleOnDeath: true, seerLearnsExactRole: false, nightSummary: "discreet",
    };
    const dealt = dealRoles(players, config, makeRng(42));
    const counts = countRoles(dealt);
    expect(counts.werewolf).toBe(2);
    expect(counts.seer).toBe(1);
    expect(counts.doctor).toBe(1);
    expect(counts.villager).toBe(3);
  });

  it("pool mode: a pool larger than the table only draws what fits", () => {
    const players: Player[] = Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, roleId: null, alive: true, connected: true, isHost: false,
    }));
    const config: GameConfig = {
      selection: { mode: "pool", pool: ["seer", "doctor"], werewolfRatio: 0.26 },
      revealRoleOnDeath: true, seerLearnsExactRole: false, nightSummary: "discreet",
    };
    const counts = countRoles(dealRoles(players, config, makeRng(1)));
    // 4 players, 1 wolf, 3 non-wolf slots but only 2 specials available.
    expect(counts.werewolf).toBe(1);
    expect((counts.seer ?? 0) + (counts.doctor ?? 0)).toBe(2);
    expect(counts.villager).toBe(1);
    expect(dealRoles(players, config, makeRng(1)).length).toBe(4);
  });

  it("exact mode: deals configured counts, villagers fill, deterministic", () => {
    const players: Player[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, roleId: null, alive: true, connected: true, isHost: false,
    }));
    const config = exact({ werewolf: 2, seer: 1 });
    const a = dealRoles(players, config, makeRng(42));
    const b = dealRoles(players, config, makeRng(42));
    expect(a.map((p) => p.roleId)).toEqual(b.map((p) => p.roleId));
    expect(countRoles(a)).toEqual({ werewolf: 2, seer: 1, villager: 3 });
  });

  it("previews composition for both modes", () => {
    expect(previewComposition(recommendedConfig(7), 7)).toMatchObject({ werewolves: 2 });
    expect(previewComposition(exact({ werewolf: 2, seer: 1 }), 6)).toEqual({
      werewolves: 2, villageSpecials: 1, villagers: 3,
    });
  });

  it("flags impossible configs", () => {
    expect(validateConfig(exact({ werewolf: 0 }), 5))
      .toEqual(expect.arrayContaining([{ message: "Need at least 1 werewolf." }]));
    expect(validateConfig(exact({ werewolf: 3 }), 5).length).toBeGreaterThan(0);
    expect(validateConfig(exact({ werewolf: 1, seer: 1 }), 6)).toEqual([]);
    expect(validateConfig(recommendedConfig(7), 7)).toEqual([]);
  });
});

describe("night resolution", () => {
  it("werewolves kill their target", () => {
    let s = gameWith(["werewolf", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    expect(allNightStepsDone(s)).toBe(true);
    s = reduce(s, { type: "endNight" });
    expect(living(s).find((p) => p.id === "p1")).toBeUndefined();
  });

  it("doctor protection cancels the kill", () => {
    let s = gameWith(["werewolf", "doctor", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // wolf targets p2
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" }); // doctor saves p2
    s = reduce(s, { type: "endNight" });
    expect(living(s).some((p) => p.id === "p2")).toBe(true);
    expect(s.log.some((e) => e.type === "saved")).toBe(true);
  });

  it("seer learns werewolf status and only the seer sees it", () => {
    let s = gameWith(["werewolf", "seer", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p0" }); // seer inspects wolf
    const seerView = projectView(s, "p1");
    expect(seerView.myInspects.at(-1)).toMatchObject({ targetId: "p0", reveal: "werewolf" });
    const otherView = projectView(s, "p2");
    expect(otherView.myInspects).toHaveLength(0);
  });

  it("wolves cannot target their own pack", () => {
    let s = gameWith(["werewolf", "werewolf", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    expect(() =>
      reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" })
    ).toThrow();
  });
});

describe("day vote", () => {
  it("lynches the plurality target", () => {
    let s = gameWith(["werewolf", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" });
    expect(s.phase).toBe("dayDiscussion");
    s = reduce(s, { type: "startVote" });
    // p2, p3 vote out the wolf p0; p0 votes p2
    s = reduce(s, { type: "castVote", voterId: "p0", targetId: "p2" });
    s = reduce(s, { type: "castVote", voterId: "p2", targetId: "p0" });
    s = reduce(s, { type: "castVote", voterId: "p3", targetId: "p0" });
    expect(allVotesIn(s)).toBe(true);
    s = reduce(s, { type: "resolveVote" });
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("village");
  });

  it("a tie lynches no one", () => {
    let s = gameWith(["werewolf", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" });
    s = reduce(s, { type: "startVote" });
    s = reduce(s, { type: "castVote", voterId: "p0", targetId: "p2" });
    s = reduce(s, { type: "castVote", voterId: "p2", targetId: "p0" });
    s = reduce(s, { type: "castVote", voterId: "p3", targetId: null }); // skip -> 1v1 tie
    s = reduce(s, { type: "resolveVote" });
    expect(s.log.some((e) => e.type === "voteTie")).toBe(true);
    expect(living(s)).toHaveLength(3);
    expect(s.phase).toBe("night"); // continues to next night
    expect(s.round).toBe(2);
  });
});

describe("win conditions", () => {
  it("werewolves win at parity", () => {
    const s = gameWith(["werewolf", "villager"]);
    expect(checkWinner(s)).toBe("werewolf"); // 1 wolf, 1 villager -> parity
  });

  it("village wins with no wolves left", () => {
    let s = gameWith(["werewolf", "villager", "villager"]);
    s = { ...s, players: s.players.map((p) => (p.id === "p0" ? { ...p, alive: false } : p)) };
    expect(checkWinner(s)).toBe("village");
  });

  it("game undecided mid-game", () => {
    const s = gameWith(["werewolf", "villager", "villager", "villager"]);
    expect(checkWinner(s)).toBeNull();
  });
});

describe("night edge cases", () => {
  it("multiple werewolves agreeing kill that target", () => {
    let s = gameWith(["werewolf", "werewolf", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" });
    s = reduce(s, { type: "endNight" });
    expect(living(s).some((p) => p.id === "p2")).toBe(false);
  });

  it("split werewolf votes still kill exactly one player (seeded tiebreak)", () => {
    let s = gameWith(["werewolf", "werewolf", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" });
    s = reduce(s, { type: "endNight" });
    const deaths = s.players.filter((p) => !p.alive);
    expect(deaths).toHaveLength(1);
    expect(["p2", "p3"]).toContain(deaths[0].id);
  });

  it("doctor may protect themselves", () => {
    let s = gameWith(["werewolf", "doctor", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" }); // wolf targets doctor
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p1" }); // doctor self-protects
    s = reduce(s, { type: "endNight" });
    expect(living(s).some((p) => p.id === "p1")).toBe(true);
  });

  it("two seers each learn independently", () => {
    let s = gameWith(["werewolf", "seer", "seer", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p0" }); // seer1 -> wolf
    s = reduce(s, { type: "nightChoice", actorId: "p2", targetId: "p3" }); // seer2 -> villager
    expect(projectView(s, "p1").myInspects.at(-1)).toMatchObject({ reveal: "werewolf" });
    expect(projectView(s, "p2").myInspects.at(-1)).toMatchObject({ reveal: "not-werewolf" });
    expect(projectView(s, "p1").myInspects).toHaveLength(1); // can't see the other seer's
  });

  it("seer learns the exact role when configured", () => {
    let s = gameWith(["werewolf", "seer", "doctor", "villager"], {
      selection: { mode: "exact", roleCounts: {} },
      seerLearnsExactRole: true,
    });
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" });
    expect(projectView(s, "p1").myInspects.at(-1)!.reveal).toBe("doctor");
  });
});

describe("illegal moves are rejected", () => {
  it("cannot act at night out of phase", () => {
    const s = gameWith(["werewolf", "villager", "villager"]); // still roleReveal
    expect(() => reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" })).toThrow();
  });

  it("dead players cannot vote", () => {
    let s = gameWith(["werewolf", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" });
    s = reduce(s, { type: "startVote" });
    expect(() => reduce(s, { type: "castVote", voterId: "p1", targetId: "p0" })).toThrow();
  });

  it("cannot vote for a dead player", () => {
    let s = gameWith(["werewolf", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" });
    s = reduce(s, { type: "startVote" });
    expect(() => reduce(s, { type: "castVote", voterId: "p2", targetId: "p1" })).toThrow();
  });
});

describe("multi-round games", () => {
  it("werewolves grind down the village across rounds", () => {
    // 2 wolves, 4 villagers. Wolves eat one each night; town misfires.
    let s = gameWith(["werewolf", "werewolf", "villager", "villager", "villager", "villager"]);
    const wolfKill = (target: string) => {
      s = reduce(s, { type: "startNight" });
      s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: target });
      s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: target });
      s = reduce(s, { type: "endNight" });
    };
    wolfKill("p2");
    expect(s.phase).toBe("dayDiscussion");
    // Town abstains (no lynch).
    s = reduce(s, { type: "startVote" });
    for (const p of living(s)) s = reduce(s, { type: "castVote", voterId: p.id, targetId: null });
    s = reduce(s, { type: "resolveVote" });
    expect(s.phase).toBe("night"); // continues
    // Second kill reaches parity -> wolves win.
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p3" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" });
    s = reduce(s, { type: "endNight" });
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("werewolf");
  });

  it("a whole game is deterministic given the same seed", () => {
    const play = (seed: number) => {
      let s: GameState = {
        ...createGame("SEED", seed),
        phase: "roleReveal",
        players: ["werewolf", "villager", "villager", "villager"].map((roleId, i) => ({
          id: `p${i}`, name: `P${i}`, roleId, alive: true, connected: true, isHost: i === 0,
        })),
        config: exact({}),
      };
      s = reduce(s, { type: "startNight" });
      // Wolf splits nothing (single wolf); vote ties deterministically.
      s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
      s = reduce(s, { type: "endNight" });
      return s.players.filter((p) => !p.alive).map((p) => p.id);
    };
    expect(play(777)).toEqual(play(777));
  });
});

describe("view redaction", () => {
  it("hides other players' roles from a villager", () => {
    const s = gameWith(["werewolf", "villager", "seer"]);
    const v = projectView(s, "p1");
    expect(v.you.roleId).toBe("villager");
    expect(v.players.find((p) => p.id === "p0")!.roleId).toBeNull(); // wolf hidden
    expect(v.players.find((p) => p.id === "p2")!.roleId).toBeNull(); // seer hidden
    expect(v.packmates).toEqual([]);
  });

  it("shows werewolves their packmates", () => {
    const s = gameWith(["werewolf", "werewolf", "villager"]);
    const v = projectView(s, "p0");
    expect(v.packmates).toEqual(["p1"]);
    expect(v.players.find((p) => p.id === "p1")!.roleId).toBe("werewolf");
  });

  it("reveals a dead player's role only when configured", () => {
    const dead = (revealRoleOnDeath: boolean) => {
      let s = gameWith(["werewolf", "seer", "villager", "villager"], {
        selection: { mode: "exact", roleCounts: {} },
        revealRoleOnDeath,
      });
      s = reduce(s, { type: "startNight" });
      s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" }); // kill seer
      s = reduce(s, { type: "endNight" });
      return projectView(s, "p2").players.find((p) => p.id === "p1")!.roleId;
    };
    expect(dead(true)).toBe("seer");
    expect(dead(false)).toBeNull();
  });

  it("publicPlayers never reveals a living role, even a wolf's pack", () => {
    const s = gameWith(["werewolf", "werewolf", "seer", "villager"]);
    const pub = publicPlayers(s);
    expect(pub.every((p) => p.roleId === null)).toBe(true); // all alive, nothing revealed
  });

  it("publicPlayers reveals everyone at game over", () => {
    let s = gameWith(["werewolf", "villager"]);
    s = { ...s, phase: "gameOver", winner: "werewolf" };
    expect(publicPlayers(s).every((p) => p.roleId !== null)).toBe(true);
  });

  it("a protected kill leaks nothing in discreet mode, but is shown in detailed", () => {
    const play = (nightSummary: "discreet" | "detailed") => {
      let s = gameWith(["werewolf", "doctor", "villager", "villager"], {
        selection: { mode: "exact", roleCounts: {} },
        nightSummary,
      });
      s = reduce(s, { type: "startNight" });
      s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // wolf targets p2
      s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" }); // doctor saves p2
      s = reduce(s, { type: "endNight" });
      return projectView(s, "p3"); // a plain villager's view
    };
    const discreet = play("discreet");
    // No "saved" entry reaches the client, and no player id points at the target.
    expect(discreet.log.some((e) => e.type === "saved")).toBe(false);
    expect(JSON.stringify(discreet.log)).not.toContain("p2");
    const detailed = play("detailed");
    expect(detailed.log.some((e) => e.type === "saved")).toBe(true);
  });
});
