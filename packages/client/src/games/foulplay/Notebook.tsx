import { clueText, type Answer, type Clue, type Dimension, type PlayerView } from "@party/foulplay";
import type { Notes } from "./solver.js";
import { cardKind, sourceText } from "./text.js";

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
 * The board: every guest, weapon and room, for you to cross off or circle as
 * you go. It never works anything out for you: seeing it is your job.
 */
export function Board({ view, notes, picking }: { view: PlayerView; notes: Notes; picking: Picking }) {
  const story = view.you.story;
  return (
    <div className="stack">
      {ROWS.map(({ dim, label }) => (
        <div key={dim} className="stack" style={{ gap: 6 }}>
          <div className="muted small group-label">{label}</div>
          <div className="grid-cells">
            {names(view, dim).map((name, value) => {
              const mark = notes.markOf(dim, value);
              const dead = dim === "agent" && !view.players[value].alive;
              const picked = picking?.answer[dim] === value;
              const yours = story[dim] === value;
              return (
                <button
                  key={value}
                  className={`cell ${mark === "out" || dead ? "out" : ""} ${mark === "maybe" ? "sure" : ""} ${picked ? "picked" : ""}`}
                  disabled={!!picking && dim === "agent" && dead}
                  onClick={() => (picking ? picking.onPick(dim, value) : notes.cycle(dim, value))}
                >
                  <span className="name">
                    {dead ? "☠️ " : ""}
                    {name}
                  </span>
                  <span className="mark">{mark === "out" || dead ? "✗" : mark === "maybe" ? "?" : yours ? "•" : ""}</span>
                </button>
              );
            })}
          </div>
        </div>
      ))}
      {!picking && (
        <p className="muted small center" style={{ margin: 0 }}>
          Tap to cross off (✗), tap again to suspect (?), again to clear. • marks the case against you. Only you see this.
        </p>
      )}
    </div>
  );
}

/** One card: what it says, where it came from, how you came by it. */
export function CardView({
  view,
  clue,
  onClick,
  selected,
}: {
  view: PlayerView;
  clue: Clue;
  onClick?: () => void;
  selected?: boolean;
}) {
  const k = cardKind(clue);
  const body = (
    <>
      <span className={`card-kind ${k.tone}`}>
        {k.icon} {k.label}
      </span>
      <span className="row">
        <span>{clueText(view.dossier, clue)}</span>
      </span>
      <span className="src">{sourceText(view, clue.id)}</span>
    </>
  );
  const cls = `clue kind-${k.tone}`;
  if (onClick)
    return (
      <button className={`${cls} pickable ${selected ? "selected" : ""}`} onClick={onClick}>
        {body}
      </button>
    );
  return <div className={cls}>{body}</div>;
}

/** Everything you've seen: your hand, and the public record. Every card is true; the question is who's seen it. */
export function Evidence({ view }: { view: PlayerView }) {
  const byId = new Map(view.you.known.map((c) => [c.id, c]));
  const hand = view.you.hand.map((id) => byId.get(id)!).filter(Boolean);
  const onRecord = new Set(view.record.map((r) => r.clue));
  const record = [...view.record].reverse().map((r) => byId.get(r.clue)!).filter(Boolean);
  const inHand = new Set(view.you.hand);
  const seen = [...view.you.known].reverse().filter((c) => !inHand.has(c.id) && !onRecord.has(c.id));
  const section = (title: string, list: Clue[], empty: string) => (
    <div className="stack" style={{ gap: 6 }}>
      <div className="muted small group-label">{title}</div>
      {list.length ? list.map((c) => <CardView key={c.id} view={view} clue={c} />) : <span className="muted small">{empty}</span>}
    </div>
  );
  return (
    <div className="stack">
      {section(`🃏 In your hand (${hand.length})`, hand, "Nothing in your hand.")}
      {section("📜 The public record", record, "Nothing on the record yet.")}
      {seen.length > 0 && section("👀 Seen, not held", seen, "")}
    </div>
  );
}
