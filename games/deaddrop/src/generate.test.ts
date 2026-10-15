import { describe, it, expect } from "vitest";
import { generateScenario, buildDossier } from "./generate.js";
import { Solver, sameAnswer } from "./solver.js";
import { holds } from "./clues.js";
import { MAX_VISITS, MIN_VISITS } from "./space.js";
import { makeRng } from "./rng.js";
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

describe("dossier", () => {
  it("keeps every pair of suspects at least two traits apart", () => {
    const d = buildDossier(makeRng(2), 8, 6);
    for (const a of d.agents)
      for (const b of d.agents) {
        if (a.id >= b.id) continue;
        expect(d.traits.filter((t) => a.traits[t.id] !== b.traits[t.id]).length).toBeGreaterThanOrEqual(2);
      }
  });
});

describe("generateScenario", () => {
  it("is reproducible from its seed", () => {
    const a = generateScenario({ seed: 42, players: 3 });
    const b = generateScenario({ seed: 42, players: 3 });
    expect(b).toEqual(a);
  });

  it("rejects unsupported table sizes", () => {
    expect(() => generateScenario({ seed: 1, players: 1 })).toThrow();
    expect(() => generateScenario({ seed: 1, players: 7 })).toThrow();
  });

  it("sends every guest to between two and four rooms", () => {
    const s = generateScenario({ seed: 5, players: 3 });
    for (const v of s.secret.visits) {
      expect(v.length).toBeGreaterThanOrEqual(MIN_VISITS);
      expect(v.length).toBeLessThanOrEqual(MAX_VISITS);
      expect(new Set(v).size).toBe(v.length);
    }
    // The mole was where the handoff happened, and where the device was hidden.
    const { answer, visits } = s.secret;
    expect(visits[answer.agent]).toContain(answer.room);
    expect(visits[answer.agent]).toContain(s.dossier.devices[answer.device].location);
  });

  for (const players of [2, 3, 4, 5, 6])
    it(`deals a fair, uniquely solvable game for ${players} players`, () => {
      for (let seed = 1; seed <= 3; seed++) {
        const s = generateScenario({ seed: seed * 1000 + players, players });
        const solver = new Solver(s.dossier);
        const clue = (id: number) => s.clues[id];

        // The real world is a candidate, and every clue is true of it.
        const truth = truthIndex(solver, s);
        expect(truth).toBeGreaterThanOrEqual(0);
        expect(solver.space.base.has(truth)).toBe(true);
        for (const c of s.clues) expect(holds(solver.space, c, truth)).toBe(true);

        // Together the clues name exactly the real answer.
        const all = solver.analyze(s.clues);
        expect(all.solved && sameAnswer(all.solved, s.secret.answer)).toBe(true);

        // Every clue is dealt exactly once: public, in a hand, or in the deck.
        expect(s.deck.length).toBeGreaterThan(0);
        const dealt = [...s.publicClues, ...s.hands.flat(), ...s.deck].sort((x, y) => x - y);
        expect(dealt).toEqual(s.clues.map((c) => c.id));

        // Nobody can solve it alone, and at four or more nobody can in pairs.
        for (const hand of s.hands)
          expect(solver.remaining([...s.publicClues, ...hand].map(clue))).toBeGreaterThanOrEqual(4);
        if (players >= 4)
          for (let a = 0; a < players; a++)
            for (let b = a + 1; b < players; b++)
              expect(
                solver.remaining([...s.publicClues, ...s.hands[a], ...s.hands[b]].map(clue))
              ).toBeGreaterThanOrEqual(2);
      }
    }, 30_000);
});
