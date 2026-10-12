import { describe, it, expect } from "vitest";
import { generateScenario } from "./generate.js";
import { createGame, eligibleClues, projectView, reduce, GameError, type GameState } from "./game.js";
import { isAbout, allSubjects, categoryOf, isInCategory } from "./clues.js";
import { simulateGame } from "./simulate.js";
import type { Answer, Subject } from "./types.js";

const scenario = generateScenario({ seed: 11, players: 3 });
const seats = [
  { id: "a", name: "Ann" },
  { id: "b", name: "Ben" },
  { id: "c", name: "Cy" },
];

/** A subject `from` can answer exactly for `to`, and one they can't. */
function subjects(state: GameState, from: number, to: number) {
  const subs = allSubjects(state.scenario.dossier);
  const hit = subs.find((s) => {
    const o = eligibleClues(state, from, to, s);
    return o.ids.length && !o.fallback;
  })!;
  const miss = subs.find((s) => {
    const o = eligibleClues(state, from, to, s);
    return o.fallback && o.ids.length;
  });
  const none = subs.find((s) => !eligibleClues(state, from, to, s).ids.length);
  return { hit, miss, none };
}

const wrongAnswer = (a: Answer): Answer => ({ ...a, hour: (a.hour + 1) % scenario.dossier.hours.length });

describe("asking and answering", () => {
  it("deals everyone the public clues plus their own hand", () => {
    const g = createGame(scenario, seats, { mode: "competitive" });
    g.players.forEach((p, i) =>
      expect(p.known).toEqual([...scenario.publicClues, ...scenario.hands[i]])
    );
  });

  it("refuses to seat the wrong number of players", () => {
    expect(() => createGame(scenario, seats.slice(0, 2), { mode: "coop" })).toThrow(GameError);
  });

  it("makes the asked player hand over a matching clue, then lets them ask back", () => {
    let g = createGame(scenario, seats, { mode: "competitive" });
    const { hit } = subjects(g, 1, 0);
    g = reduce(g, "a", { type: "ask", target: "b", subject: hit });
    expect(g.phase).toMatchObject({ kind: "answer", from: 1, to: 0 });

    const options = projectView(g, "b").mustGive!;
    expect(options.fallback).toBe(false);
    for (const id of options.ids) expect(isAbout(scenario.clues[id], hit)).toBe(true);
    // Only Ben is asked to give.
    expect(projectView(g, "a").mustGive).toBeNull();
    expect(() => reduce(g, "a", { type: "give", clueId: options.ids[0] })).toThrow(GameError);
    // A clue that doesn't answer the question is refused.
    const off = g.players[1].known.find((id) => !options.ids.includes(id))!;
    expect(() => reduce(g, "b", { type: "give", clueId: off })).toThrow(GameError);

    g = reduce(g, "b", { type: "give", clueId: options.ids[0] });
    expect(g.players[0].known).toContain(options.ids[0]);
    expect(g.phase).toEqual({ kind: "counter", active: 0, by: 1 });

    // Ben may only ask Ann back.
    expect(() => reduce(g, "b", { type: "ask", target: "c", subject: hit })).toThrow(GameError);
    g = reduce(g, "b", { type: "decline" });
    expect(g.phase).toEqual({ kind: "turn", active: 1 });
    expect(g.turnsTaken).toBe(1);
  });

  it("falls back to the subject's category, and says so publicly", () => {
    let g = createGame(scenario, seats, { mode: "coop" });
    const { miss } = subjects(g, 1, 0);
    if (!miss) return; // this deal happens to have no fallback case for Ben
    g = reduce(g, "a", { type: "ask", target: "b", subject: miss });
    const options = projectView(g, "b").mustGive!;
    expect(options.fallback).toBe(true);
    for (const id of options.ids) expect(isInCategory(scenario.clues[id], categoryOf(miss))).toBe(true);
    g = reduce(g, "b", { type: "give", clueId: options.ids[0] });
    expect(g.log.at(-1)).toMatchObject({ t: "gave", fallback: true });
    // No asking back in co-op.
    expect(g.phase).toEqual({ kind: "turn", active: 1 });
  });

  it("passes the turn at once when the asked player has nothing at all", () => {
    let g = createGame(scenario, seats, { mode: "competitive" });
    // Hand Ben everything Ann knows so she has nothing new for him.
    g = { ...g, players: g.players.map((p, i) => (i === 1 ? { ...p, known: [...g.players[0].known] } : p)) };
    const subject: Subject = allSubjects(scenario.dossier)[0];
    // Not Ben's turn yet.
    expect(() => reduce(g, "b", { type: "ask", target: "a", subject })).toThrow(GameError);
    g = { ...g, phase: { kind: "turn", active: 1 } };
    g = reduce(g, "b", { type: "ask", target: "a", subject });
    expect(g.log.at(-1)).toMatchObject({ t: "nothing", from: "a", to: "b" });
    expect(g.phase).toEqual({ kind: "turn", active: 2 });
  });
});

describe("accusations", () => {
  it("wins on a correct accusation", () => {
    const g = reduce(createGame(scenario, seats, { mode: "competitive" }), "a", {
      type: "accuse",
      answer: scenario.secret.answer,
    });
    expect(g.phase).toEqual({ kind: "over", winners: ["a"], reason: "solved" });
  });

  it("puts a wrong accuser out, skips their turns, but they still answer", () => {
    let g = createGame(scenario, seats, { mode: "competitive" });
    g = reduce(g, "a", { type: "accuse", answer: wrongAnswer(scenario.secret.answer) });
    expect(g.players[0].out).toBe(true);
    expect(g.phase).toEqual({ kind: "turn", active: 1 });
    g = reduce(g, "b", { type: "accuse", answer: wrongAnswer(scenario.secret.answer) });
    expect(g.phase).toEqual({ kind: "turn", active: 2 });
    const { hit } = subjects(g, 0, 2);
    g = reduce(g, "c", { type: "ask", target: "a", subject: hit });
    expect(g.phase).toMatchObject({ kind: "answer", from: 0 });
    // Nobody can accuse while an answer is pending.
    expect(() => reduce(g, "c", { type: "accuse", answer: scenario.secret.answer })).toThrow(GameError);
  });

  it("ends with no winner when everyone has accused wrongly", () => {
    let g = createGame(scenario, seats, { mode: "competitive" });
    for (const id of ["a", "b", "c"]) g = reduce(g, id, { type: "accuse", answer: wrongAnswer(scenario.secret.answer) });
    expect(g.phase).toEqual({ kind: "over", winners: [], reason: "allOut" });
  });

  it("loses the co-op game on one wrong accusation, or when time runs out", () => {
    const wrong = reduce(createGame(scenario, seats, { mode: "coop" }), "a", {
      type: "accuse",
      answer: wrongAnswer(scenario.secret.answer),
    });
    expect(wrong.phase).toMatchObject({ kind: "over", reason: "wrongAccusation" });

    let g = createGame(scenario, seats, { mode: "coop", turnLimit: 1 });
    const { hit } = subjects(g, 1, 0);
    g = reduce(g, "a", { type: "ask", target: "b", subject: hit });
    g = reduce(g, "b", { type: "give", clueId: projectView(g, "b").mustGive!.ids[0] });
    expect(g.phase).toMatchObject({ kind: "over", reason: "outOfTime", winners: [] });
  });

  it("rejects an accusation that names nothing real", () => {
    const g = createGame(scenario, seats, { mode: "competitive" });
    expect(() => reduce(g, "a", { type: "accuse", answer: { agent: 99, device: 0, room: 0, hour: 0 } })).toThrow(
      GameError
    );
  });
});

describe("views", () => {
  it("shows each player only their own clues, and the answer only at the end", () => {
    const g = createGame(scenario, seats, { mode: "competitive" });
    const v = projectView(g, "b");
    expect(v.you.known.map((c) => c.id)).toEqual(g.players[1].known);
    expect(v.answer).toBeNull();
    expect(JSON.stringify(v)).not.toContain("schedule");
    const over = reduce(g, "a", { type: "accuse", answer: scenario.secret.answer });
    expect(projectView(over, "b").answer).toEqual(scenario.secret.answer);
  });
});

describe("bot games", () => {
  it("play to a correct finish in both modes", () => {
    for (const mode of ["competitive", "coop"] as const) {
      const r = simulateGame(5, 3, mode, 1000);
      expect(r.reason).toBe("solved");
    }
  }, 30_000);
});
