import { useEffect, useState } from "react";
import { Solver, type Dimension, type Dossier, type PlayerView } from "@party/foulplay";

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

/** A short fingerprint of the deal, so marks from an earlier game don't carry over. */
function dealKey(view: PlayerView, roomCode: string): string {
  const text = view.dossier.agents.map((a) => a.name).join("|") + view.dossier.devices.map((x) => x.name + x.location).join("|");
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return `foulplay.marks.${roomCode}.${view.you.id}.${(h >>> 0).toString(36)}`;
}

/** What you've decided about one guest, weapon or room: nothing yet, ruled out, or suspected. */
export type Mark = "out" | "maybe" | undefined;

export interface Notes {
  marks: Record<string, Mark>;
  markOf: (dim: Dimension, value: number) => Mark;
  /** Blank → ruled out → suspected → blank. */
  cycle: (dim: Dimension, value: number) => void;
}

/**
 * Your detective's sheet. It's yours to fill in: the app never works the case
 * out for you, so nobody can be told "solved" before they've seen it.
 * Kept on this device only.
 */
export function useNotes(view: PlayerView, roomCode: string): Notes {
  const key = dealKey(view, roomCode);
  const [marks, setMarks] = useState<Record<string, Mark>>(() => load(key));
  useEffect(() => setMarks(load(key)), [key]);
  const cycle = (dim: Dimension, value: number) =>
    setMarks((m) => {
      const k = `${dim}:${value}`;
      const next = { ...m, [k]: m[k] === undefined ? "out" : m[k] === "out" ? "maybe" : undefined } as Record<string, Mark>;
      try {
        localStorage.setItem(key, JSON.stringify(next));
      } catch {
        /* storage blocked: the marks still hold for this visit */
      }
      return next;
    });
  return { marks, markOf: (dim, value) => marks[`${dim}:${value}`], cycle };
}

function load(key: string): Record<string, Mark> {
  try {
    return JSON.parse(localStorage.getItem(key) ?? "{}") as Record<string, Mark>;
  } catch {
    return {};
  }
}
