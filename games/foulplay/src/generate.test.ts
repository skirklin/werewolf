import { describe, it, expect } from "vitest";
import { generateScenario } from "./generate.js";
import { Solver } from "./solver.js";
import { holds } from "./clues.js";
import { CAST } from "./content.js";
import type { Scenario } from "./types.js";

/** Index of the candidate world that actually happened. */
function truthIndex(solver: Solver, s: Scenario): number {
  const sp = solver.space;
  const { answer, visits } = s.secret;
  const seen = [...visits[answer.agent]].sort((x, y) => x - y).join(",");
  for (let i = 0; i < sp.size; i++)
    if (
      sp.agent[i] === answer.agent &&
      sp.device[i] === answer.device &&
      sp.room[i] === answer.room &&
      sp.visitSets[sp.visits[i]].join(",") === seen
    )
      return i;
  return -1;
}

const cases = [4, 5, 6, 7, 8].flatMap((players) => [1, 2, 3].map((seed) => generateScenario({ seed, players })));
const innocentMemories = (s: Scenario) => s.memories.flatMap((m, i) => (i === s.killer || i === s.accomplice ? [] : m));

describe("generateScenario", () => {
  it("is reproducible from its seed", () => {
    expect(generateScenario({ seed: 42, players: 5 })).toEqual(generateScenario({ seed: 42, players: 5 }));
  });

  it("seats one killer, and an accomplice only at bigger tables", () => {
    for (const s of cases) {
      const n = s.memories.length;
      expect(s.secret.answer.agent).toBe(s.killer);
      if (n >= 6) expect(s.accomplice).not.toBeNull();
      else expect(s.accomplice).toBeNull();
      expect(s.accomplice).not.toBe(s.killer);
    }
  });

  it("keeps every guest's looks fixed", () => {
    for (const s of cases)
      for (const a of s.dossier.agents) expect(a.traits).toEqual(CAST.find((c) => c.name === a.name)!.traits);
  });

  it("only deals true cards", () => {
    for (const s of cases) {
      const solver = new Solver(s.dossier);
      const truth = truthIndex(solver, s);
      expect(truth).toBeGreaterThanOrEqual(0);
      for (const c of s.clues) expect(holds(solver.space, c, truth)).toBe(true);
    }
  });

  it("lays the evidence out through the house: every room and the Hall", () => {
    for (const s of cases) {
      expect(s.stacks).toHaveLength(s.dossier.rooms.length + 1);
      for (const stack of s.stacks.slice(0, -1)) {
        expect(stack.length).toBeGreaterThanOrEqual(1);
        expect(stack.length).toBeLessThanOrEqual(3);
      }
      expect(s.stacks.at(-1)!.length).toBeGreaterThanOrEqual(2);
      for (const m of s.memories) expect(m).toHaveLength(1);
    }
  });

  it("can be proved from what the innocents could find, even with any one card destroyed", () => {
    for (const s of cases) {
      const solver = new Solver(s.dossier);
      const card = (id: number) => s.clues[id];
      const findable = [...s.stacks.flat(), ...innocentMemories(s)];
      expect(solver.analyze(findable.map(card)).solved).toEqual(s.secret.answer);
      for (const lost of s.stacks.flat())
        expect(solver.analyze(findable.filter((id) => id !== lost).map(card)).solved).toEqual(s.secret.answer);
    }
  });

  it("never gives the guilty a memory that names the killer", () => {
    for (const s of cases)
      for (const seat of [s.killer, s.accomplice]) {
        if (seat === null) continue;
        const c = s.clues[s.memories[seat][0]];
        if (c.kind === "visited") expect(c.agent).not.toBe(s.killer);
      }
  });
});
