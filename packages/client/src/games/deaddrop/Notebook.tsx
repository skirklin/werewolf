import { useEffect, useState } from "react";
import {
  answerText,
  clueText,
  sameSubject,
  type Answer,
  type Dimension,
  type PlayerView,
  type Subject,
} from "@party/deaddrop";
import { useAnalysis } from "./solver.js";
import { nameOf, subjectsText } from "./text.js";
import { Pips } from "./cards.js";

/**
 * What the board is being used to pick, if anything. On your turn the board
 * is where you choose: two subjects to ask about, or who, how and where to
 * accuse. Otherwise it's your notes.
 */
export type Picking =
  | { mode: "ask"; subjects: Subject[]; onPick: (s: Subject) => void }
  | { mode: "accuse"; answer: Partial<Answer>; onPick: (dim: Dimension, value: number) => void }
  | null;

type Row =
  | { kind: "dim"; dim: Dimension; label: string; subject: Subject["kind"] }
  | { kind: "tag"; label: string; subject: "trait" | "feature" };

/** Everything a case is about, in board order. */
const ROWS: Row[] = [
  { kind: "dim", dim: "agent", label: "🕴️ Suspects", subject: "agent" },
  { kind: "tag", label: "👒 Looks", subject: "trait" },
  { kind: "dim", dim: "device", label: "🧳 Devices", subject: "device" },
  { kind: "dim", dim: "room", label: "🚪 Rooms", subject: "room" },
  { kind: "tag", label: "🏷️ Room features", subject: "feature" },
];

function names(view: PlayerView, dim: Dimension): string[] {
  const d = view.dossier;
  if (dim === "agent") return d.agents.map((a) => a.name);
  if (dim === "device") return d.devices.map((x) => x.name);
  return d.rooms.map((r) => r.name);
}

/** Hand-made crosses for notes-only games. Kept per device. */
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
  const text =
    view.dossier.agents.map((a) => a.name + JSON.stringify(a.traits)).join("|") +
    view.dossier.devices.map((x) => x.name + x.location).join("|");
  let h = 0;
  for (let i = 0; i < text.length; i++) h = (Math.imul(h, 31) + text.charCodeAt(i)) | 0;
  return `deaddrop.marks.${roomCode}.${(h >>> 0).toString(36)}`;
}

export function Notebook({ view, roomCode, picking }: { view: PlayerView; roomCode: string; picking: Picking }) {
  const { solver, analysis, base } = useAnalysis(view);
  const { marks, toggle } = useMarks(dealKey(view, roomCode));
  const [why, setWhy] = useState<{ dim: Dimension; value: number } | null>(null);
  const auto = view.assist === "grid";
  const d = view.dossier;

  const progress = base > 1 ? 1 - Math.log(analysis.remaining) / Math.log(base) : 1;
  const explanation = why && auto ? solver.explain(view.you.known, why.dim, why.value) : null;

  const tags = (subject: "trait" | "feature") =>
    subject === "trait"
      ? d.traits.map((t) => ({ s: { kind: "trait", id: t.id } as Subject, label: t.label }))
      : d.features.map((f) => ({ s: { kind: "feature", id: f.id } as Subject, label: f.label }));

  return (
    <div className="stack">
      {auto && (
        <div className="card tight stack" style={{ gap: 8 }}>
          {analysis.solved ? (
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

      {ROWS.map((row) => {
        if (row.kind === "tag") {
          // Looks and room features are only ever asked about, never accused.
          const askable = picking?.mode === "ask";
          return (
            <div key={row.label} className="stack" style={{ gap: 6 }}>
              <div className="muted small group-label">{row.label}</div>
              <div className="choices">
                {tags(row.subject).map(({ s, label }) => {
                  const on = askable && picking.subjects.some((x) => sameSubject(x, s));
                  return (
                    <button
                      key={label}
                      className={`choice ${on ? "selected" : ""}`}
                      disabled={!askable}
                      onClick={() => askable && picking.onPick(s)}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>
          );
        }
        const { dim } = row;
        const counts = analysis.marginals[dim];
        const open = counts.filter((n) => n > 0).length;
        return (
          <div key={row.label} className="stack" style={{ gap: 6 }}>
            <div className="muted small group-label">{row.label}</div>
            <div className="grid-cells">
              {names(view, dim).map((name, value) => {
                const key = `${dim}:${value}`;
                const subject = { kind: row.subject, id: value } as Subject;
                const out = auto ? counts[value] === 0 : marks.has(key);
                const sure = auto && counts[value] > 0 && open === 1;
                const picked =
                  picking?.mode === "ask"
                    ? picking.subjects.some((x) => sameSubject(x, subject))
                    : picking?.mode === "accuse"
                      ? picking.answer[dim] === value
                      : false;
                const onClick = () => {
                  if (picking?.mode === "ask") picking.onPick(subject);
                  else if (picking?.mode === "accuse") picking.onPick(dim, value);
                  else if (auto) setWhy(out && !(why?.dim === dim && why.value === value) ? { dim, value } : null);
                  else toggle(key);
                };
                return (
                  <button
                    key={key}
                    className={`cell ${out ? "out" : ""} ${sure ? "sure" : ""} ${picked ? "picked" : ""}`}
                    onClick={onClick}
                  >
                    <span className="name">{name}</span>
                    <span className="mark">{out ? "✗" : sure ? "✓" : auto ? counts[value] : ""}</span>
                  </button>
                );
              })}
            </div>
            {!picking && why?.dim === dim && explanation && (
              <div className="why">
                <b>Why {names(view, dim)[why.value]} is ruled out:</b>
                {explanation.length === 0 ? (
                  <div>The dossier alone rules it out: no device fits.</div>
                ) : (
                  explanation.map((c) => <div key={c.id}>• {clueText(d, c)}</div>)
                )}
              </div>
            )}
          </div>
        );
      })}
      {!picking && (
        <p className="muted small center" style={{ margin: 0 }}>
          {auto
            ? "Numbers are how many answers each one still appears in. Tap a crossed-off one to see why."
            : "Tap a name to cross it off. Only you see your marks."}
        </p>
      )}

      <ClueList view={view} />
    </div>
  );
}

function ClueList({ view }: { view: PlayerView }) {
  const d = view.dossier;
  const pub = new Set(view.publicClues);
  const known = [...view.you.known].reverse(); // newest first
  const hand = new Set(view.you.hand);
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="muted small group-label">🗂️ Your intelligence ({known.length})</div>
      {known.map((c) => {
        const src = view.you.sources[c.id];
        const origin = !src
          ? pub.has(c.id)
            ? "Everyone has this"
            : "Dealt to you"
          : src.via === "draw"
            ? `Drawn after round ${src.round}`
            : src.via === "offer"
              ? `Offered by ${nameOf(view, src.from)} when you asked about ${subjectsText(d, src.subjects)}`
              : `Paid back by ${nameOf(view, src.from)} when they asked about ${subjectsText(d, src.subjects)}`;
        const where = pub.has(c.id) ? origin : `${origin} · ${hand.has(c.id) ? "in your hand" : "no longer in hand"}`;
        const fresh = src && (src.via === "draw" ? src.round === view.round - 1 : src.turn === view.turnsTaken - 1);
        return (
          <div key={c.id} className={`clue ${fresh ? "new" : ""}`}>
            <span className="row">
              <span>{clueText(d, c)}</span>
              {!pub.has(c.id) && <Pips n={c.points} />}
            </span>
            <span className="src">{where}</span>
          </div>
        );
      })}
    </div>
  );
}
