import { useEffect, useState } from "react";
import {
  answerText,
  categoryOf,
  clueText,
  provenance,
  subjectText,
  type Dimension,
  type PlayerView,
} from "@party/deaddrop";
import { useAnalysis } from "./solver.js";
import { nameOf, CATEGORY_LABEL } from "./text.js";

const SECTIONS: { dim: Dimension; label: string }[] = [
  { dim: "agent", label: "🕴️ Suspects" },
  { dim: "device", label: "🧳 Devices" },
  { dim: "room", label: "🚪 Rooms" },
  { dim: "hour", label: "🕰️ Hours" },
];

function labels(view: PlayerView, dim: Dimension): string[] {
  const d = view.dossier;
  if (dim === "agent") return d.agents.map((a) => a.name);
  if (dim === "device") return d.devices.map((x) => x.name);
  if (dim === "room") return d.rooms.map((r) => r.name);
  return d.hours;
}

/** Hand-made crosses for the modes where the app doesn't fill the grid. Kept per device. */
function useMarks(key: string) {
  const [marks, setMarks] = useState<Set<string>>(() => {
    try {
      return new Set(JSON.parse(localStorage.getItem(key) ?? "[]") as string[]);
    } catch {
      return new Set();
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify([...marks]));
    } catch {
      /* storage full or blocked; the marks still work for this visit */
    }
  }, [key, marks]);
  const toggle = (k: string) =>
    setMarks((m) => {
      const next = new Set(m);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  return { marks, toggle };
}

/** A short fingerprint of the deal, so marks from an earlier game in the same room don't carry over. */
function dealKey(view: PlayerView, roomCode: string): string {
  const text = view.dossier.agents.map((a) => a.name + JSON.stringify(a.traits)).join("|") +
    view.dossier.devices.map((x) => x.name + x.location).join("|");
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return `deaddrop.marks.${roomCode}.${(h >>> 0).toString(36)}`;
}

export function Notebook({ view, roomCode }: { view: PlayerView; roomCode: string }) {
  const { solver, analysis, base } = useAnalysis(view);
  const { marks, toggle } = useMarks(dealKey(view, roomCode));
  const [why, setWhy] = useState<{ dim: Dimension; value: number } | null>(null);
  const auto = view.assist === "grid";
  const d = view.dossier;

  const progress = base > 1 ? 1 - Math.log(analysis.remaining) / Math.log(base) : 1;
  const explanation = why && auto ? solver.explain(view.you.known, why.dim, why.value) : null;

  return (
    <div className="stack">
      {view.assist !== "notes" && (
        <div className="card tight stack" style={{ gap: 8 }}>
          {analysis.solved && auto ? (
            <>
              <b>🎯 Only one answer fits</b>
              <span>{answerText(d, analysis.solved)}.</span>
            </>
          ) : (
            <div className="spread">
              <b>{analysis.remaining === 1 ? "One answer left" : `${analysis.remaining} possible answers`}</b>
              <span className="muted small">of {base}</span>
            </div>
          )}
          <div className="bar">
            <div className="fill" style={{ width: `${Math.round(progress * 100)}%`, background: "var(--accent)" }} />
          </div>
        </div>
      )}

      {SECTIONS.map(({ dim, label }) => {
        const counts = analysis.marginals[dim];
        const open = counts.filter((n) => n > 0).length;
        return (
          <div key={dim} className="stack" style={{ gap: 6 }}>
            <div className="muted small group-label">{label}</div>
            <div className="grid-cells">
              {labels(view, dim).map((name, value) => {
                const key = `${dim}:${value}`;
                const out = auto ? counts[value] === 0 : marks.has(key);
                const sure = auto && counts[value] > 0 && open === 1;
                return (
                  <button
                    key={key}
                    className={`cell ${out ? "out" : ""} ${sure ? "sure" : ""}`}
                    onClick={() =>
                      auto ? setWhy(out ? (why?.dim === dim && why.value === value ? null : { dim, value }) : null) : toggle(key)
                    }
                  >
                    <span className="name">{name}</span>
                    <span className="mark">{out ? "✗" : sure ? "✓" : auto ? counts[value] : ""}</span>
                  </button>
                );
              })}
            </div>
            {why?.dim === dim && explanation && (
              <div className="why">
                <b>Why {labels(view, dim)[why.value]} is ruled out:</b>
                {explanation.length === 0 ? (
                  <div>The dossier alone rules it out: no route, device and hour fit.</div>
                ) : (
                  explanation.map((c) => <div key={c.id}>• {clueText(d, c)}</div>)
                )}
              </div>
            )}
          </div>
        );
      })}
      {!auto && <p className="muted small center">Tap a name to cross it off. Only you see your marks.</p>}

      <ClueList view={view} />
    </div>
  );
}

function ClueList({ view }: { view: PlayerView }) {
  const d = view.dossier;
  const where = provenance(view);
  const known = [...view.you.known].reverse(); // newest first
  const newest = view.you.known[view.you.known.length - 1];
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="muted small group-label">🗂️ Your intelligence ({known.length})</div>
      {known.map((c) => {
        const p = where.get(c.id)!;
        const src =
          p.source === "public"
            ? "Everyone has this"
            : p.source === "hand"
              ? "Your own"
              : p.from!.fallback
                ? `From ${nameOf(view, p.from!.from)} (nothing on ${subjectText(d, p.from!.subject)}, so ${
                    CATEGORY_LABEL[categoryOf(p.from!.subject)]
                  })`
                : `From ${nameOf(view, p.from!.from)}, asked about ${subjectText(d, p.from!.subject)}`;
        return (
          <div key={c.id} className={`clue ${p.source === "received" && c === newest ? "new" : ""}`}>
            {clueText(d, c)}
            <span className="src">{src}</span>
          </div>
        );
      })}
    </div>
  );
}
