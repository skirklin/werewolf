import { describe, it, expect } from "vitest";
import type { GameState, Player, GameConfig } from "./types.js";
import { createGame, reduce, nightIdlers } from "./engine.js";
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

/** Everyone with no power tonight taps through their decoy prompt. */
function idleRest(s: GameState): GameState {
  for (const p of nightIdlers(s)) {
    if (s.phase !== "night" || s.night!.idleDone.includes(p.id)) continue;
    const pick = projectView(s, p.id).idlePrompt!.targetIds[0];
    s = act(s, p.id, { type: "nightIdle", targetId: pick });
  }
  return s;
}

/** Cast this ballot the way the table does: one at a time, in voting order. */
function voteInOrder(s: GameState, ballot: Record<string, string | null>): GameState {
  for (const id of s.voteOrder)
    if (s.phase === "dayVote" && !(id in s.votes)) s = act(s, id, { type: "castVote", targetId: ballot[id] ?? null });
  return s;
}

describe("the night waits for results to be read", () => {
  it("doesn't dawn until the Seer dismisses her vision", () => {
    let s = gameWith(["werewolf", "seer", "villager", "villager", "villager"]);
    s = act(s, "p1", { type: "nightChoice", targetId: "p0" });
    s = act(s, "p0", { type: "nightChoice", targetId: "p2" });
    s = idleRest(s);
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
    s = idleRest(s);
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

  it("every night move, by every role, changes nobody's screen but the mover's", () => {
    // Everyone with a night power, wolves included, in one game. Online there
    // is no turn order, so nothing anyone does may show up for anyone else.
    let s = gameWith([
      "werewolf", "werewolf", "infector", "witch", "seer", "auraSeer", "doctor",
      "detective", "troublemaker", "silencer", "drunk", "villager", "villager", "villager",
      "villager", "villager", "villager",
    ]);
    const ids = s.players.map((p) => p.id);
    const move = (id: string): unknown => {
      const p = projectView(s, id).nightPrompt!;
      const [a, b] = p.targetIds;
      switch (p.kind) {
        case "witch": return { type: "witchAction", heal: true, poisonTargetId: a };
        case "swap": return { type: "swapAction", aId: a, bId: b };
        case "detect": return { type: "detectAction", aId: a, bId: b };
        case "raise": return { type: "raiseAction", targetId: null };
        default: return { type: "nightChoice", targetId: a };
      }
    };
    // After each move, every other player's whole view must be byte-for-byte
    // what it was: no prompt appears, vanishes or changes because of it.
    const actors = ids.filter((id) => projectView(s, id).nightPrompt);
    expect(actors.length).toBeGreaterThan(8);
    for (const id of actors) {
      const others = ids.filter((o) => o !== id);
      const before = others.map((o) => JSON.stringify(projectView(s, o)));
      s = act(s, id, move(id));
      if (s.phase !== "night") break;
      expect(others.map((o) => JSON.stringify(projectView(s, o)))).toEqual(before);
    }
  });

  it("every role is offered its move the moment night falls — nobody waits on anyone", () => {
    const s = gameWith(["werewolf", "witch", "seer", "doctor", "detective", "troublemaker", "villager", "villager"]);
    for (const step of s.night!.steps)
      for (const id of step.actorIds) expect(projectView(s, id).nightPrompt?.kind).toBe(step.kind);
  });

  it("a Witch move with the potions left out means 'do nothing'", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager", "villager"], { peacefulFirstNight: true });
    s = idleRest(s); // the wolf sits out a peaceful first night, so it gets a decoy too
    expect(s.phase).toBe("night");
    s = act(s, "p1", { type: "witchAction" });
    expect(s.phase).toBe("dayDiscussion");
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
    s = idleRest(s);
    s = act(s, "p0", { type: "startVote" });
    expect(s.voteOrder).toEqual(["p0", "p2", "p3", "p4"]); // day 1 starts at seat 0
    s = act(s, "p0", { type: "castVote", targetId: "p2" });
    expect(projectView(s, "p3").votes).toEqual({ p0: "p2" });
    s = voteInOrder(s, { p2: "p0", p3: "p0", p4: null });
    // The result is announced first; the host moves everyone on from there.
    expect(s.phase).toBe("verdict");
    expect(projectView(s, "p3").verdict).toMatchObject({ outcome: "lynch", playerId: "p0", next: "gameOver", winner: "village" });
    expect(() => act(s, "p3", { type: "endVerdict" })).toThrow(/host/i);
    s = act(s, "p0", { type: "endVerdict" });
    expect(s.phase).toBe("gameOver");
    expect(projectView(s, "p3").voteHistory).toEqual([
      { round: 1, votes: { p0: "p2", p2: "p0", p3: "p0", p4: null } },
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
    s = idleRest(s);
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

describe("everyone taps something at night", () => {
  it("players with no power get a decoy prompt, and the night waits for them", () => {
    let s = gameWith(["werewolf", "seer", "villager", "villager"]);
    const v = projectView(s, "p2");
    expect(v.nightPrompt).toBeNull();
    expect(v.idlePrompt!.targetIds).toEqual(["p0", "p1", "p3"]);
    expect(projectView(s, "p0").idlePrompt).toBeNull(); // real powers get real prompts
    s = act(s, "p0", { type: "nightChoice", targetId: "p2" });
    s = act(s, "p1", { type: "nightChoice", targetId: "p3" });
    s = act(s, "p1", { type: "nightAck" });
    s = act(s, "p2", { type: "nightIdle", targetId: "p0" });
    expect(s.phase).toBe("night"); // p3 hasn't tapped yet
    expect(projectView(s, "p2").idlePrompt).toBeNull();
    s = act(s, "p3", { type: "nightIdle", targetId: "p0" });
    expect(s.phase).toBe("dayDiscussion");
  });

  it("a decoy pick changes nothing and nobody else can see it", () => {
    let s = gameWith(["werewolf", "villager", "villager", "villager"]);
    const others = ["p0", "p2", "p3"].map((id) => JSON.stringify(projectView(s, id)));
    s = act(s, "p1", { type: "nightIdle", targetId: "p0" });
    expect(["p0", "p2", "p3"].map((id) => JSON.stringify(projectView(s, id)))).toEqual(others);
    expect(() => act(s, "p0", { type: "nightIdle", targetId: "p1" })).toThrow(/real choice/);
  });
});

describe("sequential votes", () => {
  const toDay = (s: GameState) => {
    s = act(s, "p0", { type: "nightChoice", targetId: s.players.at(-1)!.id });
    return act(idleRest(s), "p0", { type: "startVote" });
  };

  it("votes go one at a time, in order, and out-of-turn votes are refused", () => {
    let s = toDay(gameWith(["werewolf", "villager", "villager", "villager", "villager", "villager"]));
    expect(projectView(s, "p3").voteTurn).toBe("p0");
    expect(() => act(s, "p3", { type: "castVote", targetId: "p0" })).toThrow(/turn/);
    s = act(s, "p0", { type: "castVote", targetId: "p3" });
    expect(projectView(s, "p4").voteTurn).toBe("p1");
    expect(() => act(s, "p0", { type: "castVote", targetId: "p4" })).toThrow(/already voted/);
  });

  it("the first voter moves one seat round the table each day", () => {
    const s = gameWith(["werewolf", "villager", "villager", "villager", "villager", "villager"]);
    expect(voteOrderOn({ ...s, round: 1 })[0]).toBe("p0");
    expect(voteOrderOn({ ...s, round: 2 })[0]).toBe("p1");
    expect(voteOrderOn({ ...s, round: 7 })[0]).toBe("p0");
    // Dead and silenced players are left out, without breaking the rotation.
    const fewer = { ...s, round: 2, silenced: ["p1"], players: s.players.map((p) => (p.id === "p2" ? { ...p, alive: false } : p)) };
    expect(voteOrderOn(fewer)).toEqual(["p3", "p4", "p5", "p0"]);
  });

  it("the host can skip a voter who has wandered off (counts as an abstain)", () => {
    let s = toDay(gameWith(["werewolf", "villager", "villager", "villager", "villager", "villager"]));
    expect(() => act(s, "p1", { type: "skipVoter" })).toThrow(/host/i);
    s = act(s, "p0", { type: "skipVoter" });
    expect(s.votes).toEqual({ p0: null });
    expect(projectView(s, "p2").voteTurn).toBe("p1");
  });
});

function voteOrderOn(s: GameState): string[] {
  return reduce({ ...s, phase: "dayDiscussion" }, { type: "startVote" }).voteOrder;
}

describe("the vote's result is announced before the game moves on", () => {
  const toVote = (roles: string[]) => {
    let s = gameWith(roles);
    s = act(s, "p0", { type: "nightChoice", targetId: s.players.at(-1)!.id });
    return act(idleRest(s), "p0", { type: "startVote" });
  };

  it("a lynch that doesn't end the game says so, then night falls", () => {
    let s = toVote(["werewolf", "villager", "villager", "villager", "villager", "villager"]);
    s = voteInOrder(s, { p0: "p1", p1: "p2", p2: "p1", p3: "p1", p4: "p1" });
    expect(s.verdict).toMatchObject({ outcome: "lynch", playerId: "p1", next: "night", winner: null });
    expect(s.players.find((p) => p.id === "p1")!.alive).toBe(false); // the result is already real
    s = act(s, "p0", { type: "endVerdict" });
    expect(s.phase).toBe("night");
    expect(s.verdict).toBeNull();
  });

  it("a tie and an empty ballot are announced too", () => {
    let s = toVote(["werewolf", "villager", "villager", "villager", "villager", "villager"]);
    s = voteInOrder(s, { p0: "p1", p1: "p0" });
    expect(s.verdict).toMatchObject({ outcome: "tie", playerId: null, next: "night" });
    let e = toVote(["werewolf", "villager", "villager", "villager", "villager", "villager"]);
    e = voteInOrder(e, {});
    expect(e.verdict).toMatchObject({ outcome: "noVotes", next: "night" });
  });

  it("a lynched Tanner's win is announced, then the game ends", () => {
    let s = toVote(["werewolf", "tanner", "villager", "villager", "villager", "villager"]);
    s = voteInOrder(s, { p0: "p1", p2: "p1", p3: "p1", p4: "p1" });
    expect(s.verdict).toMatchObject({ next: "gameOver", winner: "solo", soloWinnerId: "p1" });
    s = act(s, "p0", { type: "endVerdict" });
    expect(s.phase).toBe("gameOver");
    expect(s.soloWinnerId).toBe("p1");
  });

  it("a lynched Hunter's shot comes after the announcement", () => {
    let s = toVote(["werewolf", "hunter", "villager", "villager", "villager", "villager"]);
    s = voteInOrder(s, { p0: "p1", p2: "p1", p3: "p1", p4: "p1" });
    expect(s.verdict).toMatchObject({ playerId: "p1", next: "hunterShot" });
    s = act(s, "p0", { type: "endVerdict" });
    expect(s.phase).toBe("hunterShot");
  });
});

describe("one-time powers can wait for the right night", () => {
  it("the Troublemaker swaps once a game, whenever they like", () => {
    let s = gameWith(["werewolf", "troublemaker", "villager", "villager", "villager", "villager"], { peacefulFirstNight: true });
    expect(projectView(s, "p1").nightPrompt).toMatchObject({ kind: "swap", canSkip: true });
    s = act(s, "p1", { type: "nightSkip" }); // night 1: save it
    s = idleRest(s);
    expect(s.phase).toBe("dayDiscussion");
    expect(s.swapUsed["p1"]).toBeFalsy();
    s = act(s, "p0", { type: "startVote" });
    s = voteInOrder(s, {});
    s = act(s, "p0", { type: "endVerdict" });
    // Night 2: use it.
    expect(projectView(s, "p1").nightPrompt?.kind).toBe("swap");
    s = act(s, "p1", { type: "swapAction", aId: "p2", bId: "p3" });
    s = act(s, "p0", { type: "nightChoice", targetId: "p5" });
    s = idleRest(s);
    expect(s.swapUsed["p1"]).toBe(true);
    s = act(s, "p0", { type: "startVote" });
    s = voteInOrder(s, {});
    s = act(s, "p0", { type: "endVerdict" });
    // Night 3: spent — a decoy, like anyone else with nothing to do.
    expect(projectView(s, "p1").nightPrompt).toBeNull();
    expect(projectView(s, "p1").idlePrompt).not.toBeNull();
  });

  it("the Infector can hold the infection, and only that power can be held", () => {
    let s = gameWith(["werewolf", "infector", "villager", "villager", "villager", "villager", "villager"]);
    expect(projectView(s, "p1").nightPrompt).toMatchObject({ kind: "convert", canSkip: true });
    expect(projectView(s, "p0").nightPrompt).toMatchObject({ kind: "kill", canSkip: false });
    expect(() => act(s, "p0", { type: "nightSkip" })).toThrow(/can't be saved/);
    s = act(s, "p1", { type: "nightSkip" });
    s = act(s, "p0", { type: "nightChoice", targetId: "p6" });
    s = idleRest(s);
    expect(s.phase).toBe("dayDiscussion");
    expect(s.convertUsed["p1"]).toBeFalsy(); // not spent
    expect(s.players.filter((p) => p.roleId === "werewolf")).toHaveLength(1);
  });
});

describe("the Witch's heal", () => {
  it("saves whoever the wolves attack, without her learning who", () => {
    let s = gameWith(["werewolf", "witch", "villager", "villager", "villager"]);
    expect(projectView(s, "p1").nightPrompt!.witch).toEqual({ healAvailable: true, poisonAvailable: true });
    s = act(s, "p1", { type: "witchAction", heal: true, poisonTargetId: null });
    s = act(s, "p0", { type: "nightChoice", targetId: "p3" });
    s = idleRest(s);
    expect(s.players.find((p) => p.id === "p3")!.alive).toBe(true);
    expect(s.witchPotions["p1"].heal).toBe(false);
  });
});
