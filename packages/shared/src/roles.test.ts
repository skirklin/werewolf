import { describe, it, expect } from "vitest";
import type { GameState, Player, GameConfig } from "./types.js";
import { reduce, createGame, checkWinner, living, fabricatedReveal } from "./engine.js";
import { projectView } from "./views.js";

const exact = (): GameConfig => ({
  selection: { mode: "exact", roleCounts: {} },
  revealRoleOnDeath: true,
  nightSummary: "discreet",
});

function gameWith(roles: string[]): GameState {
  const players: Player[] = roles.map((roleId, i) => ({
    id: `p${i}`, name: `P${i}`, roleId, alive: true, connected: true, isHost: i === 0,
  }));
  // Mirror startGame's potion init, since this helper bypasses startGame.
  const witchPotions: GameState["witchPotions"] = {};
  for (const p of players) if (p.roleId === "witch") witchPotions[p.id] = { heal: true, poison: true };
  return { ...createGame("TEST", 12345), phase: "roleReveal", players, witchPotions, config: exact() };
}

const alive = (s: GameState, id: string) => living(s).some((p) => p.id === id);

// ---------------------------------------------------------------------------
// Hunter
// ---------------------------------------------------------------------------
describe("Hunter", () => {
  it("shoots after being killed by wolves, then the day begins", () => {
    let s = gameWith(["werewolf", "hunter", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" }); // wolf eats hunter
    s = reduce(s, { type: "endNight" });
    expect(s.phase).toBe("hunterShot");
    expect(s.pendingShots).toEqual(["p1"]);
    expect(projectView(s, "p1").shootPrompt).not.toBeNull();

    s = reduce(s, { type: "shoot", hunterId: "p1", targetId: "p2" });
    expect(alive(s, "p2")).toBe(false);
    expect(s.phase).toBe("dayDiscussion");
    expect(s.pendingShots).toEqual([]);
    expect(s.afterReckoning).toBeNull();
  });

  it("shoots after being lynched, then the next night begins", () => {
    let s = gameWith(["werewolf", "hunter", "villager", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "endNight" });
    s = reduce(s, { type: "startVote" });
    for (const p of living(s)) if (p.id !== "p1") s = reduce(s, { type: "castVote", voterId: p.id, targetId: "p1" }); // lynch hunter
    s = reduce(s, { type: "resolveVote" });
    expect(s.phase).toBe("hunterShot");
    s = reduce(s, { type: "shoot", hunterId: "p1", targetId: "p3" });
    expect(s.phase).toBe("night"); // continues to a new night
    expect(s.round).toBe(2);
  });

  it("chains when a Hunter shoots another Hunter", () => {
    let s = gameWith(["werewolf", "hunter", "hunter", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" }); // wolf eats hunter p1
    s = reduce(s, { type: "endNight" });
    s = reduce(s, { type: "shoot", hunterId: "p1", targetId: "p2" }); // p1 shoots hunter p2
    expect(s.phase).toBe("hunterShot"); // p2 now owes a shot
    expect(s.pendingShots).toEqual(["p2"]);
    s = reduce(s, { type: "shoot", hunterId: "p2", targetId: "p3" }); // p2 shoots villager
    expect([alive(s, "p1"), alive(s, "p2"), alive(s, "p3")]).toEqual([false, false, false]);
    expect(s.phase).toBe("dayDiscussion");
  });

  it("does not shoot if protected from the wolves", () => {
    let s = gameWith(["werewolf", "hunter", "doctor", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" }); // wolf targets hunter
    s = reduce(s, { type: "nightChoice", actorId: "p2", targetId: "p1" }); // doctor saves hunter
    s = reduce(s, { type: "endNight" });
    expect(s.phase).toBe("dayDiscussion");
    expect(alive(s, "p1")).toBe(true);
  });

  it("a dying Hunter can end the game by shooting the last wolf", () => {
    let s = gameWith(["werewolf", "hunter", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "endNight" });
    s = reduce(s, { type: "startVote" });
    for (const p of living(s)) if (p.id !== "p1") s = reduce(s, { type: "castVote", voterId: p.id, targetId: "p1" }); // lynch hunter
    s = reduce(s, { type: "resolveVote" });
    s = reduce(s, { type: "shoot", hunterId: "p1", targetId: "p0" }); // shoot the wolf
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("village");
  });

  it("rejects illegal shots", () => {
    let s = gameWith(["werewolf", "hunter", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" });
    expect(() => reduce(s, { type: "shoot", hunterId: "p1", targetId: "p1" })).toThrow(); // self
    expect(() => reduce(s, { type: "shoot", hunterId: "p2", targetId: "p3" })).toThrow(); // not the shooter
    expect(() => reduce(s, { type: "shoot", hunterId: "p1", targetId: "p1" })).toThrow(); // p1 is dead
  });

  it("can have its shot skipped (host recovery when the Hunter is away)", () => {
    let s = gameWith(["werewolf", "hunter", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" });
    expect(s.phase).toBe("hunterShot");
    const livingBefore = living(s).length;
    s = reduce(s, { type: "skipShot" });
    expect(s.phase).toBe("dayDiscussion"); // no extra death
    expect(living(s).length).toBe(livingBefore);
    expect(s.pendingShots).toEqual([]);
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
    s = reduce(s, { type: "endNight" });
    s = reduce(s, { type: "startVote" });
    for (const p of living(s)) if (p.id !== "p1") s = reduce(s, { type: "castVote", voterId: p.id, targetId: "p1" });
    s = reduce(s, { type: "resolveVote" });
    expect(s.phase).toBe("gameOver");
    expect(s.winner).toBe("solo");
    expect(s.soloWinnerId).toBe("p1");
  });

  it("surfaces the solo winner in the projected view", () => {
    let s = gameWith(["werewolf", "tanner", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "endNight" });
    s = reduce(s, { type: "startVote" });
    for (const p of living(s)) if (p.id !== "p1") s = reduce(s, { type: "castVote", voterId: p.id, targetId: "p1" });
    s = reduce(s, { type: "castVote", voterId: "p1", targetId: "p3" });
    s = reduce(s, { type: "resolveVote" });
    const v = projectView(s, "p3");
    expect(v.winner).toBe("solo");
    expect(v.soloWinnerId).toBe("p1");
    expect(v.players.find((p) => p.id === "p1")!.roleId).toBe("tanner"); // revealed at end
  });

  it("does not win if merely killed at night", () => {
    let s = gameWith(["werewolf", "tanner", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" }); // wolves eat the tanner
    s = reduce(s, { type: "endNight" });
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
describe("Village Drunk", () => {
  it("believes it is the Seer and never sees its true role mid-game", () => {
    const s = gameWith(["werewolf", "drunk", "villager"]);
    const v = projectView(s, "p1");
    expect(v.you.roleId).toBe("seer"); // disguised
    expect(v.players.find((p) => p.id === "p1")!.roleId).toBe("seer"); // consistent in the list
  });

  it("shows a Seer night prompt but returns a fabricated result", () => {
    let s = gameWith(["werewolf", "drunk", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    expect(projectView(s, "p1").nightPrompt!.roleId).toBe("seer");
    s = reduce(s, { type: "nightChoice", actorId: "p1", targetId: "p0" }); // "inspect" the wolf
    const result = projectView(s, "p1").myInspects.at(-1)!;
    // A fabricated *exact role* (matching the Seer disguise), not the wolf's truth.
    expect(result.reveal).toBe(fabricatedReveal(s.seed, s.round, "p0"));
    expect(["villager", "werewolf", "seer", "doctor"]).toContain(result.reveal);
  });

  it("is on the village team for win checks", () => {
    expect(checkWinner(gameWith(["werewolf", "drunk"]))).toBe("werewolf"); // drunk counts as town (parity)
    const noWolves = (() => {
      const g = gameWith(["werewolf", "drunk", "villager"]);
      return { ...g, players: g.players.map((p) => (p.id === "p0" ? { ...p, alive: false } : p)) };
    })();
    expect(checkWinner(noWolves)).toBe("village");
  });

  it("learns the truth once the game is over", () => {
    let s = gameWith(["werewolf", "drunk", "villager"]);
    s = { ...s, phase: "gameOver", winner: "village" };
    expect(projectView(s, "p1").you.roleId).toBe("drunk");
  });
});

// ---------------------------------------------------------------------------
// Witch
// ---------------------------------------------------------------------------
describe("Witch", () => {
  it("must wait for the wolves before acting", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    expect(() =>
      reduce(s, { type: "witchAction", actorId: "p1", save: true, poisonTargetId: null })
    ).toThrow(/wolves/i);
    // No prompt until the kill is locked in.
    expect(projectView(s, "p1").nightPrompt).toBeNull();
  });

  it("heals the wolves' victim, spending the heal potion", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // wolf targets p2
    expect(projectView(s, "p1").nightPrompt!.witch!.victimId).toBe("p2"); // Witch sees the victim
    s = reduce(s, { type: "witchAction", actorId: "p1", save: true, poisonTargetId: null });
    s = reduce(s, { type: "endNight" });
    expect(alive(s, "p2")).toBe(true);
    expect(s.witchPotions["p1"]).toEqual({ heal: false, poison: true });
  });

  it("poisons a chosen player, spending the poison potion", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "witchAction", actorId: "p1", save: false, poisonTargetId: "p3" });
    s = reduce(s, { type: "endNight" });
    expect(alive(s, "p2")).toBe(false); // wolf kill
    expect(alive(s, "p3")).toBe(false); // poisoned
    expect(s.witchPotions["p1"]).toEqual({ heal: true, poison: false });
    expect(s.log.some((e) => e.type === "poisoned" && e.playerId === "p3")).toBe(true);
  });

  it("each potion is one-time — a spent potion can't be used again", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    s = reduce(s, { type: "witchAction", actorId: "p1", save: true, poisonTargetId: null });
    s = reduce(s, { type: "endNight" }); // heal spent
    // Day, then a new night.
    s = reduce(s, { type: "startVote" });
    for (const p of living(s)) if (p.id !== "p3") s = reduce(s, { type: "castVote", voterId: p.id, targetId: "p3" });
    s = reduce(s, { type: "resolveVote" });
    expect(s.phase).toBe("night");
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p4" });
    expect(projectView(s, "p1").nightPrompt!.witch!.healAvailable).toBe(false);
    expect(() =>
      reduce(s, { type: "witchAction", actorId: "p1", save: true, poisonTargetId: null })
    ).toThrow();
  });

  it("cannot poison itself", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" });
    expect(() =>
      reduce(s, { type: "witchAction", actorId: "p1", save: false, poisonTargetId: "p1" })
    ).toThrow();
  });

  it("healing AND poisoning the same victim still kills them, and logs a death", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // wolves target p2
    s = reduce(s, { type: "witchAction", actorId: "p1", save: true, poisonTargetId: "p2" }); // heal + poison p2
    s = reduce(s, { type: "endNight" });
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
    s = reduce(s, { type: "endNight" });
    expect(s.players.find((p) => p.id === "p0")!.roleId).toBe("villager"); // former wolf is now a villager
    expect(s.players.find((p) => p.id === "p3")!.roleId).toBe("werewolf"); // the villager is now the wolf
  });

  it("only swaps living players", () => {
    let s = gameWith(["werewolf", "troublemaker", "villager", "villager"]);
    s = reduce(s, { type: "startNight" });
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p2" }); // p2 will die
    s = reduce(s, { type: "swapAction", actorId: "p1", aId: "p2", bId: "p3" }); // p2 dies this night
    s = reduce(s, { type: "endNight" });
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
    s = reduce(s, { type: "witchAction", actorId: "p2", save: false, poisonTargetId: null });
    s = reduce(s, { type: "endNight" });
    // p4 is now the Witch and holds the potions; p2 no longer does.
    expect(s.players.find((p) => p.id === "p4")!.roleId).toBe("witch");
    expect(s.witchPotions["p4"]).toEqual({ heal: true, poison: true });
    expect(s.witchPotions["p2"]).toBeUndefined();
  });
});

describe("fabricatedReveal", () => {
  it("is deterministic and yields a plausible exact role", () => {
    expect(fabricatedReveal(5, 2, "abc")).toBe(fabricatedReveal(5, 2, "abc"));
    expect(["villager", "werewolf", "seer", "doctor"]).toContain(fabricatedReveal(5, 2, "abc"));
  });
});
