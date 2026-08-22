import { describe, it, expect } from "vitest";
import type { GameState, Player, GameConfig } from "./types.js";
import {
  reduce,
  createGame,
  checkWinner,
  living,
  allNightStepsDone,
  allVotesIn,
  validNightTargets,
  MAX_CHAT_TEXT,
  MAX_CHAT_MESSAGES,
} from "./engine.js";
import { projectView, publicPlayers } from "./views.js";
import { recommendedConfig, validateConfig, dealRoles, werewolfCountFor, previewComposition } from "./setup.js";
import { makeRng } from "./rng.js";

const exact = (roleCounts: Record<string, number>): GameConfig => ({
  selection: { mode: "exact", roleCounts },
  revealRoleOnDeath: true,
  nightSummary: "discreet", peacefulFirstNight: false,
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

/** Abstain the whole table so the day ends without a lynch. */
function skipDay(s: GameState): GameState {
  let next = reduce(s, { type: "startVote" });
  for (const p of living(next)) next = reduce(next, { type: "castVote", voterId: p.id, targetId: null });
  return reduce(next, { type: "resolveVote" });
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
      selection: { mode: "pool", pool: ["villager", "seer", "doctor"], werewolfRatio: 0.26 },
      revealRoleOnDeath: true, nightSummary: "discreet", peacefulFirstNight: false,
    };
    const dealt = dealRoles(players, config, makeRng(42));
    const counts = countRoles(dealt);
    expect(counts.werewolf).toBe(2);
    expect(counts.seer).toBe(1);
    expect(counts.doctor).toBe(1);
    expect(counts.villager).toBe(3);
  });

  it("pool mode without villagers fills every slot with (repeated) specials", () => {
    const players: Player[] = Array.from({ length: 7 }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, roleId: null, alive: true, connected: true, isHost: false,
    }));
    const config: GameConfig = {
      selection: { mode: "pool", pool: ["seer", "doctor"], werewolfRatio: 0.26 },
      revealRoleOnDeath: true, nightSummary: "discreet", peacefulFirstNight: false,
    };
    const counts = countRoles(dealRoles(players, config, makeRng(7)));
    expect(counts.werewolf).toBe(2);
    expect(counts.villager ?? 0).toBe(0); // villager removed from the pool
    expect((counts.seer ?? 0) + (counts.doctor ?? 0)).toBe(5); // rest are specials
  });

  it("pool mode: a pool larger than the table only draws what fits", () => {
    const players: Player[] = Array.from({ length: 4 }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, roleId: null, alive: true, connected: true, isHost: false,
    }));
    const config: GameConfig = {
      selection: { mode: "pool", pool: ["villager", "seer", "doctor"], werewolfRatio: 0.26 },
      revealRoleOnDeath: true, nightSummary: "discreet", peacefulFirstNight: false,
    };
    const counts = countRoles(dealRoles(players, config, makeRng(1)));
    // 4 players, 1 wolf, 3 non-wolf slots, 2 distinct specials + 1 villager.
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

  it("never previews negative counts (e.g. before any players are added)", () => {
    const c = previewComposition(recommendedConfig(0), 0);
    expect(c.villageSpecials).toBeGreaterThanOrEqual(0);
    expect(c.villagers).toBeGreaterThanOrEqual(0);
  });

  it("flags impossible configs", () => {
    expect(validateConfig(exact({ werewolf: 0 }), 5))
      .toEqual(expect.arrayContaining([{ message: "Need at least 1 werewolf." }]));
    expect(validateConfig(exact({ werewolf: 3 }), 5).length).toBeGreaterThan(0);
    expect(validateConfig(exact({ werewolf: 1, seer: 1 }), 6)).toEqual([]);
    expect(validateConfig(recommendedConfig(7), 7)).toEqual([]);
  });

  it("rejects a pool with no village side (and an empty pool)", () => {
    const pool = (ids: string[]) =>
      validateConfig(
        { selection: { mode: "pool", pool: ids, werewolfRatio: 0.26 }, revealRoleOnDeath: false, nightSummary: "discreet", peacefulFirstNight: false },
        6
      );
    expect(pool([]).length).toBeGreaterThan(0); // empty
    expect(pool(["tanner"]).length).toBeGreaterThan(0); // solo-only, no town
    expect(pool(["villager"])).toEqual([]); // villagers count as a village side
    expect(pool(["seer"])).toEqual([]); // a village role counts too
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

  it("the Seer learns a target's exact role", () => {
    let s = gameWith(["werewolf", "seer", "doctor", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" }); // seer -> doctor
    expect(projectView(s, "p1").myInspects.at(-1)!.reveal).toBe("doctor");
  });

  it("the Aura Seer learns only werewolf-or-not (one inspect per night)", () => {
    const inspect = (targetId: string) => {
      let s = gameWith(["werewolf", "auraSeer", "doctor", "villager"]);
      s = reduce(s, { type: "startNight" });
      s = reduce(s, { type: "nightChoice", actorId: "p1", targetId });
      return projectView(s, "p1").myInspects.at(-1)!.reveal;
    };
    expect(inspect("p0")).toBe("werewolf"); // the wolf
    expect(inspect("p2")).toBe("not-werewolf"); // the doctor — not "doctor"
  });

  it("a role may only act once per night (the step locks when done)", () => {
    let s = gameWith(["werewolf", "seer", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p0" });
    expect(() => reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" })).toThrow();
  });

  it("a Seer and an Aura Seer act as independent, differently-revealing steps", () => {
    let s = gameWith(["werewolf", "seer", "auraSeer", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" }); // seer -> villager
    s = reduce(s, { type: "nightChoice", actorId: "p2", targetId: "p3" }); // aura -> same villager
    expect(projectView(s, "p1").myInspects.at(-1)!.reveal).toBe("villager");
    expect(projectView(s, "p2").myInspects.at(-1)!.reveal).toBe("not-werewolf");
    expect(projectView(s, "p1").myInspects).toHaveLength(1); // can't see the other's vision
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

  it("cannot vote for yourself", () => {
    let s = gameWith(["werewolf", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" });
    s = reduce(s, { type: "startVote" });
    expect(() => reduce(s, { type: "castVote", voterId: "p2", targetId: "p2" })).toThrow();
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

describe("peaceful first night", () => {
  it("is off by default — night 1 is lethal", () => {
    const s = reduce(gameWith(["werewolf", "villager", "villager", "villager"]), { type: "startNight" });
    expect(s.night!.steps.some((st) => st.kind === "kill")).toBe(true);
  });

  it("gives the wolves no hunt on night 1, then hunts as normal on night 2", () => {
    let s = gameWith(["werewolf", "villager", "villager", "villager"], { peacefulFirstNight: true });
    s = reduce(s, { type: "startNight" });
    expect(s.night!.steps.some((st) => st.kind === "kill")).toBe(false);
    expect(allNightStepsDone(s)).toBe(true); // nothing to wait on
    s = reduce(s, { type: "endNight" });
    expect(living(s)).toHaveLength(4);
    expect(s.log.some((e) => e.type === "noDeath" && e.round === 1)).toBe(true);

    s = skipDay(s);
    expect(s.phase).toBe("night");
    expect(s.round).toBe(2);
    expect(s.night!.steps.some((st) => st.kind === "kill")).toBe(true);
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" });
    expect(living(s)).toHaveLength(3);
  });

  it("leaves the other night roles awake on the peaceful night", () => {
    let s = gameWith(["werewolf", "seer", "villager", "villager"], { peacefulFirstNight: true });
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p0" });
    expect(projectView(s, "p1").myInspects.at(-1)).toMatchObject({ targetId: "p0", reveal: "werewolf" });
  });
});

describe("doctor cooldown", () => {
  it("can't shield the same patient two nights running, but can the night after", () => {
    let s = gameWith(["werewolf", "doctor", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" }); // doctor shields p2
    s = reduce(s, { type: "endNight" });
    expect(living(s)).toHaveLength(5);

    s = skipDay(s);
    expect(s.round).toBe(2);
    expect(validNightTargets(s, "p1").map((p) => p.id)).not.toContain("p2");
    expect(() => reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" })).toThrow();
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" }); // someone else is fine
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p4" });
    s = reduce(s, { type: "endNight" });

    s = skipDay(s);
    expect(s.round).toBe(3);
    expect(validNightTargets(s, "p1").map((p) => p.id)).toContain("p2"); // free again
    expect(validNightTargets(s, "p1").map((p) => p.id)).not.toContain("p3");
  });

  it("a doctor who sat a night out is unrestricted the next one", () => {
    let s = gameWith(["werewolf", "doctor", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p3" });
    s = reduce(s, { type: "endNight" });
    s = skipDay(s);
    // Night 2: the doctor is AFK and the host forces the night to end.
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p4" });
    s = reduce(s, { type: "endNight" });
    s = skipDay(s);
    expect(validNightTargets(s, "p1").map((p) => p.id)).toContain("p2");
  });

  it("would rather allow a repeat than leave a protector with nobody to pick", () => {
    const s: GameState = {
      ...gameWith(["doctor", "villager"]),
      players: gameWith(["doctor", "villager"]).players.map((p) =>
        p.id === "p1" ? { ...p, alive: false } : p
      ),
      lastProtect: { p0: "p0" },
    };
    expect(validNightTargets(s, "p0").map((p) => p.id)).toEqual(["p0"]);
  });
});

describe("rematch", () => {
  /** Play a 4-player game through to a village win. */
  function finishedGame(config?: Partial<GameConfig>): GameState {
    let s = gameWith(["werewolf", "villager", "villager", "villager"], config);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" });
    s = reduce(s, { type: "startVote" });
    s = reduce(s, { type: "castVote", voterId: "p0", targetId: "p2" });
    s = reduce(s, { type: "castVote", voterId: "p2", targetId: "p0" });
    s = reduce(s, { type: "castVote", voterId: "p3", targetId: "p0" });
    s = reduce(s, { type: "resolveVote" });
    expect(s.phase).toBe("gameOver");
    return s;
  }

  it("keeps the room, its players and its setup, but deals a fresh game", () => {
    const done = finishedGame({ nightSummary: "detailed" });
    const s = reduce(done, { type: "playAgain" });
    expect(s.phase).toBe("lobby");
    expect(s.code).toBe(done.code);
    expect(s.config).toEqual(done.config); // no re-toggling the role setup
    expect(s.players.map((p) => p.id)).toEqual(["p0", "p1", "p2", "p3"]);
    expect(s.players.every((p) => p.alive && p.roleId === null)).toBe(true);
    expect(s.players.filter((p) => p.isHost)).toHaveLength(1);
    expect(s.seed).not.toBe(done.seed); // a different deal next time
    expect(s.log).toEqual([]);
    expect(s.winner).toBeNull();
    expect(s.night).toBeNull();
  });

  it("leaves behind players whose device is gone, and hands on the crown", () => {
    const done = finishedGame();
    const s = reduce(
      { ...done, players: done.players.map((p) => (p.id === "p0" ? { ...p, connected: false } : p)) },
      { type: "playAgain" }
    );
    expect(s.players.map((p) => p.id)).toEqual(["p1", "p2", "p3"]);
    expect(s.players.filter((p) => p.isHost)).toHaveLength(1);
    expect(s.players[0].isHost).toBe(true);
  });

  it("refuses to restart a game that is still running", () => {
    expect(() => reduce(gameWith(["werewolf", "villager", "villager"]), { type: "playAgain" })).toThrow();
  });
});

describe("the town square", () => {
  /** A game sitting in day discussion, with p1 already eaten. */
  function daytime(): GameState {
    let s = gameWith(["werewolf", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    return reduce(s, { type: "endNight" });
  }

  it("carries what was said to everyone, tagged with the round", () => {
    let s = daytime();
    s = reduce(s, { type: "say", speakerId: "p2", text: "p0 has been very quiet." });
    expect(s.chat).toEqual([{ round: 1, playerId: "p2", text: "p0 has been very quiet." }]);
    // Public: every seat sees it, including the wolf who was accused.
    for (const id of ["p0", "p2", "p3"])
      expect(projectView(s, id).chat.at(-1)!.text).toBe("p0 has been very quiet.");
  });

  it("keeps the dead and the night quiet", () => {
    const day = daytime();
    expect(() => reduce(day, { type: "say", speakerId: "p1", text: "I was framed!" })).toThrow(
      /dead/i
    );
    const night = reduce(gameWith(["werewolf", "villager", "villager"]), { type: "startNight" });
    expect(() => reduce(night, { type: "say", speakerId: "p1", text: "psst" })).toThrow(/day/i);
  });

  it("still lets the town argue while the vote is open", () => {
    let s = reduce(daytime(), { type: "startVote" });
    s = reduce(s, { type: "say", speakerId: "p2", text: "Last chance to change your mind." });
    expect(s.chat).toHaveLength(1);
  });

  it("tidies up what it stores, and stops listening eventually", () => {
    let s = daytime();
    s = reduce(s, { type: "say", speakerId: "p2", text: `  spaced out  ` });
    expect(s.chat[0].text).toBe("spaced out");
    expect(() => reduce(s, { type: "say", speakerId: "p2", text: "   " })).toThrow(/say something/i);

    s = reduce(s, { type: "say", speakerId: "p2", text: "x".repeat(MAX_CHAT_TEXT + 50) });
    expect(s.chat[1].text).toHaveLength(MAX_CHAT_TEXT);

    const flooded = { ...s, chat: Array(MAX_CHAT_MESSAGES).fill(s.chat[0]) };
    expect(() => reduce(flooded, { type: "say", speakerId: "p2", text: "one more" })).toThrow(
      /hoarse/i
    );
  });

  it("starts every game with an empty room", () => {
    expect(createGame("TEST", 1).chat).toEqual([]);
    const rematch = reduce(
      { ...gameWith(["werewolf", "villager", "villager"]), phase: "gameOver", winner: "village", chat: [{ round: 1, playerId: "p0", text: "gg" }] },
      { type: "playAgain" }
    );
    expect(rematch.chat).toEqual([]);
  });
});
