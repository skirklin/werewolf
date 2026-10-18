import { describe, it, expect } from "vitest";
import { generateScenario } from "./generate.js";
import { createGame, projectView, reduce, whoMustAct, GameError, isAlone, type GameState } from "./game.js";
import { simulateGame } from "./simulate.js";

const scenario = generateScenario({ seed: 11, players: 5 });
const ids = ["a", "b", "c", "d", "e"];
const seats = ids.map((id) => ({ id, name: id.toUpperCase() }));
const fresh = () => createGame(scenario, seats, {});
const killer = scenario.killer;
const innocents = [0, 1, 2, 3, 4].filter((i) => i !== killer);
const hall = scenario.dossier.rooms.length;
/** A room with evidence in it, that isn't the Hall. */
const roomWith = (g: GameState, n = 1) => g.stacks.findIndex((s, p) => p !== hall && s.length >= n);

/** Play the active player's turn: stay in place and keep watch. */
function quietTurn(g: GameState): GameState {
  const p = g.phase as { active: number };
  g = reduce(g, ids[p.active], { type: "stay" });
  g = reduce(g, ids[p.active], { type: "watch" });
  return reduce(g, ids[p.active], { type: "end" });
}

function until(g: GameState, seat: number): GameState {
  for (let guard = 0; guard < 50; guard++) {
    if (g.phase.kind === "turn" && g.phase.active === seat && g.phase.step === "move") return g;
    g = g.phase.kind === "night" ? reduce(g, ids[g.phase.active], { type: "night" }) : quietTurn(g);
  }
  throw new Error("never reached that seat");
}

describe("a turn", () => {
  it("is move, then act", () => {
    let g = fresh();
    expect(g.players.every((p) => p.place === hall)).toBe(true);
    expect(() => reduce(g, "a", { type: "search" })).toThrow(GameError);
    expect(() => reduce(g, "b", { type: "stay" })).toThrow(GameError);
    g = reduce(g, "a", { type: "move", to: 0 });
    expect(g.players[0].place).toBe(0);
    expect(() => reduce(g, "a", { type: "move", to: 1 })).toThrow(GameError);
    g = reduce(g, "a", { type: "watch" });
    expect(g.phase).toMatchObject({ kind: "turn", active: 0, step: "wrap" });
    expect(() => reduce(g, "a", { type: "search" })).toThrow(GameError);
    g = reduce(g, "a", { type: "end" });
    expect(g.phase).toMatchObject({ kind: "turn", active: 1, step: "move" });
  });

  it("can join another guest wherever they are", () => {
    let g = reduce(fresh(), "a", { type: "move", to: 2 });
    g = reduce(g, "a", { type: "watch" });
    g = reduce(g, "a", { type: "end" });
    g = reduce(g, "b", { type: "join", who: "a" });
    expect(g.players[1].place).toBe(2);
    expect(g.log.at(-1)).toEqual({ t: "move", who: "b", to: 2, joined: "a" });
  });
});

describe("searching", () => {
  it("alone, the find goes into your hand, unseen", () => {
    const g0 = fresh();
    const place = roomWith(g0);
    const top = g0.stacks[place][0];
    let g = reduce(g0, "a", { type: "move", to: place });
    g = reduce(g, "a", { type: "search" });
    expect(g.players[0].hand).toContain(top);
    expect(g.record).toEqual([]);
    expect(g.stacks[place]).not.toContain(top);
    expect(g.log.at(-1)).toEqual({ t: "search", who: "a", place, found: "private" });
    expect(projectView(g, "b").you.known.map((c) => c.id)).not.toContain(top);
    expect(projectView(g, "b").counts[place]).toBe(g0.stacks[place].length - 1);
  });

  it("with an innocent watching, the find goes straight on the record", () => {
    // Everyone starts in the Hall, so searching there is witnessed.
    const g0 = fresh();
    const top = g0.stacks[hall][0];
    const searcher = innocents[0];
    let g = until(g0, searcher);
    g = reduce(g, ids[searcher], { type: "stay" });
    g = reduce(g, ids[searcher], { type: "search" });
    expect(g.record.map((r) => r.clue)).toContain(top);
    expect(g.record.at(-1)).toMatchObject({ how: "witnessed", by: ids[searcher], place: hall });
    for (const p of g.players) expect(p.known).toContain(top);
  });

  it("you can testify what you hold, or burn it, and nobody sees a burn", () => {
    let g = fresh();
    const memory = g.players[0].hand[0];
    g = reduce(g, "a", { type: "testify", card: memory });
    expect(g.record.at(-1)).toMatchObject({ clue: memory, how: "testified" });
    expect(() => reduce(g, "a", { type: "burn", card: memory })).toThrow(GameError);

    let k = until(fresh(), innocents[1]);
    const theirs = k.players[innocents[1]].hand[0];
    expect(() => reduce(k, ids[innocents[0]], { type: "burn", card: theirs })).toThrow(GameError);
    k = reduce(k, ids[innocents[1]], { type: "burn", card: theirs });
    expect(k.players[innocents[1]].hand).toEqual([]);
    expect(k.secretly.at(-1)).toMatchObject({ what: "burn", who: ids[innocents[1]] });
    // Nothing public happens.
    expect(k.log.at(-1)?.t).not.toBe("burn");
  });
});

describe("the night", () => {
  /** Spread everyone out into separate rooms, so they're all alone, and play to the night. */
  function spreadOut(): GameState {
    let g = fresh();
    for (let i = 0; i < 5; i++) {
      g = reduce(g, ids[i], { type: "move", to: i });
      g = reduce(g, ids[i], { type: "watch" });
      g = reduce(g, ids[i], { type: "end" });
    }
    return g;
  }

  it("comes after everyone's turn, passing round the table", () => {
    let g = spreadOut();
    expect(g.phase).toEqual({ kind: "night", active: 0 });
    expect(whoMustAct(g)).toEqual([0]);
    for (let i = 0; i < 5; i++) g = reduce(g, ids[i], { type: "night" });
    expect(g.round).toBe(2);
    expect(g.log.at(-1)).toEqual({ t: "quiet" });
  });

  it("lets the killer murder a guest who's alone, and leaves evidence on the body", () => {
    let g = spreadOut();
    const victim = innocents[0];
    for (let i = 0; i < 5; i++) {
      if (i === killer) {
        expect(projectView(g, ids[i]).night?.alone).toContain(ids[victim]);
        g = reduce(g, ids[i], { type: "night", plan: { murder: ids[victim] } });
      } else g = reduce(g, ids[i], { type: "night" });
    }
    expect(g.players[victim].alive).toBe(false);
    expect(g.log).toContainEqual({ t: "murder", who: ids[victim], place: victim });
    expect(g.stacks[victim][0]).toBe(scenario.spare[0]);
    // The dead take no more turns.
    expect(g.phase).toMatchObject({ kind: "turn", active: victim === 0 ? 1 : 0 });
  });

  it("won't let the killer murder someone who has company", () => {
    let g = fresh(); // everyone stays together in the Hall
    for (let i = 0; i < 5; i++) g = quietTurn(g);
    expect(isAlone(g, innocents[0])).toBe(false);
    while (g.phase.kind === "night" && g.phase.active !== killer) g = reduce(g, ids[g.phase.active], { type: "night" });
    expect(projectView(g, ids[killer]).night?.alone).toEqual([]);
    expect(() => reduce(g, ids[killer], { type: "night", plan: { murder: ids[innocents[0]] } })).toThrow(GameError);
  });

  it("allows only one murder a game by default", () => {
    let g = spreadOut();
    for (let i = 0; i < 5; i++)
      g = reduce(g, ids[i], i === killer ? { type: "night", plan: { murder: ids[innocents[0]] } } : { type: "night" });
    for (const i of [0, 1, 2, 3, 4]) if (g.players[i].alive) g = quietTurn(g);
    while (g.phase.kind === "night" && g.phase.active !== killer) g = reduce(g, ids[g.phase.active], { type: "night" });
    if (g.phase.kind !== "night") return;
    expect(() => reduce(g, ids[killer], { type: "night", plan: { murder: ids[innocents[1]] } })).toThrow(GameError);
  });

  it("lets the killer destroy a card in an empty room instead", () => {
    let g = spreadOut();
    const empty = g.stacks.findIndex((s, p) => s.length && !g.players.some((x) => x.place === p));
    if (empty < 0) return; // every room with evidence is occupied in this deal
    const top = g.stacks[empty][0];
    for (let i = 0; i < 5; i++)
      g = reduce(g, ids[i], i === killer ? { type: "night", plan: { destroy: empty } } : { type: "night" });
    expect(g.stacks[empty]).not.toContain(top);
    expect(g.secretly.at(-1)).toMatchObject({ what: "nightDestroy", clue: top });
  });
});

describe("how it ends", () => {
  const truth = scenario.secret.answer;
  /** Call the Reconstruction as `seat`, and have everyone answer `agree(seat)`. */
  function reconstruct(g: GameState, seat: number, answer: typeof truth, agree: (i: number) => boolean): GameState {
    g = until(g, seat);
    g = reduce(g, ids[seat], { type: "accuse", answer });
    expect(g.phase).toMatchObject({ kind: "trial", by: seat });
    expect(whoMustAct(g)).not.toContain(seat); // calling it is a yes
    for (const i of whoMustAct(g)) g = reduce(g, ids[i], { type: "verdict", agree: agree(i) });
    return g;
  }

  it("never ends just because the record proves it", () => {
    let g = fresh();
    const all = [...g.stacks.flat()];
    g.players[0].hand.push(...all);
    g.stacks = g.stacks.map(() => []);
    for (const id of all) g = reduce(g, "a", { type: "testify", card: id });
    expect(g.phase.kind).toBe("turn");
  });

  it("a Reconstruction the table accepts is the verdict: right, and the innocents win", () => {
    const g = reconstruct(fresh(), innocents[0], truth, () => true);
    expect(g.phase).toMatchObject({ kind: "over", by: "trial", caught: true });
    expect((g.phase as { winners: string[] }).winners.sort()).toEqual(innocents.map((i) => ids[i]).sort());
  });

  it("...and wrong, the killer wins", () => {
    const framed = innocents[0];
    const g = reconstruct(fresh(), killer, scenario.stories[framed], () => true);
    expect(g.phase).toMatchObject({ kind: "over", by: "trial", caught: false, accusation: scenario.stories[framed] });
  });

  it("a rejected one costs the caller their turn, and their call", () => {
    const seat = innocents[0];
    let g = reconstruct(fresh(), seat, truth, (i) => i === seat);
    expect(g.log.at(-1)).toMatchObject({ t: "verdict", accepted: false });
    expect(g.phase).toMatchObject({ kind: "turn", step: "move" });
    expect((g.phase as { active: number }).active).not.toBe(seat);
    g = until(g, seat);
    expect(() => reduce(g, ids[seat], { type: "accuse", answer: truth })).toThrow(GameError);
  });

  it("can only be called instead of moving, and only on the living", () => {
    let g = reduce(fresh(), "a", { type: "stay" });
    expect(() => reduce(g, "a", { type: "accuse", answer: truth })).toThrow(GameError);
    g = fresh();
    g.players[innocents[1]].alive = false;
    expect(() => reduce(g, "a", { type: "accuse", answer: scenario.stories[innocents[1]] })).toThrow(GameError);
  });

  it("falls back to a dawn vote after the last round", () => {
    let g = createGame(scenario, seats, { rounds: 1 });
    for (let i = 0; i < 5; i++) g = quietTurn(g);
    expect(g.phase).toMatchObject({ kind: "vote", part: "agent" });
    for (const part of ["agent", "device", "room"] as const)
      for (const id of ids) g = reduce(g, id, { type: "vote", value: truth[part] });
    expect(g.phase).toMatchObject({ kind: "over", by: "dawn", caught: true });
  });
});

describe("views", () => {
  it("show the killer every room's evidence, and the innocent only how much", () => {
    const g = fresh();
    const k = projectView(g, ids[killer]);
    expect(k.guilty?.answer).toEqual(scenario.secret.answer);
    expect(k.guilty?.stacks?.map((s) => s.length)).toEqual(g.stacks.map((s) => s.length));
    const i = projectView(g, ids[innocents[0]]);
    expect(i.guilty).toBeNull();
    expect(i.counts).toEqual(g.stacks.map((s) => s.length));
    expect(i.you.story).toEqual(scenario.stories[innocents[0]]);
    const text = JSON.stringify(i);
    expect(text).not.toContain("secret");
    expect(text).not.toContain("stacks");
    expect(text).not.toContain("stories");
  });
});

describe("simulation", () => {
  it("plays bot games to the end at every table size", () => {
    for (const players of [4, 5, 6, 7, 8]) {
      const r = simulateGame(players * 17, players);
      expect(["trial", "outnumbered", "dawn"]).toContain(r.by);
    }
  }, 60_000);
});
