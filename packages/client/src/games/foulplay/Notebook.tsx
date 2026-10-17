import { useState } from "react";
import { answerText, clueText, type Answer, type Clue, type Dimension, type PlayerView } from "@party/foulplay";
import type { Notes } from "./solver.js";
import { cardText, howText, originText } from "./text.js";

/** On your turn, the board is also where you name an accusation for an inquest. */
export type Picking = { answer: Partial<Answer>; onPick: (dim: Dimension, value: number) => void } | null;

const ROWS: { dim: Dimension; label: string }[] = [
  { dim: "agent", label: "🕴️ Guests" },
  { dim: "device", label: "🔪 Weapons" },
  { dim: "room", label: "🚪 Rooms" },
];

function names(view: PlayerView, dim: Dimension): string[] {
  const d = view.dossier;
  if (dim === "agent") return d.agents.map((a) => a.name);
  if (dim === "device") return d.devices.map((x) => x.name);
  return d.rooms.map((r) => r.name);
}

/**
 * The board: every guest, weapon and room, crossed off as your evidence rules
 * them out, worked from everything you've seen except what you doubt.
 */
export function Board({ view, notes, picking }: { view: PlayerView; notes: Notes; picking: Picking }) {
  const { solver, analysis, base, clash, basis } = notes;
  const [why, setWhy] = useState<{ dim: Dimension; value: number } | null>(null);
  const d = view.dossier;
  const progress = base > 1 && analysis.remaining > 0 ? 1 - Math.log(analysis.remaining) / Math.log(base) : 1;
  const explanation = why ? solver.explain(basis, why.dim, why.value) : null;

  return (
    <div className="stack">
      {clash && (
        <div className="clash-box stack" style={{ gap: 6 }}>
          <b>⚠️ These cards can&apos;t all be true</b>
          <span className="muted small">
            One of them is a lie, or a plant. Doubt one in your evidence below and the board will work without it.
          </span>
          {clash.map((c) => (
            <div key={c.id} className="small">• {cardText(view, c)}</div>
          ))}
          {notes.setAside.length > 0 && (
            <span className="muted small">
              Until you decide, the board below leaves out what you saw last:{" "}
              {notes.setAside.map((c) => `“${cardText(view, c)}”`).join(" ")}
            </span>
          )}
        </div>
      )}
      <div className="card tight stack" style={{ gap: 8 }}>
        {analysis.solved ? (
          <>
            <b>🎯 Only one answer fits</b>
            <span>{answerText(d, analysis.solved)}.</span>
          </>
        ) : (
          <div className="spread">
            <b>{analysis.remaining} possible answers</b>
            <span className="muted small">of {base}</span>
          </div>
        )}
        <div className="bar">
          <div className="fill" style={{ width: `${Math.round(progress * 100)}%`, background: "var(--accent)" }} />
        </div>
      </div>

      {ROWS.map(({ dim, label }) => {
        const counts = analysis.marginals[dim];
        const open = counts.filter((n) => n > 0).length;
        return (
          <div key={dim} className="stack" style={{ gap: 6 }}>
            <div className="muted small group-label">{label}</div>
            <div className="grid-cells">
              {names(view, dim).map((name, value) => {
                const out = counts[value] === 0;
                const sure = counts[value] > 0 && open === 1;
                const dead = dim === "agent" && !view.players[value].alive;
                const picked = picking?.answer[dim] === value;
                const onClick = () => {
                  if (picking) picking.onPick(dim, value);
                  else setWhy(out && !(why?.dim === dim && why.value === value) ? { dim, value } : null);
                };
                return (
                  <button
                    key={value}
                    className={`cell ${out ? "out" : ""} ${sure ? "sure" : ""} ${picked ? "picked" : ""}`}
                    disabled={!!picking && dim === "agent" && dead}
                    onClick={onClick}
                  >
                    <span className="name">
                      {dead ? "☠️ " : ""}
                      {name}
                    </span>
                    <span className="mark">{out ? "✗" : sure ? "✓" : counts[value]}</span>
                  </button>
                );
              })}
            </div>
            {!picking && why?.dim === dim && explanation && (
              <div className="why">
                <b>Why {names(view, dim)[why.value]} is ruled out:</b>
                {explanation.length === 0 ? (
                  <div>The case file alone rules it out.</div>
                ) : (
                  explanation.map((c) => <div key={c.id}>• {cardText(view, c)}</div>)
                )}
              </div>
            )}
          </div>
        );
      })}
      {!picking && (
        <p className="muted small center" style={{ margin: 0 }}>
          Numbers are how many answers each one still appears in. Tap a crossed-off one to see why.
        </p>
      )}
    </div>
  );
}

/** One card: what it says, where it came from, how you came by it. */
export function CardView({
  view,
  clue,
  notes,
  onClick,
  selected,
}: {
  view: PlayerView;
  clue: Clue;
  notes?: Notes;
  onClick?: () => void;
  selected?: boolean;
}) {
  const doubted = notes?.doubts.has(clue.id);
  const clashing = notes?.clash?.some((c) => c.id === clue.id);
  const body = (
    <>
      <span className="row">
        <span>{clueText(view.dossier, clue)}</span>
      </span>
      <span className="src">
        {originText(view, view.origins[clue.id])}
        {view.you.how[clue.id] && view.you.how[clue.id].via !== "dealt" && view.you.how[clue.id].via !== "drew"
          ? ` · ${howText(view, view.you.how[clue.id])}`
          : ""}
      </span>
    </>
  );
  const cls = `clue ${doubted ? "doubted" : ""} ${clashing ? "clash" : ""}`;
  if (onClick)
    return (
      <button className={`${cls} pickable ${selected ? "selected" : ""}`} onClick={onClick}>
        {body}
      </button>
    );
  return (
    <div className={cls}>
      {body}
      {notes && (
        <div style={{ marginTop: 6 }}>
          <button className="ghost mini" onClick={() => notes.toggleDoubt(clue.id)}>
            {doubted ? "Trust it again" : "🤨 Doubt this"}
          </button>
        </div>
      )}
    </div>
  );
}

/** Everything you've seen: your hand, the public record, and what you were shown. */
export function Evidence({ view, notes }: { view: PlayerView; notes: Notes }) {
  const byId = new Map(view.you.known.map((c) => [c.id, c]));
  const hand = view.you.hand.map((id) => byId.get(id)!).filter(Boolean);
  const onRecord = new Set(view.record.map((r) => r.clue));
  const record = [...view.record].reverse().map((r) => byId.get(r.clue)!).filter(Boolean);
  const inHand = new Set(view.you.hand);
  const seen = [...view.you.known].reverse().filter((c) => !inHand.has(c.id) && !onRecord.has(c.id));
  const section = (title: string, list: Clue[], empty: string) => (
    <div className="stack" style={{ gap: 6 }}>
      <div className="muted small group-label">{title}</div>
      {list.length ? list.map((c) => <CardView key={c.id} view={view} clue={c} notes={notes} />) : <span className="muted small">{empty}</span>}
    </div>
  );
  return (
    <div className="stack">
      {section(`🃏 In your hand (${hand.length} of ${view.handLimit})`, hand, "Nothing in your hand.")}
      {section("📜 The public record", record, "Nobody has testified yet.")}
      {section("👀 Seen, not held", seen, "Nothing else yet.")}
    </div>
  );
}
