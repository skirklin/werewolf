import { describe, it, expect } from "vitest";
import type { GameState, Player, GameConfig } from "./types.js";
import { createGame, reduce } from "./engine.js";
import { projectView } from "./views.js";
import { possibleRoles } from "./setup.js";
import { werewolfModule } from "./module.js";

const config = (over: Partial<GameConfig> = {}): GameConfig => ({
  selection: { mode: "exact", roleCounts: {} },
  revealRoleOnDeath: false,
  nightSummary: "discreet",
  peacefulFirstNight: false,
  ...over,
});

function gameWith(roles: string[], over: Partial<GameConfig> = {}): GameState {
  const players: Player[] = roles.map((roleId, i) => ({
    id: `p${i}`, name: `P${i}`, roleId, alive: true, connected: true, isHost: i === 0,
  }));
  const witchPotions: GameState["witchPotions"] = {};
  for (const p of players) if (p.roleId === "witch") witchPotions[p.id] = { heal: true, poison: true };
  const s = { ...createGame("TEST", 7), phase: "roleReveal" as const, players, witchPotions, config: config(over) };
  return reduce(s, { type: "startNight" });
}

/** Play a move the way the server does (auto-advancing phases). */
const act = (s: GameState, seat: string, action: unknown) =>
  werewolfModule.act(s, seat, action, { isHost: seat === "p0" });

describe("the night waits for results to be read", () => {
  it("doesn't dawn until the Seer dismisses her vision", () => {
    let s = gameWith(["werewolf", "seer", "villager", "villager", "villager"]);
    s = act(s, "p1", { type: "nightChoice", targetId: "p0" });
    s = act(s, "p0", { type: "nightChoice", targetId: "p2" });
    expect(s.phase).toBe("night"); // everyone acted, but the vision is unread
    const seer = projectView(s, "p1");
    expect(seer.nightAwaitingAck).toBe(true);
    expect(seer.myInspects.at(-1)).toMatchObject({ targetId: "p0", reveal: "werewolf" });
    expect(projectView(s, "p0").nightAwaitingAck).toBe(false);

    s = act(s, "p1", { type: "nightAck" });
    expect(s.phase).toBe("dayDiscussion");
  });

  it("waits for the Detective too, and only acks someone with a result", () => {
    let s = gameWith(["werewolf", "detective", "villager", "villager", "villager"]);
    expect(() => act(s, "p2", { type: "nightAck" })).toThrow();
    s = act(s, "p1", { type: "detectAction", aId: "p0", bId: "p2" });
    s = act(s, "p0", { type: "nightChoice", targetId: "p3" });
    expect(s.phase).toBe("night");
    s = act(s, "p1", { type: "nightAck" });
    expect(s.phase).toBe("dayDiscussion");
  });

  it("the host can still force the night closed if someone wanders off", () => {
    let s = gameWith(["werewolf", "seer", "villager", "villager", "villager"]);
    s = act(s, "p1", { type: "nightChoice", targetId: "p2" });
    s = act(s, "p0", { type: "nightChoice", targetId: "p3" });
    s = act(s, "p0", { type: "endNight" });
    expect(s.phase).toBe("dayDiscussion");
  });
});

describe("no cross-player information at night", () => {
  it("a wolf never sees what a packmate picked", () => {
    let s = gameWith(["werewolf", "werewolf", "villager", "villager", "villager", "villager", "villager"]);
    const before = projectView(s, "p1").nightPrompt;
    s = act(s, "p0", { type: "nightChoice", targetId: "p3" });
    expect(projectView(s, "p1").nightPrompt).toEqual(before);
    expect(JSON.stringify(projectView(s, "p1"))).not.toMatch(/groupChoices/);
  });

  it("nobody's view changes when someone else acts at night", () => {
    let s = gameWith(["werewolf", "witch", "seer", "doctor", "villager", "villager"]);
    const views = () => ["p1", "p2", "p3", "p4"].map((id) => JSON.stringify(projectView(s, id)));
    const before = views();
    s = act(s, "p0", { type: "nightChoice", targetId: "p4" });
    expect(views()).toEqual(before);
  });
});

describe("open votes", () => {
  it("shows who voted for whom, live and after the vote", () => {
    let s = gameWith(["werewolf", "villager", "villager", "villager", "villager"]);
    s = act(s, "p0", { type: "nightChoice", targetId: "p1" });
    s = act(s, "p0", { type: "startVote" });
    s = act(s, "p2", { type: "castVote", targetId: "p0" });
    expect(projectView(s, "p3").votes).toEqual({ p2: "p0" });
    s = act(s, "p3", { type: "castVote", targetId: "p0" });
    s = act(s, "p4", { type: "castVote", targetId: null });
    s = act(s, "p0", { type: "castVote", targetId: "p2" });
    expect(s.phase).toBe("gameOver");
    expect(projectView(s, "p3").voteHistory).toEqual([
      { round: 1, votes: { p2: "p0", p3: "p0", p4: null, p0: "p2" } },
    ]);
  });
});

describe("chat switch", () => {
  it("refuses talk when the game has chat off", () => {
    let s = gameWith(["werewolf", "villager", "villager", "villager"], { chat: false });
    s = act(s, "p0", { type: "nightChoice", targetId: "p1" });
    expect(() => act(s, "p2", { type: "say", text: "hi" })).toThrow(/chat is off/i);
  });

  it("allows it by default (older configs have no switch)", () => {
    let s = gameWith(["werewolf", "villager", "villager", "villager"]);
    s = act(s, "p0", { type: "nightChoice", targetId: "p1" });
    s = act(s, "p2", { type: "say", text: "hi" });
    expect(s.chat).toHaveLength(1);
  });
});

describe("possible roles", () => {
  it("lists the configured roles without counts, adding Villagers that fill", () => {
    const c = config({ selection: { mode: "exact", roleCounts: { werewolf: 2, seer: 1, witch: 0 } } });
    expect(possibleRoles(c, 6)).toEqual(["werewolf", "seer", "villager"]);
    expect(possibleRoles(c, 3)).toEqual(["werewolf", "seer"]);
  });

  it("lists the whole pool in pool mode, even roles that may not be dealt", () => {
    const c = config({ selection: { mode: "pool", pool: ["villager", "seer", "doctor", "tanner"], werewolfRatio: 0.26 } });
    expect(possibleRoles(c, 4)).toEqual(["werewolf", "villager", "seer", "doctor", "tanner"]);
  });

  it("is in every player's view", () => {
    const s = gameWith(["werewolf", "seer", "villager", "villager"], {
      selection: { mode: "exact", roleCounts: { werewolf: 1, seer: 1 } },
    });
    expect(projectView(s, "p2").possibleRoles).toEqual(["werewolf", "seer", "villager"]);
  });
});
