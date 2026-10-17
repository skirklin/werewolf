import { describe, it, expect } from "vitest";
import { generateScenario } from "./generate.js";
import { createGame, projectView, reduce, whoMustAct, GameError, HAND_LIMIT, type GameState } from "./game.js";
import { leadKey } from "./clues.js";
import { simulateGame } from "./simulate.js";
import type { Answer, Lead } from "./types.js";

const scenario = generateScenario({ seed: 11, players: 5 });
const ids = ["a", "b", "c", "d", "e"];
const seats = ids.map((id) => ({ id, name: id.toUpperCase() }));
const fresh = () => createGame(scenario, seats, {});
const killer = scenario.killer;
const innocents = [0, 1, 2, 3, 4].filter((i) => i !== killer);

/** Play turns where everyone examines the body and passes, until it's `seat`'s turn. */
function until(g: GameState, seat: number): GameState {
  for (let guard = 0; guard < 50; guard++) {
    if (g.phase.kind === "turn" && g.phase.active === seat && g.phase.step === "investigate") return g;
    g = quietTurn(g);
  }
  throw new Error("never reached that seat");
}

/** The active player follows a lead nobody cares about, then passes. */
function quietTurn(g: GameState, lead: Lead = { kind: "search", room: 0 }): GameState {
  const p = g.phase;
  if (p.kind !== "turn") throw new Error(`not a turn: ${p.kind}`);
  const who = ids[p.active];
  g = reduce(g, who, { type: "investigate", lead: leadKey(lead) });
  g = reduce(g, who, { type: "pass" });
  // Over the limit: put the newest card on the record.
  if (g.phase.kind === "trim") g = reduce(g, who, { type: "testify", card: g.players[p.active].hand.at(-1)! });
  return g;
}

/** Play out the night quietly, up to dawn. */
function toDawn(g: GameState): GameState {
  while (g.phase.kind === "turn") g = quietTurn(g);
  return g;
}

describe("a turn", () => {
  it("is investigate, then share", () => {
    let g = until(fresh(), 0);
    expect(() => reduce(g, "a", { type: "pass" })).toThrow(GameError);
    expect(() => reduce(g, "b", { type: "investigate", lead: "body" })).toThrow(GameError);
    g = reduce(g, "a", { type: "investigate", lead: "body" });
    expect(g.phase).toEqual({ kind: "turn", active: 0, step: "share" });
    expect(() => reduce(g, "a", { type: "investigate", lead: "body" })).toThrow(GameError);
    g = reduce(g, "a", { type: "pass" });
    expect(g.phase).toMatchObject({ kind: "turn", active: 1, step: "investigate" });
  });

  it("draws a lead's top card into your hand, privately, with its origin", () => {
    const g0 = fresh();
    const top = g0.stacks.body[0];
    const g = reduce(g0, "a", { type: "investigate", lead: "body" });
    expect(g.players[0].hand).toContain(top);
    expect(g.players[0].findings).toEqual([{ lead: { kind: "body" }, round: 1, clue: top, more: true }]);
    expect(g.origins[top]).toEqual({ via: "lead", lead: { kind: "body" }, by: "a", round: 1 });
    expect(g.stacks.body).not.toContain(top);
    // The table sees that you looked, not what you found.
    expect(g.log.at(-1)).toEqual({ t: "investigate", who: "a", lead: { kind: "body" } });
    expect(projectView(g, "b").you.known.map((c) => c.id)).not.toContain(top);
  });

  it("finds nothing once a lead runs dry", () => {
    let g = fresh();
    const key = Object.keys(g.stacks).find((k) => g.stacks[k].length === 0) ?? "staff:99";
    // Fall back to emptying a lead by hand if every lead started with something.
    if (key === "staff:99") g.stacks["search:0"] = [];
    const lead = key === "staff:99" ? "search:0" : key;
    g = reduce(g, "a", { type: "investigate", lead });
    expect(g.players[0].findings.at(-1)!.clue).toBeNull();
  });

  it("refuses leads that don't exist", () => {
    expect(() => reduce(fresh(), "a", { type: "investigate", lead: "body2" })).toThrow(GameError);
    expect(() => reduce(fresh(), "a", { type: "investigate", lead: "attic" })).toThrow(GameError);
  });
});

describe("sharing", () => {
  it("testifying puts a card on the record for everyone", () => {
    let g = reduce(fresh(), "a", { type: "investigate", lead: "body" });
    const card = g.players[0].hand[0];
    g = reduce(g, "a", { type: "testify", card });
    expect(g.players[0].hand).not.toContain(card);
    expect(g.record).toEqual([{ clue: card, by: "a", round: 1 }]);
    for (const p of g.players) expect(p.known).toContain(card);
  });

  it("conferring shows one card each way, and nobody else sees which", () => {
    let g = reduce(fresh(), "a", { type: "investigate", lead: "body" });
    const mine = g.players[0].hand[0];
    g = reduce(g, "a", { type: "confer", with: "b", card: mine });
    expect(whoMustAct(g)).toEqual([1]);
    expect(projectView(g, "c").phase).toMatchObject({ kind: "confer", card: -1 });
    expect(projectView(g, "b").shownYou).toBe(mine);
    const theirs = g.players[1].hand[0];
    g = reduce(g, "b", { type: "show", card: theirs });
    expect(g.players[0].known).toContain(theirs);
    expect(g.players[1].known).toContain(mine);
    // Both keep their cards.
    expect(g.players[0].hand).toContain(mine);
    expect(g.players[1].hand).toContain(theirs);
    expect(g.players[2].known).not.toContain(mine);
    expect(g.log.at(-1)).toEqual({ t: "confer", who: "a", with: "b" });
  });

  it("makes you testify or burn when you're over the hand limit", () => {
    let g = fresh();
    g.players[0].hand = [...g.players[0].hand, ...g.stacks["search:1"]].slice(0, HAND_LIMIT);
    g = reduce(g, "a", { type: "investigate", lead: "body" });
    g = reduce(g, "a", { type: "pass" });
    expect(g.phase).toEqual({ kind: "trim", active: 0 });
    const card = g.players[0].hand[0];
    g = reduce(g, "a", { type: "burn", card });
    expect(g.players[0].hand).toHaveLength(HAND_LIMIT);
    expect(g.log.at(-1)).toEqual({ t: "burn", who: "a" });
    expect(g.phase).toMatchObject({ kind: "turn", active: 1 });
  });
});

describe("the killer's tools", () => {
  it("only the guilty can tamper", () => {
    const g = until(fresh(), innocents[0]);
    expect(() =>
      reduce(g, ids[innocents[0]], { type: "investigate", lead: "body", tamper: { how: "bury" } })
    ).toThrow(GameError);
  });

  it("a planted card reads like any other to whoever draws it", () => {
    let g = until(fresh(), killer);
    const f = scenario.forgeries.killer[0];
    const k = ids[killer];
    expect(() =>
      reduce(g, k, { type: "investigate", lead: "staff:999", tamper: { how: "plant", clue: f.clue } })
    ).toThrow(GameError);
    g = reduce(g, k, { type: "investigate", lead: leadKey(f.lead), tamper: { how: "plant", clue: f.clue } });
    expect(g.stacks[leadKey(f.lead)][0]).toBe(f.clue);
    expect(g.players[killer].hand).not.toContain(f.clue);
    expect(g.log.at(-1)).toEqual({ t: "investigate", who: k, lead: f.lead });
    g = reduce(g, k, { type: "pass" });
    const next = (g.phase as { active: number }).active;
    g = reduce(g, ids[next], { type: "investigate", lead: leadKey(f.lead) });
    expect(g.players[next].hand).toContain(f.clue);
    expect(g.origins[f.clue]).toMatchObject({ via: "lead", by: ids[next] });
    // Nobody can tell from the view that it's forged; the reveal says so at the end.
    const view = projectView(g, ids[next]);
    expect(view.reveal).toBeNull();
    expect(JSON.stringify(view)).not.toContain("forged");
  });

  it("burying sends the top card to the bottom", () => {
    let g = until(fresh(), killer);
    g.stacks.body = [...g.stacks.body, ...g.stacks["search:0"]];
    const [top, ...rest] = g.stacks.body;
    g = reduce(g, ids[killer], { type: "investigate", lead: "body", tamper: { how: "bury" } });
    expect(g.stacks.body).toEqual([...rest, top]);
    expect(g.tampers.at(-1)).toMatchObject({ how: "bury", by: ids[killer] });
  });

  it("striking again kills at the end of the round, and the victim's hand goes public", () => {
    let g = until(fresh(), killer);
    const victim = innocents[0];
    expect(() => reduce(g, ids[victim], { type: "strike", target: ids[killer] })).toThrow(GameError);
    g = reduce(g, ids[killer], { type: "strike", target: ids[victim] });
    expect(g.players[victim].alive).toBe(true);
    expect(() => reduce(g, ids[killer], { type: "strike", target: ids[victim] })).toThrow(GameError);
    const hand = [...g.players[victim].hand];
    while (g.round === 1) g = quietTurn(g);
    expect(g.players[victim].alive).toBe(false);
    expect(g.log).toContainEqual({ t: "death", who: ids[victim], round: 1 });
    for (const id of hand) expect(g.record.map((r) => r.clue)).toContain(id);
    expect(g.leads).toContainEqual({ kind: "body2" });
    expect(g.stacks.body2).toEqual(scenario.secondBody);
    // The dead skip their turns.
    for (let i = 0; i < 8 && g.phase.kind === "turn"; i++) {
      expect((g.phase as { active: number }).active).not.toBe(victim);
      g = quietTurn(g);
    }
  });
});

describe("an inquest", () => {
  const truth = scenario.secret.answer;
  const wrong: Answer = { ...truth, agent: innocents[0] };

  it("ends the game when a majority says yes", () => {
    let g = reduce(fresh(), "a", { type: "inquest", answer: truth });
    expect(whoMustAct(g)).toHaveLength(5);
    for (const id of ids.slice(0, 3)) g = reduce(g, id, { type: "vote", value: 1 });
    for (const id of ids.slice(3)) g = reduce(g, id, { type: "vote", value: 0 });
    expect(g.phase).toMatchObject({ kind: "over", result: "caught", by: "inquest" });
    expect((g.phase as { winners: string[] }).winners).not.toContain(ids[killer]);
    expect(projectView(g, "a").reveal?.secret.answer).toEqual(truth);
  });

  it("goes against the innocents when the accusation that stands is wrong", () => {
    let g = reduce(fresh(), "a", { type: "inquest", answer: wrong });
    for (const id of ids) g = reduce(g, id, { type: "vote", value: 1 });
    expect(g.phase).toMatchObject({ kind: "over", result: "wrong", winners: [ids[killer]] });
  });

  it("carries on when it fails, and the caller can't call another", () => {
    let g = reduce(fresh(), "a", { type: "inquest", answer: wrong });
    for (const id of ids) g = reduce(g, id, { type: "vote", value: id === "a" ? 1 : 0 });
    expect(g.log.at(-1)).toEqual({ t: "inquestFailed", who: "a", yes: 1, no: 4 });
    expect(g.phase).toMatchObject({ kind: "turn", active: 1 });
    g = until(g, 0);
    expect(() => reduce(g, "a", { type: "inquest", answer: truth })).toThrow(GameError);
  });
});

describe("dawn", () => {
  it("comes after three rounds, and votes who, then with what, then where", () => {
    let g = toDawn(fresh());
    expect(g.round).toBe(3);
    expect(g.turnsTaken).toBe(15);
    expect(g.phase).toMatchObject({ kind: "vote", part: "agent", revote: false });
    const truth = scenario.secret.answer;
    for (const part of ["agent", "device", "room"] as const) {
      expect(g.phase).toMatchObject({ kind: "vote", part });
      for (const id of ids) g = reduce(g, id, { type: "vote", value: truth[part] });
    }
    expect(g.phase).toMatchObject({ kind: "over", result: "caught", by: "dawn", accusation: truth });
  });

  it("revotes a tie among the tied, and the inspector settles a second tie", () => {
    let g = toDawn(fresh());
    const [x, y] = [0, 1];
    const split = (g: GameState) =>
      ids.slice(0, 4).reduce((s, id, i) => reduce(s, id, { type: "vote", value: i % 2 ? x : y }), g);
    // Five votes can't tie two ways, so one abstains by being dead.
    g.players[4].alive = false;
    g = split(g);
    expect(g.phase).toMatchObject({ kind: "vote", part: "agent", options: [0, 1], revote: true });
    g = split(g);
    expect(g.phase).toMatchObject({ kind: "vote", part: "device" });
    const settled = g.log.at(-1);
    expect(settled).toMatchObject({ t: "voted", part: "agent", inspector: true, tally: [[0, 2], [1, 2]] });
    expect([0, 1]).toContain(g.accusation.agent);
  });
});

describe("views", () => {
  it("show the guilty what they know, and the innocent nothing more", () => {
    const g = fresh();
    const k = projectView(g, ids[killer]);
    expect(k.you.role).toBe("killer");
    expect(k.guilty?.answer).toEqual(scenario.secret.answer);
    expect(k.guilty?.forgeries).toHaveLength(4);
    const i = projectView(g, ids[innocents[0]]);
    expect(i.you.role).toBe("innocent");
    expect(i.guilty).toBeNull();
    expect(i.reveal).toBeNull();
    const text = JSON.stringify(i);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("forgeries");
  });
});

describe("simulation", () => {
  it("plays bot games to the end at every table size", () => {
    for (const players of [4, 5, 6, 7, 8]) {
      const r = simulateGame(players * 17, players);
      expect(["caught", "wrong"]).toContain(r.result);
    }
  }, 60_000);
});
