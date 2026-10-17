import { describe, it, expect } from "vitest";
import { generateScenario } from "./generate.js";
import { Solver } from "./solver.js";
import { meets } from "./space.js";

const s = generateScenario({ seed: 7, players: 5 });
/** The true cards: everything but the forgeries. */
const truths = s.clues.filter((c) => !s.forged.includes(c.id));
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
    for (let n = 1; n <= truths.length; n++) {
      const now = solver.remaining(truths.slice(0, n));
      expect(now).toBeLessThanOrEqual(prev);
      prev = now;
    }
    expect(prev).toBe(1);
  });

  it("gives marginals that agree with the remaining count", () => {
    const a = solver.analyze(truths.slice(0, 6));
    const sum = (xs: number[]) => xs.reduce((x, y) => x + y, 0);
    for (const m of Object.values(a.marginals)) expect(sum(m)).toBe(a.remaining);
  });

  it("values a clue you already hold at zero", () => {
    const known = truths.slice(0, 5);
    expect(solver.valueOf(known[0], known)).toBe(0);
  });

  it("explains a ruled-out suspect with clues that really do rule them out", () => {
    const all = truths;
    const a = solver.analyze(all);
    const innocent = a.marginals.agent.findIndex((n) => n === 0);
    const why = solver.explain(all, "agent", innocent)!;
    expect(why).not.toBeNull();
    // Those clues alone are enough to clear the suspect.
    expect(solver.analyze(why).marginals.agent[innocent]).toBe(0);
    // And the real culprit is never "explained" away.
    expect(solver.explain(all, "agent", s.secret.answer.agent)).toBeNull();
  });

  it("finds a small clash among cards that can't all be true", () => {
    expect(solver.conflict(truths)).toBeNull();
    const lie = s.clues[s.forged[0]];
    const clash = solver.conflict([...truths, lie])!;
    expect(clash).toContain(lie);
    expect(solver.consistent(clash)).toBe(false);
    // Every card in it matters: drop any one and the rest can all be true.
    for (const c of clash) expect(solver.consistent(clash.filter((x) => x !== c))).toBe(true);
  });

  it("sets aside the less trusted card when two clash", () => {
    const lie = s.clues[s.forged[0]];
    const kept = solver.believable([...truths, lie]);
    expect(kept).not.toContain(lie);
    expect(kept).toHaveLength(truths.length);
  });
});
