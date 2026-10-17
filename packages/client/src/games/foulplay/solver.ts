import { useEffect, useMemo, useState } from "react";
import { Solver, selfKnowledge, type Analysis, type Clue, type Dossier, type PlayerView } from "@party/foulplay";

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

/** A short fingerprint of the deal, so doubts from an earlier game don't carry over. */
function dealKey(view: PlayerView, roomCode: string): string {
  const text = view.dossier.agents.map((a) => a.name).join("|") + view.dossier.devices.map((x) => x.name + x.location).join("|");
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return `foulplay.doubts.${roomCode}.${view.you.id}.${(h >>> 0).toString(36)}`;
}

/** Cards you've set aside as untrustworthy. Kept on this device only. */
function useDoubts(key: string) {
  const [doubts, setDoubts] = useState<Set<number>>(() => load(key));
  useEffect(() => setDoubts(load(key)), [key]);
  const toggle = (id: number) =>
    setDoubts((d) => {
      const next = new Set(d);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      try {
        localStorage.setItem(key, JSON.stringify([...next]));
      } catch {
        /* storage blocked: the doubt still holds for this visit */
      }
      return next;
    });
  return { doubts, toggle };
}

function load(key: string): Set<number> {
  try {
    return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as number[]);
  } catch {
    return new Set();
  }
}

export interface Notes {
  solver: Solver;
  /** What your role tells you, and everything you've seen less what you doubt: what the board works from. */
  trusted: Clue[];
  analysis: Analysis;
  /** Answers possible before any evidence. */
  base: number;
  /** When the trusted cards can't all be true: a small set that clashes. */
  clash: Clue[] | null;
  /**
   * While there's a clash, the cards the board is leaving out so it can still
   * count: whichever of the clashing ones you saw last. Empty otherwise.
   */
  setAside: Clue[];
  /** The cards the board actually counts from: `trusted`, less `setAside`. */
  basis: Clue[];
  doubts: Set<number>;
  toggleDoubt: (id: number) => void;
}

export function useNotes(view: PlayerView, roomCode: string): Notes {
  const solver = solverFor(view.dossier);
  const { doubts, toggle } = useDoubts(dealKey(view, roomCode));
  const key = view.you.known.map((c) => c.id).join(",") + "|" + [...doubts].join(",");
  return useMemo(() => {
    const trusted = [...selfKnowledge(view), ...view.you.known.filter((c) => !doubts.has(c.id))];
    const clash = solver.conflict(trusted);
    // Keep counting through a clash: what you knew first stands, and the
    // card that broke it is left out until you decide what to doubt.
    const kept = clash ? solver.believable(trusted) : trusted;
    return {
      solver,
      trusted,
      analysis: solver.analyze(kept),
      base: solver.remaining([]),
      clash,
      setAside: clash ? trusted.filter((c) => !kept.includes(c)) : [],
      basis: kept,
      doubts,
      toggleDoubt: toggle,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [solver, key]);
}
