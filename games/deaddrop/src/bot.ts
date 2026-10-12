import type { Subject } from "./types.js";
import type { Action, PlayerView } from "./game.js";
import { allSubjects } from "./clues.js";
import { Solver } from "./solver.js";
import type { Rng } from "./rng.js";
import { pick } from "./rng.js";

/**
 * A baseline player for simulations: asks a random player about something
 * still open, accuses only when certain, and hands over its least useful clue
 * to a rival (its most useful one to a teammate). Its job is to give the
 * generator and the rules a yardstick, not to play well.
 */
export function botMove(view: PlayerView, solver: Solver, rng: Rng): Action | null {
  const seat = view.you.seat;
  const phase = view.phase;

  if (view.mustGive) {
    const pub = view.publicClues.map((id) => view.you.known.find((c) => c.id === id)!).filter(Boolean);
    const scored = view.mustGive.ids.map((id) => {
      const clue = view.you.known.find((c) => c.id === id)!;
      return { id, v: solver.valueOf(clue, pub) };
    });
    scored.sort((a, b) => (view.mode === "coop" ? b.v - a.v : a.v - b.v));
    return { type: "give", clueId: scored[0].id };
  }

  if (phase.kind === "counter" && phase.by === seat) {
    return { type: "ask", target: view.players[phase.active].id, subject: openSubject(view, solver, rng) };
  }

  if (phase.kind === "turn" && phase.active === seat) {
    const analysis = solver.analyze(view.you.known);
    if (analysis.solved) return { type: "accuse", answer: analysis.solved };
    const others = view.players.filter((p) => p.id !== view.you.id);
    return { type: "ask", target: pick(others, rng).id, subject: openSubject(view, solver, rng) };
  }
  return null;
}

/** A subject that could still tell this player something. */
function openSubject(view: PlayerView, solver: Solver, rng: Rng): Subject {
  const m = solver.analyze(view.you.known).marginals;
  const open = allSubjects(view.dossier).filter((s) => {
    if (s.kind === "agent") return m.agent[s.id] > 0 && m.agent.filter((x) => x > 0).length > 1;
    if (s.kind === "device") return m.device[s.id] > 0 && m.device.filter((x) => x > 0).length > 1;
    if (s.kind === "room") return m.room[s.id] > 0 && m.room.filter((x) => x > 0).length > 1;
    if (s.kind === "hour") return m.hour[s.id] > 0 && m.hour.filter((x) => x > 0).length > 1;
    return true;
  });
  return pick(open.length ? open : allSubjects(view.dossier), rng);
}
