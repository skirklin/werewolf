import { describe, it, expect } from "vitest";
import { castVotes, voteAll, settleVote, settleNight } from "./testutil.js";
import type { GameState, Player, GameConfig } from "./types.js";
import { reduce, createGame, checkWinner, wonGame, living, allVotesIn, validNightTargets, fabricatedInspect, fabricatedSameTeam, DRUNK_MIMIC_KINDS } from "./engine.js";
import { getRole } from "./roles.js";
import { projectView } from "./views.js";
import { dealRoles, validateConfig, onlyRoles } from "./setup.js";
import { mimicableRoleIds } from "./roles.js";
import { makeRng } from "@party/core";

function countRoles(players: Player[]): Record<string, number> {
  return players.reduce<Record<string, number>>((acc, p) => {
    acc[p.roleId!] = (acc[p.roleId!] ?? 0) + 1;
    return acc;
  }, {});
}

const exact = (): GameConfig => ({
  selection: { mode: "exact", roleCounts: {} },
  revealRoleOnDeath: true,
  nightSummary: "discreet", peacefulFirstNight: false,
});

function gameWith(roles: string[]): GameState {
  const players: Player[] = roles.map((roleId, i) => ({
    id: `p${i}`, name: `P${i}`, roleId, alive: true, connected: true, isHost: i === 0,
  }));
  // Mirror startGame's per-role state init, since this helper bypasses startGame.
  const witchPotions: GameState["witchPotions"] = {};
  for (const p of players) {
    if (p.roleId === "witch") witchPotions[p.id] = { heal: true, poison: true };
  }
  return { ...createGame("TEST", 12345), phase: "roleReveal", players, witchPotions, config: exact() };
}

const alive = (s: GameState, id: string) => living(s).some((p) => p.id === id);

// ---------------------------------------------------------------------------
// Hunter
// ---------------------------------------------------------------------------
describe("Prince", () => {
  it("is spared the first time the town votes them out, and not the second", () => {
    let s = gameWith(["werewolf", "prince", "villager", "villager", "villager"]);
    s = { ...s, phase: "dayDiscussion", round: 1 };
    s = reduce(s, { type: "startVote" });
    s = voteAll(s, (v) => (v === "p1" ? "p0" : "p1"));
    s = reduce(s, { type: "resolveVote" });
    expect(s.announcement!.events).toEqual([{ t: "spared", playerId: "p1", roleId: "prince" }]);
    expect(alive(s, "p1")).toBe(true);
    expect(s.log.at(-1)).toEqual({ type: "spared", round: 1, playerId: "p1" });
    s = reduce(s, { type: "proceed" }); // on to night 2
    s = settleNight(s);
    s = reduce(s, { type: "startVote" });
    s = voteAll(s, (v) => (v === "p1" ? "p0" : "p1"));
    s = reduce(s, { type: "resolveVote" });
    expect(s.announcement!.events).toEqual([{ t: "votedOut", playerId: "p1" }]);
    expect(alive(s, "p1")).toBe(false);
  });
});

describe("Apprentice Seer", () => {
  it("has no power while the Seer lives", () => {
    let s = gameWith(["werewolf", "seer", "apprenticeSeer", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    expect(projectView(s, "p2").nightPrompt).toBeNull();
    expect(projectView(s, "p2").idlePrompt).not.toBeNull();
  });

  it("takes over when the Seer dies in the night — told at dawn, and wakes with the power", () => {
    let s = gameWith(["werewolf", "seer", "apprenticeSeer", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" }); // the wolves eat the Seer
    s = reduce(s, { type: "endNight" });
    expect(s.players[2].roleId).toBe("seer");
    expect(projectView(s, "p2").myNotice).toEqual({ roleId: "seer", promoted: true });
    expect(projectView(s, "p3").myNotice).toBeNull();
    s = reduce(s, { type: "proceed" });
    s = reduce(s, { type: "startVote" });
    s = settleVote(voteAll(s, () => null));
    expect(projectView(s, "p2").nightPrompt).toMatchObject({ kind: "inspect", roleId: "seer" });
    expect(projectView(s, "p2").myNotice).toMatchObject({ promoted: true }); // a reminder on the first night
  });

  it("takes over when the Seer is voted out, told privately with the result", () => {
    let s = gameWith(["werewolf", "seer", "apprenticeSeer", "villager", "villager", "villager"]);
    s = { ...s, phase: "dayDiscussion", round: 1 };
    s = reduce(s, { type: "startVote" });
    s = voteAll(s, (v) => (v === "p1" ? "p0" : "p1"));
    s = reduce(s, { type: "resolveVote" });
    expect(s.players[2].roleId).toBe("seer");
    expect(projectView(s, "p2").myNotice).toEqual({ roleId: "seer", promoted: true });
    expect(projectView(s, "p3").myNotice).toBeNull();
  });

  it("starts out as the Seer when there's no Seer in the deal", () => {
    const players: Player[] = ["a", "b", "c", "d", "e"].map((id, i) => ({
      id, name: id, roleId: null, alive: true, connected: true, isHost: i === 0,
    }));
    const config = { ...exact(), selection: { mode: "exact" as const, roleCounts: { werewolf: 1, apprenticeSeer: 1 } } };
    const s = reduce({ ...createGame("T", 1), players }, { type: "startGame", config });
    const apprentice = s.players.findIndex((p) => s.dealtRoles[s.players.indexOf(p)] === "apprenticeSeer");
    expect(s.players[apprentice].roleId).toBe("seer");
  });
});

/** Settle the night, then a day with no lynch, so the next night begins. */
function toNextNight(s: GameState): GameState {
  s = s.phase === "night" ? settleNight(s) : reduce(s, { type: "proceed" });
  s = reduce(s, { type: "startVote" });
  return settleVote(voteAll(s, () => null));
}

describe("Cursed", () => {
  it("bitten by the wolves, turns instead of dying — a quiet night to everyone else", () => {
    let s = gameWith(["werewolf", "cursed", "villager", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" });
    expect(alive(s, "p1")).toBe(true);
    expect(s.players[1].roleId).toBe("werewolf");
    expect(s.announcement!.events).toEqual([{ t: "quiet" }]);
    expect(projectView(s, "p1").myNotice).toMatchObject({ roleId: "werewolf", infected: true });
    expect(projectView(s, "p0").myNotice).toMatchObject({ packChanged: true });
    expect(projectView(s, "p2").myNotice).toBeNull();
  });

  it("stays on the village's side if the bite is blocked, and dies like anyone to the vote", () => {
    let s = gameWith(["werewolf", "cursed", "doctor", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "nightChoice", actorId: "p2", targetId: "p1" });
    s = settleNight(s);
    expect(s.players[1].roleId).toBe("cursed");
    s = reduce(s, { type: "startVote" });
    s = reduce(s, { type: "resolveVote" });
    s = settleVote(castVotes({ ...s, phase: "dayVote" }, { p0: "p1", p2: "p1", p3: "p1", p4: "p1", p5: "p1" }));
    expect(alive(s, "p1")).toBe(false);
  });
});

describe("Poisoner", () => {
  it("is on its own: doesn't know the wolves, they don't know it, and it can spike anyone", () => {
    let s = gameWith(["werewolf", "poisoner", "villager", "villager", "villager"]);
    expect(projectView(s, "p1").packmates).toEqual([]);
    expect(projectView(s, "p0").packmates).toEqual([]);
    s = reduce(s, { type: "startNight" });
    expect(projectView(s, "p1").nightPrompt!.targetIds).toContain("p0");
  });

  it("wins alongside whoever wins, if still alive", () => {
    const s = gameWith(["werewolf", "poisoner", "villager", "villager", "villager"]);
    const poisoner = s.players[1];
    expect(wonGame(poisoner, "village", null)).toBe(true);
    expect(wonGame(poisoner, "werewolf", null)).toBe(true);
    expect(wonGame({ ...poisoner, alive: false }, "village", null)).toBe(false);
    expect(wonGame(s.players[0], "village", null)).toBe(false);
  });

  it("spikes someone tonight; their power fails the NEXT night, and they can't tell", () => {
    let s = gameWith(["werewolf", "poisoner", "doctor", "villager", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" }); // spike the Doctor
    s = reduce(s, { type: "nightChoice", actorId: "p2", targetId: "p3" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p3" });
    s = reduce(s, { type: "endNight" });
    expect(alive(s, "p3")).toBe(true); // tonight the Doctor's shield still works
    s = toNextNight(s);
    expect(projectView(s, "p2").nightPrompt).toMatchObject({ kind: "protect" }); // same prompt as ever
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p4" }); // can't spike p2 twice running
    s = reduce(s, { type: "nightChoice", actorId: "p2", targetId: "p5" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p5" });
    s = reduce(s, { type: "endNight" });
    expect(alive(s, "p5")).toBe(false); // the shield failed
  });

  it("can't spike the same player two nights running", () => {
    let s = gameWith(["werewolf", "poisoner", "doctor", "villager", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" });
    s = toNextNight(s);
    expect(projectView(s, "p1").nightPrompt!.targetIds).not.toContain("p2");
  });

  it("feeds a spiked Seer a fake vision", () => {
    let s = gameWith(["werewolf", "poisoner", "seer", "villager", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" });
    s = toNextNight(s);
    s = reduce(s, { type: "nightChoice", actorId: "p2", targetId: "p0" });
    expect(s.inspects.at(-1)!.reveal).toBe(fabricatedInspect(s.seed, s.round, "p0", "exactRole"));
  });

  it("a spiked Witch's potion is spent but does nothing", () => {
    let s = gameWith(["werewolf", "poisoner", "witch", "villager", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p6" });
    s = reduce(s, { type: "witchAction", actorId: "p2", heal: false, poisonTargetId: null });
    s = toNextNight(s);
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p3" });
    s = reduce(s, { type: "witchAction", actorId: "p2", heal: true, poisonTargetId: null });
    s = reduce(s, { type: "endNight" });
    expect(alive(s, "p3")).toBe(false);
    expect(s.witchPotions["p2"].heal).toBe(false);
  });
});

describe("Hunter", () => {
  it("picks a target every night, and is the only one who sees it", () => {
    let s = gameWith(["werewolf", "hunter", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    expect(projectView(s, "p1").nightPrompt).toMatchObject({ kind: "mark" });
    expect(projectView(s, "p1").nightPrompt!.targetIds).not.toContain("p1");
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "endNight" });
    expect(projectView(s, "p1").myMark).toBe("p3");
    expect(projectView(s, "p2").myMark).toBeNull();
  });

  it("killed at night, takes tonight's pick down too — announced at dawn", () => {
    let s = gameWith(["werewolf", "hunter", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" }); // wolf eats hunter
    s = reduce(s, { type: "endNight" });
    expect(s.phase).toBe("announce");
    expect(s.announcement!.events).toEqual([
      { t: "killed", playerId: "p1" },
      { t: "shot", shooterId: "p1", playerId: "p2" },
    ]);
    expect(alive(s, "p2")).toBe(false);
    s = reduce(s, { type: "proceed" });
    expect(s.phase).toBe("dayDiscussion");
  });

  it("voted out, takes last night's pick down too — announced with the vote", () => {
    let s = gameWith(["werewolf", "hunter", "villager", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = settleNight(s);
    s = reduce(s, { type: "startVote" });
    s = castVotes(s, Object.fromEntries(living(s).filter((p) => p.id !== "p1").map((p) => [p.id, "p1"])));
    s = reduce(s, { type: "resolveVote" });
    expect(s.announcement!.events).toEqual([
      { t: "votedOut", playerId: "p1" },
      { t: "shot", shooterId: "p1", playerId: "p3" },
    ]);
    s = reduce(s, { type: "proceed" });
    expect(s.phase).toBe("night");
    expect(s.round).toBe(2);
  });

  it("chains when a Hunter's pick is another Hunter", () => {
    let s = gameWith(["werewolf", "hunter", "hunter", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" });
    s = reduce(s, { type: "nightChoice", actorId: "p2", targetId: "p3" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" }); // wolf eats hunter p1
    s = reduce(s, { type: "endNight" });
    expect([alive(s, "p1"), alive(s, "p2"), alive(s, "p3")]).toEqual([false, false, false]);
  });

  it("does not shoot if saved", () => {
    let s = gameWith(["werewolf", "hunter", "doctor", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" }); // wolf targets hunter
    s = reduce(s, { type: "nightChoice", actorId: "p2", targetId: "p1" }); // doctor saves hunter
    s = settleNight(s);
    expect(alive(s, "p1")).toBe(true);
    expect(alive(s, "p3")).toBe(true);
  });

  it("a dying Hunter's pick can end the game", () => {
    let s = gameWith(["werewolf", "hunter", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p0" }); // the Hunter suspects the wolf
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = settleNight(s);
    s = reduce(s, { type: "startVote" });
    s = castVotes(s, Object.fromEntries(living(s).filter((p) => p.id !== "p1").map((p) => [p.id, "p1"])));
    s = reduce(s, { type: "resolveVote" });
    expect(s.announcement).toMatchObject({ next: "gameOver", winner: "village" });
    s = reduce(s, { type: "proceed" });
    expect(s.phase).toBe("gameOver");
  });

  it("with no pick (or a pick already dead), dies without shooting", () => {
    let s = gameWith(["werewolf", "hunter", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" }); // the Hunter never picked
    s = reduce(s, { type: "endNight" });
    expect(living(s)).toHaveLength(4);
    expect(s.announcement!.events).toEqual([{ t: "killed", playerId: "p1" }]);
  });
});

// ---------------------------------------------------------------------------
// Tanner
// ---------------------------------------------------------------------------
describe("Tanner", () => {
  it("wins alone when lynched", () => {
    let s = gameWith(["werewolf", "tanner", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = settleNight(s);
    s = reduce(s, { type: "startVote" });
    s = castVotes(s, Object.fromEntries(living(s).filter((p) => p.id !== "p1").map((p) => [p.id, "p1"])));
    s = settleVote(s);
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("solo");
    expect(s.soloWinnerId).toBe("p1");
  });

  it("surfaces the solo winner in the projected view", () => {
    let s = gameWith(["werewolf", "tanner", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = settleNight(s);
    s = reduce(s, { type: "startVote" });
    // Everyone else votes out the Tanner (p1), who votes for p3.
    s = castVotes(s, { ...Object.fromEntries(living(s).filter((p) => p.id !== "p1").map((p) => [p.id, "p1"])), p1: "p3" });
    s = settleVote(s);
    const v = projectView(s, "p3");
    expect(v.winner).toBe("solo");
    expect(v.soloWinnerId).toBe("p1");
    expect(v.players.find((p) => p.id === "p1")!.roleId).toBe("tanner"); // revealed at end
  });

  it("does not win if merely killed at night", () => {
    let s = gameWith(["werewolf", "tanner", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" }); // wolves eat the tanner
    s = settleNight(s);
    expect(s.phase).toBe("dayDiscussion");
    expect(s.winner).toBeNull();
  });

  it("an alive Tanner does not block a village win, and counts as town for parity", () => {
    const villageWon = gameWith(["werewolf", "tanner", "villager"]);
    const noWolves = { ...villageWon, players: villageWon.players.map((p) => (p.id === "p0" ? { ...p, alive: false } : p)) };
    expect(checkWinner(noWolves)).toBe("village");
    expect(checkWinner(gameWith(["werewolf", "tanner"]))).toBe("werewolf"); // 1 wolf vs 1 tanner = parity
  });
});

// ---------------------------------------------------------------------------
// Drunk
// ---------------------------------------------------------------------------
describe("Village Drunk (mimics any role)", () => {
  // p1 is the drunk; give it an explicit disguise (startGame randomizes it).
  const drunkAs = (disguise: string, extra: string[] = ["villager", "villager"]): GameState => {
    const s = gameWith(["werewolf", "drunk", ...extra]);
    return { ...s, drunkDisguise: { p1: disguise } };
  };

  it("shows its disguised role, and hides its true role until game over", () => {
    const s = drunkAs("doctor");
    const v = projectView(s, "p1");
    expect(v.you.roleId).toBe("doctor"); // impersonates the doctor
    expect(v.players.find((p) => p.id === "p1")!.roleId).toBe("doctor"); // consistent
    expect(projectView({ ...s, phase: "gameOver" }, "p1").you.roleId).toBe("drunk"); // truth at the end
  });

  it("mimicking the Seer gives a fake exact-role result", () => {
    let s = drunkAs("seer");
    s = reduce(s, { type: "startNight" });
    expect(projectView(s, "p1").nightPrompt!.roleId).toBe("seer");
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p0" }); // "inspect" the wolf
    const r = projectView(s, "p1").myInspects.at(-1)!;
    expect(r.reveal).toBe(fabricatedInspect(s.seed, s.round, "p0", "exactRole"));
    expect(["villager", "werewolf", "seer", "doctor"]).toContain(r.reveal);
  });

  it("mimicking the Aura Seer gives a fake werewolf-or-not result", () => {
    let s = drunkAs("auraSeer");
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p0" });
    const r = projectView(s, "p1").myInspects.at(-1)!;
    expect(r.reveal).toBe(fabricatedInspect(s.seed, s.round, "p0", "isWerewolf"));
    expect(["werewolf", "not-werewolf"]).toContain(r.reveal);
  });

  it("mimicking the Doctor protects no one", () => {
    let s = drunkAs("doctor");
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // wolf targets p2
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" }); // drunk "protects" p2
    s = settleNight(s);
    expect(alive(s, "p2")).toBe(false); // the fake protection did nothing
  });

  it("mimicking the Doctor is bound by the same no-repeat rule, so the fake holds", () => {
    let s = drunkAs("doctor", ["villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" }); // drunk "protects" p3
    s = settleNight(s);
    s = reduce(s, { type: "startVote" });
    s = voteAll(s, () => null);
    s = settleVote(s);
    expect(s.round).toBe(2);
    // A real doctor couldn't repeat, so neither can the drunk — otherwise the
    // missing-name tell would give the disguise away.
    expect(validNightTargets(s, "p1").map((p) => p.id)).not.toContain("p3");
  });

  it("mimicking the Silencer silences no one", () => {
    let s = drunkAs("silencer");
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" }); // drunk "silences" p3
    s = settleNight(s);
    expect(s.silenced).toEqual([]);
  });

  it("mimicking the Troublemaker swaps no one", () => {
    let s = drunkAs("troublemaker");
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "swapAction", actorId: "p1", aId: "p2", bId: "p3" }); // drunk "swaps"
    s = settleNight(s);
    expect(s.players.find((p) => p.id === "p3")!.roleId).toBe("villager"); // unchanged
  });

  it("mimicking the Detective gives a fake same-team verdict", () => {
    let s = drunkAs("detective");
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "detectAction", actorId: "p1", aId: "p0", bId: "p2" });
    const d = projectView(s, "p1").myDetections.at(-1)!;
    expect(d.sameTeam).toBe(fabricatedSameTeam(s.seed, s.round, "p0", "p2"));
  });

  it("mimicking the Medium raises no one, but the fake power is one-time", () => {
    let s = drunkAs("medium", ["villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    expect(projectView(s, "p1").nightPrompt).toBeNull(); // no dead to 'raise' yet
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // p2 dies
    s = settleNight(s);
    s = reduce(s, { type: "startVote" });
    s = voteAll(s, () => null);
    s = settleVote(s); // night 2
    s = reduce(s, { type: "raiseAction", actorId: "p1", targetId: "p2" }); // drunk "raises" p2
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p3" });
    s = settleNight(s);
    expect(alive(s, "p2")).toBe(false); // stayed dead
    expect(s.used["p1"]).toBe(true); // ...but the fake power is spent
  });

  it("hides the pack and real roles from the Drunk (no leak)", () => {
    const s = drunkAs("seer");
    const v = projectView(s, "p1");
    expect(v.packmates).toEqual([]);
    expect(v.players.find((p) => p.id === "p0")!.roleId).toBeNull(); // wolf hidden
  });

  it("a real role and its Drunk twin share one step — only the real one takes effect", () => {
    // p0 wolf, p1 real doctor, p2 drunk-as-doctor, p3 villager
    let s = gameWith(["werewolf", "doctor", "drunk", "villager"]);
    s = { ...s, drunkDisguise: { p2: "doctor" } };
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p3" }); // wolf targets p3
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" }); // REAL doctor saves p3
    s = reduce(s, { type: "nightChoice", actorId: "p2", targetId: "p3" }); // drunk "saves" p3 too
    s = settleNight(s);
    expect(alive(s, "p3")).toBe(true); // the real doctor's save counted
  });

  it("a Drunk-Troublemaker's swap is skipped even if the real Troublemaker moves its seat first", () => {
    // p0 wolf, p1 real troublemaker, p2 drunk-as-troublemaker, p3 villager, p4 seer, p5 villager
    let s = gameWith(["werewolf", "troublemaker", "drunk", "villager", "seer", "villager"]);
    s = { ...s, drunkDisguise: { p2: "troublemaker" } };
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p3" });
    s = reduce(s, { type: "swapAction", actorId: "p1", aId: "p2", bId: "p3" }); // real: swap the drunk's seat
    s = reduce(s, { type: "swapAction", actorId: "p2", aId: "p4", bId: "p5" }); // drunk: should do nothing
    s = settleNight(s);
    expect(s.players.find((p) => p.id === "p4")!.roleId).toBe("seer"); // drunk's swap fizzled
  });

  it("a converted Drunk becomes a real wolf (disguise dropped, no more fakery)", () => {
    // p0 wolf, p1 infector, p2 drunk-as-seer, p3..p7 villagers
    let s = gameWith(["werewolf", "infector", "drunk", "villager", "villager", "villager", "villager", "villager"]);
    s = { ...s, drunkDisguise: { p2: "seer" } };
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p3" }); // wolf kills p3
    s = reduce(s, { type: "nightChoice", actorId: "p2", targetId: "p4" }); // drunk-as-seer "inspects" (fake)
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" }); // infector converts the drunk
    s = settleNight(s);
    expect(s.players.find((p) => p.id === "p2")!.roleId).toBe("werewolf");
    expect(s.drunkDisguise["p2"]).toBeUndefined();
    // Next night the ex-Drunk wakes as a real wolf (kill step + sees the pack).
    s = reduce(s, { type: "startVote" });
    s = voteAll(s, () => null);
    s = settleVote(s);
    const v = projectView(s, "p2");
    expect(v.nightPrompt!.kind).toBe("kill");
    expect(v.packmates).toContain("p0");
  });

  it("every mimicable role uses a night kind the Drunk safely handles (extension guard)", () => {
    // Adding a new mimicable role is just a flag — unless it brings a night
    // kind the Drunk can't fake invisibly, in which case this fails until
    // DRUNK_MIMIC_KINDS + handling (and a leak check) are added.
    for (const id of mimicableRoleIds()) {
      const kind = getRole(id).night?.kind;
      if (kind) expect(DRUNK_MIMIC_KINDS, `Drunk can't safely fake '${kind}' (role ${id})`).toContain(kind);
    }
  });

  it("a Drunk posing as a passive role never triggers it — and is found out only in death", () => {
    const drunkAs = (disguise: string, roles: string[]): GameState => ({ ...gameWith(roles), drunkDisguise: { p1: disguise } });
    // A fake Hunter's mark fires nothing.
    let s = drunkAs("hunter", ["werewolf", "drunk", "villager", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p0" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" });
    expect(alive(s, "p0")).toBe(true);
    // A fake Cursed dies of the bite.
    s = drunkAs("cursed", ["werewolf", "drunk", "villager", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" });
    expect(alive(s, "p1")).toBe(false);
    // A fake Prince is voted out like anyone else.
    s = { ...drunkAs("prince", ["werewolf", "drunk", "villager", "villager", "villager"]), phase: "dayDiscussion", round: 1 };
    s = reduce(s, { type: "startVote" });
    s = reduce(voteAll(s, (v) => (v === "p1" ? "p0" : "p1")), { type: "resolveVote" });
    expect(s.announcement!.events).toEqual([{ t: "votedOut", playerId: "p1" }]);
    // A fake Tanner voted out just dies; nobody wins yet.
    s = { ...drunkAs("tanner", ["werewolf", "drunk", "villager", "villager", "villager", "villager"]), phase: "dayDiscussion", round: 1 };
    s = reduce(s, { type: "startVote" });
    s = settleVote(voteAll(s, (v) => (v === "p1" ? "p0" : "p1")));
    expect(s.phase).not.toBe("gameOver");
    expect(alive(s, "p1")).toBe(false);
    // A fake Poisoner's supper is harmless.
    s = drunkAs("poisoner", ["werewolf", "drunk", "seer", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" });
    s = reduce(s, { type: "nightChoice", actorId: "p2", targetId: "p0" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p3" });
    s = reduce(s, { type: "endNight" });
    expect(s.drugged).toEqual([]);
    // Whatever they thought they were playing for, the Drunk wins with the village.
    expect(wonGame({ id: "p1", roleId: "drunk", alive: false }, "village", null)).toBe(true);
  });

  it("startGame secretly assigns each Drunk a random mimicable role", () => {
    const players: Player[] = Array.from({ length: 6 }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, roleId: null, alive: true, connected: true, isHost: false,
    }));
    const cfg: GameConfig = {
      selection: { mode: "exact", roleCounts: { werewolf: 1, drunk: 1, seer: 1 } },
      revealRoleOnDeath: false,
      nightSummary: "discreet", peacefulFirstNight: false,
    };
    const s = reduce({ ...createGame("X", 99), phase: "lobby", players }, { type: "startGame", config: cfg });
    const drunk = s.players.find((p) => p.roleId === "drunk")!;
    // Only a role this game could have: anything else would tell the Drunk what they are.
    expect(["seer", "werewolf"]).toContain(s.drunkDisguise[drunk.id]);
  });

  it("a Drunk Werewolf hunts with a pack it imagines, and the real pack never sees it", () => {
    let s: GameState = {
      ...gameWith(["werewolf", "drunk", "villager", "villager", "villager", "villager"]),
      drunkDisguise: { p1: "werewolf" },
      drunkPack: { p1: ["p2"] },
    };
    s = reduce(s, { type: "startNight" });
    // It wakes alone; the real wolf's step holds only the real wolf.
    expect(s.night!.steps.map((st) => st.actorIds)).toEqual([["p0"], ["p1"]]);
    const real = projectView(s, "p0");
    expect(real.packmates).toEqual([]);
    expect(real.players.find((p) => p.id === "p1")!.roleId).toBeNull();
    const drunk = projectView(s, "p1");
    expect(drunk.packmates).toEqual(["p2"]);
    expect(drunk.players.find((p) => p.id === "p2")!.roleId).toBe("werewolf");
    expect(drunk.players.find((p) => p.id === "p0")!.roleId).toBeNull();
    // It may hunt the real wolf, but not its imagined packmate.
    const targets = validNightTargets(s, "p1").map((p) => p.id);
    expect(targets).toContain("p0");
    expect(targets).not.toContain("p2");
    // Only the real pack's kill lands.
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p4" });
    s = reduce(s, { type: "endNight" });
    expect(alive(s, "p3")).toBe(true);
    expect(alive(s, "p4")).toBe(false);
  });

  it("deals a Drunk Werewolf an imagined pack of one or more, no bigger than the table's biggest real one", () => {
    const players: Player[] = Array.from({ length: 10 }, (_, i) => ({
      id: `p${i}`, name: `P${i}`, roleId: null, alive: true, connected: true, isHost: false,
    }));
    const cfg: GameConfig = {
      selection: { mode: "exact", roleCounts: { werewolf: 1, drunk: 1 } },
      revealRoleOnDeath: false,
      nightSummary: "discreet", peacefulFirstNight: false,
    };
    const sizes = new Set<number>();
    for (let seed = 1; seed <= 60; seed++) {
      const s = reduce({ ...createGame("X", seed), phase: "lobby", players }, { type: "startGame", config: cfg });
      const drunk = s.players.find((p) => p.roleId === "drunk")!;
      expect(s.drunkDisguise[drunk.id]).toBe("werewolf"); // the only role in play it can pose as
      expect(s.drunkPack[drunk.id]).not.toContain(drunk.id);
      sizes.add(s.drunkPack[drunk.id].length);
    }
    expect([...sizes].sort()).toEqual([1, 2]); // up to maxWolfTeam(10) = 3, counting itself
  });

  it("is on the village team and reveals as the Drunk at game over", () => {
    expect(checkWinner(gameWith(["werewolf", "drunk"]))).toBe("werewolf"); // drunk counts as town
    const g = gameWith(["werewolf", "drunk", "villager"]);
    const noWolves = { ...g, players: g.players.map((p) => (p.id === "p0" ? { ...p, alive: false } : p)) };
    expect(checkWinner(noWolves)).toBe("village");
  });
});

// ---------------------------------------------------------------------------
// Witch
// ---------------------------------------------------------------------------
describe("Witch", () => {
  it("acts blind: her prompt is up before the wolves choose and never names their victim", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    const before = projectView(s, "p1").nightPrompt!;
    expect(before.kind).toBe("witch");
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    const after = projectView(s, "p1").nightPrompt!;
    expect(after).toEqual(before); // the wolves' pick changes nothing she can see
    expect(JSON.stringify(after.witch)).not.toMatch(/victim/);
    // She may act before the wolves have chosen.
    let early = gameWith(["werewolf", "witch", "villager", "villager"]);
    early = reduce(early, { type: "startNight" });
    early = reduce(early, { type: "witchAction", actorId: "p1", heal: true, poisonTargetId: null });
    expect(early.night!.steps.find((st) => st.kind === "witch")!.done).toBe(true);
  });

  it("her heal saves whoever the wolves attack, spending the potion", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "witchAction", actorId: "p1", heal: true, poisonTargetId: null });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = settleNight(s);
    expect(alive(s, "p2")).toBe(true);
    expect(s.witchPotions["p1"]).toEqual({ heal: false, poison: true });
  });

  it("a heal on a night the wolves attack nobody is still spent", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "witchAction", actorId: "p1", heal: true, poisonTargetId: null });
    s = settleNight(s); // the wolves never chose: nobody was attacked
    expect(s.witchPotions["p1"]).toEqual({ heal: false, poison: true });
  });

  it("sleeps through a peaceful first night (no killing, and a heal would be wasted)", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager", "villager"]);
    s = { ...s, config: { ...s.config, peacefulFirstNight: true } };
    s = reduce(s, { type: "startNight" });
    expect(s.night!.steps.map((st) => st.kind)).not.toContain("witch");
    expect(projectView(s, "p1").nightPrompt).toBeNull();
    expect(projectView(s, "p1").idlePrompt).not.toBeNull(); // a decoy, like anyone else
  });

  it("poisons a chosen player, spending the poison potion", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "witchAction", actorId: "p1", heal: false, poisonTargetId: "p3" });
    s = settleNight(s);
    expect(alive(s, "p2")).toBe(false); // wolf kill
    expect(alive(s, "p3")).toBe(false); // poisoned
    expect(s.witchPotions["p1"]).toEqual({ heal: true, poison: false });
    expect(s.log.some((e) => e.type === "poisoned" && e.playerId === "p3")).toBe(true);
  });

  it("each potion is one-time — a spent potion can't be used again", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "witchAction", actorId: "p1", heal: true, poisonTargetId: null });
    s = settleNight(s); // heal spent
    // Day, then a new night.
    s = reduce(s, { type: "startVote" });
    s = castVotes(s, Object.fromEntries(living(s).filter((p) => p.id !== "p3").map((p) => [p.id, "p3"])));
    s = settleVote(s);
    expect(s.phase).toBe("night");
    expect(projectView(s, "p1").nightPrompt!.witch!.healAvailable).toBe(false);
    expect(() =>
      reduce(s, { type: "witchAction", actorId: "p1", heal: true, poisonTargetId: null })
    ).toThrow();
  });

  it("cannot poison itself", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    expect(() =>
      reduce(s, { type: "witchAction", actorId: "p1", heal: false, poisonTargetId: "p1" })
    ).toThrow();
  });

  it("healing AND poisoning the same victim still kills them, and logs a death", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // wolves target p2
    s = reduce(s, { type: "witchAction", actorId: "p1", heal: true, poisonTargetId: "p2" }); // heal + poison p2
    s = settleNight(s);
    expect(alive(s, "p2")).toBe(false); // poison bypasses the heal
    expect(s.log.some((e) => e.type === "poisoned" && e.playerId === "p2")).toBe(true);
    expect(s.log.some((e) => e.type === "saved" && (e as any).playerId === "p2")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Troublemaker
// ---------------------------------------------------------------------------
describe("Troublemaker", () => {
  it("swaps two players' roles for the rest of the game", () => {
    let s = gameWith(["werewolf", "troublemaker", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // wolf kills p2
    s = reduce(s, { type: "swapAction", actorId: "p1", aId: "p0", bId: "p3" }); // swap wolf & villager
    s = settleNight(s);
    expect(s.players.find((p) => p.id === "p0")!.roleId).toBe("villager"); // former wolf is now a villager
    expect(s.players.find((p) => p.id === "p3")!.roleId).toBe("werewolf"); // the villager is now the wolf
  });

  it("only swaps living players", () => {
    let s = gameWith(["werewolf", "troublemaker", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // p2 will die
    s = reduce(s, { type: "swapAction", actorId: "p1", aId: "p2", bId: "p3" }); // p2 dies this night
    s = settleNight(s);
    // The swap fizzles because a target died; roles unchanged.
    expect(s.players.find((p) => p.id === "p3")!.roleId).toBe("villager");
  });

  it("rejects illegal swaps", () => {
    let s = gameWith(["werewolf", "troublemaker", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    expect(() => reduce(s, { type: "swapAction", actorId: "p1", aId: "p1", bId: "p2" })).toThrow(); // self
    expect(() => reduce(s, { type: "swapAction", actorId: "p1", aId: "p2", bId: "p2" })).toThrow(); // same
  });

  it("potions follow the role when a Witch is swapped", () => {
    // p0 wolf, p1 troublemaker, p2 witch, p3 villager, p4 villager
    let s = gameWith(["werewolf", "troublemaker", "witch", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p3" });
    s = reduce(s, { type: "swapAction", actorId: "p1", aId: "p2", bId: "p4" }); // swap witch & villager
    // Witch (p2) must act before night ends; she does nothing this round.
    s = reduce(s, { type: "witchAction", actorId: "p2", heal: false, poisonTargetId: null });
    s = settleNight(s);
    // p4 is now the Witch and holds the potions; p2 no longer does.
    expect(s.players.find((p) => p.id === "p4")!.roleId).toBe("witch");
    expect(s.witchPotions["p4"]).toEqual({ heal: true, poison: true });
    expect(s.witchPotions["p2"]).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// Silencer
// ---------------------------------------------------------------------------
describe("Silencer", () => {
  it("stops the silenced player from voting, without blocking the vote", () => {
    let s = gameWith(["werewolf", "silencer", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // wolf kills p2
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" }); // silence p3
    s = settleNight(s);
    expect(s.silenced).toContain("p3");
    expect(projectView(s, "p0").silencedIds).toContain("p3"); // public

    s = reduce(s, { type: "startVote" });
    expect(() => reduce(s, { type: "castVote", voterId: "p3", targetId: "p1" })).toThrow(/silenced/i);
    // The remaining eligible voters (p0, p1, p4) can still resolve the day.
    s = castVotes(s, { "p0": "p4", "p1": "p4", "p4": "p1" });
    expect(allVotesIn(s)).toBe(true); // p3 not required
    s = settleVote(s);
    expect(alive(s, "p4")).toBe(false); // lynched 2-1
  });

  it("a day with no eligible voters resolves to no lynch (can't dead-end)", () => {
    let s = gameWith(["werewolf", "silencer", "villager"]);
    // Everyone living is silenced — the degenerate case the local mode guards.
    s = { ...s, phase: "dayVote", silenced: living(s).map((p) => p.id), votes: {} };
    expect(allVotesIn(s)).toBe(true); // vacuously — nobody may vote
    s = settleVote(s);
    expect(s.phase).toBe("night"); // continues, nobody lynched
  });

  it("does not list a silenced player who has died", () => {
    let s = gameWith(["werewolf", "silencer", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // wolves kill p2
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" }); // silencer also picked p2
    s = settleNight(s);
    expect(projectView(s, "p0").silencedIds).not.toContain("p2"); // dead, so not shown
  });

  it("silence lasts a single day, then expires", () => {
    let s = gameWith(["werewolf", "silencer", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" });
    s = settleNight(s);
    s = reduce(s, { type: "startVote" });
    s = voteAll(s, () => null);
    s = settleVote(s); // -> next night
    expect(s.phase).toBe("night");
    expect(s.silenced).toEqual([]); // cleared for the new night
  });
});

// ---------------------------------------------------------------------------
// Detective
// ---------------------------------------------------------------------------
describe("Detective", () => {
  it("learns whether two players share a team, but not which", () => {
    const detect = (a: string, b: string) => {
      let s = gameWith(["werewolf", "detective", "villager", "villager"]);
      s = reduce(s, { type: "startNight" });
      s = reduce(s, { type: "detectAction", actorId: "p1", aId: a, bId: b });
      return projectView(s, "p1").myDetections.at(-1)!;
    };
    expect(detect("p2", "p3").sameTeam).toBe(true); // two villagers
    expect(detect("p0", "p2").sameTeam).toBe(false); // wolf + villager
  });

  it("only the detective sees their readings", () => {
    let s = gameWith(["werewolf", "detective", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "detectAction", actorId: "p1", aId: "p0", bId: "p2" });
    expect(projectView(s, "p2").myDetections).toHaveLength(0);
  });

  it("rejects illegal investigations", () => {
    let s = gameWith(["werewolf", "detective", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    expect(() => reduce(s, { type: "detectAction", actorId: "p1", aId: "p1", bId: "p2" })).toThrow(); // self
    expect(() => reduce(s, { type: "detectAction", actorId: "p1", aId: "p2", bId: "p2" })).toThrow(); // same
  });
});

// ---------------------------------------------------------------------------
// Medium
// ---------------------------------------------------------------------------
describe("Medium", () => {
  it("has nothing to do until someone has died", () => {
    let s = gameWith(["werewolf", "medium", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    expect(projectView(s, "p1").nightPrompt).toBeNull(); // no dead to raise yet
  });

  it("raises a dead player once, spending the power", () => {
    let s = gameWith(["werewolf", "medium", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // p2 dies
    s = settleNight(s);
    // Skip the day.
    s = reduce(s, { type: "startVote" });
    s = voteAll(s, () => null);
    s = settleVote(s); // -> night 2
    expect(s.phase).toBe("night");
    // Now the Medium can raise the dead p2.
    expect(projectView(s, "p1").nightPrompt!.kind).toBe("raise");
    s = reduce(s, { type: "raiseAction", actorId: "p1", targetId: "p2" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p3" });
    s = settleNight(s);
    expect(alive(s, "p2")).toBe(true); // back from the dead
    expect(s.used["p1"]).toBe(true);
    expect(s.log.some((e) => e.type === "raised" && e.playerId === "p2")).toBe(true);
    // Power spent: no raise step on the next night.
    s = reduce(s, { type: "startVote" });
    s = voteAll(s, () => null);
    s = settleVote(s);
    expect(projectView(s, "p1").nightPrompt?.kind).not.toBe("raise");
  });

  it("stays one-time even when the Medium is swapped the same night (spent flag follows the role)", () => {
    // p0 wolf, p1 medium, p2 troublemaker, p3-p5 villagers
    let s = gameWith(["werewolf", "medium", "troublemaker", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p3" }); // p3 dies
    s = settleNight(s);
    s = reduce(s, { type: "startVote" });
    s = voteAll(s, () => null);
    s = settleVote(s); // -> night 2
    // Medium raises p3, Troublemaker swaps the Medium (p1) with villager p5.
    s = reduce(s, { type: "raiseAction", actorId: "p1", targetId: "p3" });
    s = reduce(s, { type: "swapAction", actorId: "p2", aId: "p1", bId: "p5" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p4" });
    s = settleNight(s);
    expect(alive(s, "p3")).toBe(true); // raised
    expect(s.players.find((p) => p.id === "p5")!.roleId).toBe("medium"); // role moved
    expect(s.used["p5"]).toBe(true); // ...carrying the SPENT flag
    expect(s.used["p1"]).toBeUndefined();
    // The new Medium (p5) gets no raise step — the power is truly gone.
    s = reduce(s, { type: "startVote" });
    s = voteAll(s, () => null);
    s = settleVote(s);
    expect(projectView(s, "p5").nightPrompt?.kind).not.toBe("raise");
  });

  it("holding the power does not spend it, and dead players only", () => {
    let s = gameWith(["werewolf", "medium", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = settleNight(s);
    s = reduce(s, { type: "startVote" });
    s = voteAll(s, () => null);
    s = settleVote(s); // night 2
    expect(() => reduce(s, { type: "raiseAction", actorId: "p1", targetId: "p3" })).toThrow(); // p3 alive
    s = reduce(s, { type: "raiseAction", actorId: "p1", targetId: null }); // hold
    expect(s.used["p1"]).toBeFalsy();
  });
});

// ---------------------------------------------------------------------------
// Henchman
// ---------------------------------------------------------------------------
describe("a tie with the wolves", () => {
  it("ends the game when nothing can break it", () => {
    expect(checkWinner(gameWith(["werewolf", "villager"]))).toBe("werewolf");
    expect(checkWinner(gameWith(["werewolf", "werewolf", "seer", "doctor"]))).toBe("werewolf");
  });

  it("plays on while the Witch's poison, the Medium's raise, a Hunter or a Gossip could break it", () => {
    for (const role of ["witch", "medium", "hunter", "silencer"])
      expect(checkWinner(gameWith(["werewolf", "werewolf", "villager", role])), role).toBeNull();
  });

  it("ends once those powers are spent", () => {
    const witch = gameWith(["werewolf", "witch"]);
    expect(checkWinner({ ...witch, witchPotions: { p1: { heal: true, poison: false } } })).toBe("werewolf");
    const medium = gameWith(["werewolf", "medium"]);
    expect(checkWinner({ ...medium, used: { p1: true } })).toBe("werewolf");
  });

  it("ends anyway when the wolves outnumber everyone else", () => {
    expect(checkWinner(gameWith(["werewolf", "werewolf", "silencer"]))).toBe("werewolf");
  });

  it("doesn't count a Drunk's imagined power", () => {
    const s = gameWith(["werewolf", "drunk"]);
    expect(checkWinner({ ...s, drunkDisguise: { p1: "silencer" } })).toBe("werewolf");
  });
});

describe("Henchman", () => {
  it("wins with the wolves but doesn't keep them alive", () => {
    const s = gameWith(["werewolf", "henchman", "villager", "villager"]);
    // Kill the only real wolf — the village wins even though the henchman lives.
    const noWolf = { ...s, players: s.players.map((p) => (p.id === "p0" ? { ...p, alive: false } : p)) };
    expect(checkWinner(noWolf)).toBe("village");
    // Discriminating check: a lone Henchman with NO real wolf must be a village win
    // (would be null/ongoing if the Henchman were wrongly counted as a wolf).
    expect(checkWinner(gameWith(["henchman", "villager", "villager"]))).toBe("village");
    // A real wolf at parity with the henchman as the other body → wolves win.
    expect(checkWinner(gameWith(["werewolf", "henchman"]))).toBe("werewolf");
  });

  it("counts toward the wolves' majority, since they vote with the pack", () => {
    // One wolf + Henchman against two villagers: the pack holds half the votes.
    expect(checkWinner(gameWith(["werewolf", "henchman", "villager", "villager"]))).toBe("werewolf");
    // Against three villagers it's still a game.
    expect(checkWinner(gameWith(["werewolf", "henchman", "villager", "villager", "villager"]))).toBeNull();
  });

  it("can't be dealt into a table where the pack would start with half", () => {
    expect(validateConfig({ ...gameWith([]).config, selection: { mode: "exact", roleCounts: { werewolf: 1, henchman: 1 } } }, 4))
      .toEqual(expect.arrayContaining([expect.objectContaining({ message: expect.stringMatching(/Too many/) })]));
  });

  it("is hidden from the villagers (no pack leak)", () => {
    const s = gameWith(["werewolf", "henchman", "villager", "villager"]);
    const v = projectView(s, "p2"); // a plain villager
    expect(v.packmates).toEqual([]);
    expect(v.players.find((p) => p.id === "p0")!.roleId).toBeNull(); // wolf hidden
    expect(v.players.find((p) => p.id === "p1")!.roleId).toBeNull(); // henchman hidden
  });

  it("reads same-team as the wolves to the Detective", () => {
    let s = gameWith(["werewolf", "detective", "henchman", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "detectAction", actorId: "p1", aId: "p0", bId: "p2" }); // wolf + henchman
    expect(projectView(s, "p1").myDetections.at(-1)!.sameTeam).toBe(true);
  });

  it("is rejected in exact mode when it's the only 'wolf'", () => {
    const cfg: GameConfig = {
      selection: { mode: "exact", roleCounts: { henchman: 1 } },
      revealRoleOnDeath: false,
      nightSummary: "discreet", peacefulFirstNight: false,
    };
    expect(validateConfig(cfg, 5)).toEqual(
      expect.arrayContaining([{ message: "Need at least 1 werewolf." }])
    );
  });

  it("knows the pack and can't be eaten by it", () => {
    let s = gameWith(["werewolf", "henchman", "villager", "villager"]);
    expect(projectView(s, "p1").packmates).toContain("p0"); // henchman sees the wolf
    expect(projectView(s, "p0").packmates).toContain("p1"); // and vice versa
    s = reduce(s, { type: "startNight" });
    expect(projectView(s, "p0").nightPrompt!.targetIds).not.toContain("p1"); // wolf can't target henchman
  });

  it("reads as NOT a werewolf to the Aura Seer", () => {
    let s = gameWith(["werewolf", "auraSeer", "henchman", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p2" }); // inspect henchman
    expect(projectView(s, "p1").myInspects.at(-1)!.reveal).toBe("not-werewolf");
  });
});

// ---------------------------------------------------------------------------
// Infector
// ---------------------------------------------------------------------------
describe("Infector", () => {
  const infectorGame = () =>
    gameWith(["werewolf", "infector", "villager", "villager", "villager", "villager", "villager", "villager"]);

  it("dies passing the curse on: the pack keeps its size, announced at dawn", () => {
    let s = infectorGame();
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" });
    s = reduce(s, { type: "endNight" });
    expect(alive(s, "p1")).toBe(false);
    expect(s.players.find((p) => p.id === "p3")!.roleId).toBe("werewolf");
    expect(s.announcement!.events).toEqual([
      { t: "killed", playerId: "p2" },
      { t: "died", playerId: "p1" },
    ]);
    expect(living(s).filter((p) => getRole(p.roleId!).team === "werewolf")).toHaveLength(2);
  });

  it("turns a living non-wolf into a werewolf, once", () => {
    let s = infectorGame();
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // wolf eats p2
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" }); // infector converts p3
    s = settleNight(s);
    expect(s.players.find((p) => p.id === "p3")!.roleId).toBe("werewolf");
    expect(s.used["p1"]).toBe(true);
    // Power spent — no convert prompt next night.
    s = reduce(s, { type: "startVote" });
    s = voteAll(s, () => null);
    s = settleVote(s);
    expect(projectView(s, "p1").nightPrompt).toBeNull();
  });

  it("cannot convert an existing werewolf", () => {
    let s = gameWith(["werewolf", "infector", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    expect(projectView(s, "p1").nightPrompt!.targetIds).not.toContain("p0"); // the wolf isn't a target
  });

  it("fizzles (and keeps its power) if the target is eaten the same night", () => {
    let s = infectorGame();
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p3" }); // wolf eats p3
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" }); // infector tries to convert p3
    s = settleNight(s);
    expect(alive(s, "p3")).toBe(false);
    expect(s.players.find((p) => p.id === "p3")!.roleId).toBe("villager"); // not a wolf — stayed dead
    expect(s.used["p1"]).toBeFalsy(); // power preserved
  });

  it("a conversion can complete a werewolf parity win at night's end", () => {
    // 1 wolf + infector + 3 villagers. Eat one, convert one → 3 wolves of 4 alive.
    let s = gameWith(["werewolf", "infector", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // eat p2
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p3" }); // convert p3
    s = settleNight(s);
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("werewolf");
  });

});

describe("wolf-team roles in the pool", () => {
  const players = (n: number): Player[] =>
    Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, roleId: null, alive: true, connected: true, isHost: false }));
  const poolConfig = (pool: string[]): GameConfig => ({
    selection: { mode: "pool", overrides: onlyRoles(pool) },
    revealRoleOnDeath: false,
    nightSummary: "discreet", peacefulFirstNight: false,
  });

  it("can draw the Infector into a wolf slot, always keeping a base Werewolf", () => {
    let infected = 0;
    for (let seed = 0; seed < 40; seed++) {
      const counts = countRoles(dealRoles(players(10), poolConfig(["villager", "infector", "seer", "doctor", "witch", "auraSeer", "hunter", "detective", "prince", "tanner"]), makeRng(seed)));
      expect(counts.werewolf).toBeGreaterThanOrEqual(1);
      expect([2, 3, 4]).toContain((counts.werewolf ?? 0) + (counts.infector ?? 0)); // 2-4 wolf seats at 10 players
      infected += counts.infector ?? 0;
    }
    expect(infected).toBeGreaterThan(0);
  });

  it("never gives a lone wolf the Infector role (the one wolf must be a killer)", () => {
    // 4 players → exactly 1 wolf; it must be a base Werewolf, never the Infector.
    for (let seed = 0; seed < 30; seed++) {
      const counts = countRoles(dealRoles(players(4), poolConfig(["villager", "infector"]), makeRng(seed)));
      expect(counts.infector ?? 0).toBe(0);
      expect(counts.werewolf).toBe(1);
    }
  });

  it("deals the Henchman into a non-wolf seat (wolves still come from the band)", () => {
    let seen = 0;
    for (let seed = 0; seed < 40; seed++) {
      const counts = countRoles(dealRoles(players(10), poolConfig(["villager", "henchman", "seer", "doctor", "witch"]), makeRng(seed)));
      expect([2, 3]).toContain(counts.werewolf);
      seen += counts.henchman ?? 0;
    }
    expect(seen).toBeGreaterThan(0);
  });

  it("rejects pooling the base Werewolf (the dealer adds those)", () => {
    const config = { ...poolConfig(["villager"]), selection: { mode: "pool" as const, overrides: { werewolf: true } } };
    expect(validateConfig(config, 6).length).toBeGreaterThan(0);
  });
});

describe("fabricatedInspect", () => {
  it("is deterministic and yields a plausible exact role", () => {
    expect(fabricatedInspect(5, 2, "abc", "exactRole")).toBe(fabricatedInspect(5, 2, "abc", "exactRole"));
    expect(["villager", "werewolf", "seer", "doctor"]).toContain(fabricatedInspect(5, 2, "abc", "exactRole"));
  });
});
