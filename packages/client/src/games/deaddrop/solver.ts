import { useMemo } from "react";
import { Solver, type Analysis, type Dossier, type PlayerView } from "@party/deaddrop";

/**
 * One solver per dossier. Views arrive as fresh objects on every broadcast, so
 * the dossier is keyed by content; building the space takes a moment and
 * should happen once a game, not once a message.
 */
const solvers = new Map<string, Solver>();

export function solverFor(d: Dossier): Solver {
  const key = JSON.stringify(d);
  let s = solvers.get(key);
  if (!s) {
    solvers.clear(); // one game at a time is plenty
    s = new Solver(d);
    solvers.set(key, s);
  }
  return s;
}

export function useAnalysis(view: PlayerView): { solver: Solver; analysis: Analysis; base: number } {
  const solver = solverFor(view.dossier);
  const ids = view.you.known.map((c) => c.id).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const analysis = useMemo(() => solver.analyze(view.you.known), [solver, ids]);
  const base = useMemo(() => solver.remaining([]), [solver]);
  return { solver, analysis, base };
}
