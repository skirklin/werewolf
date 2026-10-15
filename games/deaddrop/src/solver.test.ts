import { describe, it, expect } from "vitest";
import { generateScenario } from "./generate.js";
import { Solver } from "./solver.js";
import { meets } from "./space.js";

const s = generateScenario({ seed: 7, players: 4 });
const solver = new Solver(s.dossier);
const d = s.dossier;

describe("Space", () => {
  it("only admits worlds that obey the dossier's rules", () => {
    const sp = solver.space;
    let checked = 0;
    sp.base.forEach((i) => {
      if (i % 97) return;
      checked++;
      const dev = d.devices[sp.device[i]];
      const seen = sp.visitSets[sp.visits[i]];
      expect(meets(d, dev.requirement, sp.agent[i], sp.room[i])).toBe(true);
      expect(seen).toContain(sp.room[i]);
      expect(seen).toContain(dev.location);
    });
    expect(checked).toBeGreaterThan(0);
  });

  it("round-trips answer keys", () => {
    const a = s.secret.answer;
    expect(solver.space.answerOfKey(solver.space.keyOf(a))).toEqual(a);
  });
});

describe("Solver", () => {
  it("narrows as clues are added, never widens", () => {
    let prev = solver.remaining([]);
    for (let n = 1; n <= s.clues.length; n++) {
      const now = solver.remaining(s.clues.slice(0, n));
      expect(now).toBeLessThanOrEqual(prev);
      prev = now;
    }
    expect(prev).toBe(1);
  });

  it("gives marginals that agree with the remaining count", () => {
    const a = solver.analyze(s.clues.slice(0, 6));
    const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
    for (const m of Object.values(a.marginals)) expect(sum(m)).toBe(a.remaining);
  });

  it("values a clue you already hold at zero", () => {
    const known = s.clues.slice(0, 5);
    expect(solver.valueOf(known[0], known)).toBe(0);
  });

  it("explains a ruled-out suspect with clues that really do rule them out", () => {
    const all = s.clues;
    const a = solver.analyze(all);
    const innocent = a.marginals.agent.findIndex((n) => n === 0);
    const why = solver.explain(all, "agent", innocent)!;
    expect(why).not.toBeNull();
    // Those clues alone are enough to clear the suspect.
    expect(solver.analyze(why).marginals.agent[innocent]).toBe(0);
    // And the real mole is never "explained" away.
    expect(solver.explain(all, "agent", s.secret.answer.agent)).toBeNull();
  });
});
