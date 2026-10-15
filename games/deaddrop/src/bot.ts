import type { Clue, Subject } from "./types.js";
import type { Action, Deal, PlayerView } from "./game.js";
import { allSubjects, sameSubject } from "./clues.js";
import { Solver } from "./solver.js";
import type { Rng } from "./rng.js";
import { pick, shuffle } from "./rng.js";

/**
 * A baseline player for simulations and practice. It asks about two random
 * subjects that are still open, accuses only when certain, offers rivals a
 * single cheap card (teammates everything), takes every offer it can pay for,
 * paying as little as the rules allow, and discards its cheapest cards so it
 * keeps the valuable ones to trade with. Its job is to be a yardstick, not to
 * play well.
 */
export function botMove(view: PlayerView, solver: Solver, rng: Rng): Action | null {
  const seat = view.you.seat;
  const phase = view.phase;
  const clue = (id: number) => view.you.known.find((c) => c.id === id)!;

  if (view.canOffer) {
    if (view.mode === "coop" || !view.canOffer.length) return { type: "offer", clueIds: view.canOffer };
    const cheapest = Math.min(...view.canOffer.map((id) => clue(id).points));
    return { type: "offer", clueIds: [pick(view.canOffer.filter((id) => clue(id).points === cheapest), rng)] };
  }

  if (view.choices) {
    const deals: Deal[] = [];
    const spent = new Set<number>();
    for (const c of view.choices) {
      const left = view.you.hand.filter((id) => !spent.has(id)).map(clue);
      const payback = cheapestPayback(left, c.points, rng);
      if (!payback) continue;
      for (const id of payback) spent.add(id);
      deals.push({ from: c.from, payback });
    }
    return { type: "accept", deals };
  }

  if (view.mustDiscard !== null) {
    const cheapFirst = shuffle(view.you.hand.map(clue), rng).sort((x, y) => x.points - y.points);
    return { type: "discard", clueIds: cheapFirst.slice(0, view.mustDiscard).map((c) => c.id) };
  }

  if (phase.kind === "turn" && phase.active === seat) {
    const analysis = solver.analyze(view.you.known);
    if (analysis.solved) return { type: "accuse", answer: analysis.solved };
    const [a, b] = openSubjects(view, solver, rng);
    return { type: "ask", subjects: [a, b] };
  }
  return null;
}

/**
 * The cheapest set of clues worth at least `target` points: one card if one
 * will do, otherwise the smallest cards first. Null if it can't be paid.
 */
export function cheapestPayback(cards: Clue[], target: number, rng: Rng): number[] | null {
  const pool = shuffle(cards, rng).sort((x, y) => x.points - y.points);
  const single = pool.find((c) => c.points >= target);
  if (single) return [single.id];
  const out: number[] = [];
  let sum = 0;
  for (const c of pool) {
    out.push(c.id);
    sum += c.points;
    if (sum >= target) return out;
  }
  return null;
}

/** Two different subjects that could still tell this player something. */
function openSubjects(view: PlayerView, solver: Solver, rng: Rng): [Subject, Subject] {
  const m = solver.analyze(view.you.known).marginals;
  const open = allSubjects(view.dossier).filter((s) => {
    if (s.kind === "agent") return m.agent[s.id] > 0 && m.agent.filter((x) => x > 0).length > 1;
    if (s.kind === "device") return m.device[s.id] > 0 && m.device.filter((x) => x > 0).length > 1;
    if (s.kind === "room") return m.room[s.id] > 0 && m.room.filter((x) => x > 0).length > 1;
    return true;
  });
  const pool = open.length >= 2 ? open : allSubjects(view.dossier);
  const a = pick(pool, rng);
  const b = pick(pool.filter((s) => !sameSubject(s, a)), rng);
  return [a, b];
}
