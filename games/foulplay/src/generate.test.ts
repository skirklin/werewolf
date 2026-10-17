import { describe, it, expect } from "vitest";
import { generateScenario } from "./generate.js";
import { Solver } from "./solver.js";
import { holds, leadsFor, sameLead } from "./clues.js";
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

describe("generateScenario", () => {
  it("is reproducible from its seed", () => {
    expect(generateScenario({ seed: 42, players: 5 })).toEqual(generateScenario({ seed: 42, players: 5 }));
  });

  it("seats one killer, and an accomplice only at bigger tables", () => {
    for (const s of cases) {
      const n = s.hands.length;
      expect(s.killer).toBeGreaterThanOrEqual(0);
      expect(s.killer).toBeLessThan(n);
      expect(s.secret.answer.agent).toBe(s.killer);
      if (n >= 6) expect(s.accomplice).not.toBeNull();
      else expect(s.accomplice).toBeNull();
      expect(s.accomplice).not.toBe(s.killer);
    }
    expect(generateScenario({ seed: 1, players: 5, accomplice: true }).accomplice).not.toBeNull();
  });

  it("keeps every guest's looks fixed", () => {
    for (const s of cases)
      for (const a of s.dossier.agents) expect(a.traits).toEqual(CAST.find((c) => c.name === a.name)!.traits);
  });

  it("deals true cards and false forgeries", () => {
    for (const s of cases) {
      const solver = new Solver(s.dossier);
      const truth = truthIndex(solver, s);
      expect(truth).toBeGreaterThanOrEqual(0);
      const forged = new Set(s.forged);
      for (const c of s.clues) expect(holds(solver.space, c, truth)).toBe(!forged.has(c.id));
    }
  });

  it("is solvable from what the innocents can find, but not from their memories alone", () => {
    for (const s of cases) {
      const solver = new Solver(s.dossier);
      const card = (id: number) => s.clues[id];
      const innocent = s.hands.flatMap((h, i) => (i === s.killer || i === s.accomplice ? [] : h));
      const findable = [...innocent, ...Object.values(s.stacks).flat()];
      expect(solver.analyze(findable.map(card)).solved).toEqual(s.secret.answer);
      expect(solver.remaining(innocent.map(card))).toBeGreaterThanOrEqual(6);
    }
  });

  it("gives every forgery a lead it could plausibly turn up under", () => {
    for (const s of cases) {
      const all = [...s.forgeries.killer, ...s.forgeries.accomplice];
      expect(s.forgeries.killer).toHaveLength(4);
      expect(s.forgeries.accomplice).toHaveLength(s.accomplice === null ? 0 : 2);
      for (const f of all) {
        expect(s.forged).toContain(f.clue);
        expect(leadsFor(s.dossier, s.clues[f.clue]).some((l) => sameLead(l, f.lead))).toBe(true);
      }
    }
  });

  it("doesn't hand the killer or accomplice a memory that names the killer", () => {
    for (const s of cases)
      for (const seat of [s.killer, s.accomplice]) {
        if (seat === null) continue;
        for (const id of s.hands[seat]) {
          const c = s.clues[id];
          if (c.kind === "visited") expect(c.agent).not.toBe(s.killer);
        }
      }
  });
});
