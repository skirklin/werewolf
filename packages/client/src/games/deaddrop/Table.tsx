import { useState } from "react";
import {
  answerText,
  clueText,
  type Action,
  type Answer,
  type PlayerView,
  type Subject,
} from "@party/deaddrop";
import type { TableProps } from "../../shell/game.js";
import { Notebook } from "./Notebook.js";
import { Dossier } from "./Dossier.js";
import { SubjectPicker, ChoiceRow } from "./pickers.js";
import { useAnalysis } from "./solver.js";
import { cap, cards, logText, nameOf, pts, subjectsText } from "./text.js";

type Act = (a: Action) => void;
type Tab = "notebook" | "dossier" | "log";

/** A Dead Drop game in progress, on one player's own device. */
export function DeadDropTable({ view, room, isHost, act, playAgain, onExit }: TableProps<PlayerView, Action>) {
  const [tab, setTab] = useState<Tab>("notebook");
  return (
    <div className="stack">
      <Seats view={view} />
      <ActionPanel view={view} act={act} isHost={isHost} playAgain={playAgain} onExit={onExit} />
      <div className="tabs">
        {(["notebook", "dossier", "log"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "notebook" ? "🗂️ Notebook" : t === "dossier" ? "📁 Dossier" : "📜 Log"}
          </button>
        ))}
      </div>
      {tab === "notebook" && <Notebook view={view} roomCode={room.code} />}
      {tab === "dossier" && <Dossier view={view} />}
      {tab === "log" && <Log view={view} />}
    </div>
  );
}

/** Who's at the table, whose turn it is, and how much intel each holds. */
function Seats({ view }: { view: PlayerView }) {
  const phase = view.phase;
  const active = "active" in phase ? phase.active : -1;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="seats">
        {view.players.map((p, i) => {
          // While the table offers, show who's still thinking.
          const mark = i === active ? "▶" : view.moved ? (view.moved[i] ? "✓" : "…") : "🕴️";
          return (
            <span key={p.id} className={`seat ${i === active ? "active" : ""} ${p.out ? "out" : ""}`}>
              {mark} {p.id === view.you.id ? "You" : p.name}
              <span className="muted">· 🂠{p.handSize}</span>
            </span>
          );
        })}
      </div>
      <span className="muted small">
        Round {view.round} · {cards(view.deckLeft)} in the deck
        {view.mode === "coop" && view.turnLimit !== null &&
          ` · co-op turn ${Math.min(view.turnsTaken + 1, view.turnLimit)} of ${view.turnLimit}`}
      </span>
    </div>
  );
}

function ActionPanel({
  view,
  act,
  isHost,
  playAgain,
  onExit,
}: {
  view: PlayerView;
  act: Act;
  isHost: boolean;
  playAgain: () => void;
  onExit: () => void;
}) {
  const phase = view.phase;
  const me = view.you.seat;
  if (phase.kind === "over") return <GameOver view={view} isHost={isHost} playAgain={playAgain} onExit={onExit} />;
  if (view.canOffer) return <OfferPanel view={view} act={act} />;
  if (view.choices) return <ChoosePanel view={view} act={act} />;
  if (view.mustDiscard !== null) return <DiscardPanel view={view} act={act} />;
  if (phase.kind === "turn" && phase.active === me) return <MyTurn view={view} act={act} />;

  const name = (i: number) => cap(nameOf(view, view.players[i].id));
  let waiting: string;
  if (phase.kind === "turn") waiting = `${name(phase.active)} is deciding what to do.`;
  else if (phase.kind === "discard") {
    const left = view.moved!.filter((o) => !o).length;
    waiting = `End of round ${view.round}. Waiting for ${left} more to discard.`;
  } else if (phase.kind === "offers") {
    const left = view.moved!.filter((o) => !o).length;
    const mine = view.yours;
    waiting =
      (phase.active === me
        ? "Waiting for the table's offers"
        : mine
          ? `You offered ${mine.length ? `${pts(mine.reduce((n, id) => n + clueOf(view, id).points, 0))} on ${cards(mine.length)}` : "nothing"}. Waiting for the others`
          : "Waiting for offers") + ` (${left} still thinking).`;
  } else waiting = `${name(phase.active)} is choosing which offers to take.`;
  return (
    <div className="card stack">
      <LastNews view={view} />
      <p className="muted center" style={{ margin: 0 }}>{waiting}</p>
    </div>
  );
}

const clueOf = (view: PlayerView, id: number) => view.you.known.find((c) => c.id === id)!;

/** The latest public event, and the clues it brought me, if any. */
function LastNews({ view }: { view: PlayerView }) {
  const { solver } = useAnalysis(view);
  const last = view.log[view.log.length - 1];
  if (!last) return <p className="muted small" style={{ margin: 0 }}>The reception is under way. Nobody has asked anything yet.</p>;
  // Clues that reached me on the turn that just ended.
  const fresh = view.you.known.filter((c) => {
    const src = view.you.sources[c.id];
    if (!src) return false;
    if (last.t === "round") return src.via === "draw" && src.round === last.round;
    return (last.t === "deal" || last.t === "noDeal") && src.via !== "draw" && src.turn === view.turnsTaken - 1;
  });
  let narrowed: string | null = null;
  if (fresh.length && view.assist !== "notes") {
    const ids = new Set(fresh.map((c) => c.id));
    const before = solver.remaining(view.you.known.filter((c) => !ids.has(c.id)));
    const after = solver.remaining(view.you.known);
    narrowed = before === after ? "They didn't narrow anything down." : `They ruled out ${before - after} of ${before} answers.`;
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="muted small">{logText(view, last)}</span>
      {fresh.map((c) => (
        <div key={c.id} className="clue new">
          {clueText(view.dossier, c)}
          <span className="pts">{c.points}</span>
        </div>
      ))}
      {narrowed && <span className="muted small">{narrowed}</span>}
    </div>
  );
}

function MyTurn({ view, act }: { view: PlayerView; act: Act }) {
  const [mode, setMode] = useState<"ask" | "accuse">("ask");
  return (
    <div className="card stack">
      <LastNews view={view} />
      <b>Your turn</b>
      <div className="btn-row">
        <button className={mode === "ask" ? "primary" : ""} onClick={() => setMode("ask")}>
          🗣️ Ask the table
        </button>
        <button className={mode === "accuse" ? "primary" : ""} onClick={() => setMode("accuse")}>
          ☝️ Accuse
        </button>
      </div>
      {mode === "ask" ? <AskForm view={view} act={act} /> : <AccuseForm view={view} act={act} />}
    </div>
  );
}

function AskForm({ view, act }: { view: PlayerView; act: Act }) {
  const [subjects, setSubjects] = useState<Subject[]>([]);
  const ready = subjects.length === 2;
  return (
    <div className="stack">
      <p className="muted small" style={{ margin: 0 }}>
        Pick two subjects. Everyone else may offer you clues about either one, and you pay back whatever you accept
        with at least as many points.
      </p>
      <SubjectPicker dossier={view.dossier} value={subjects} onChange={setSubjects} />
      <button
        className="primary full lg"
        disabled={!ready}
        onClick={() => ready && act({ type: "ask", subjects: [subjects[0], subjects[1]] })}
      >
        {ready ? `Ask about ${subjectsText(view.dossier, subjects)}` : `Pick ${2 - subjects.length} more`}
      </button>
    </div>
  );
}

/** Someone asked the table: choose what, if anything, to offer them. */
function OfferPanel({ view, act }: { view: PlayerView; act: Act }) {
  const phase = view.phase as Extract<PlayerView["phase"], { kind: "offers" }>;
  const [picked, setPicked] = useState<number[]>([]);
  const asker = nameOf(view, view.players[phase.active].id);
  const total = picked.reduce((n, id) => n + clueOf(view, id).points, 0);
  const toggle = (id: number) => setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : [...p, id]));
  return (
    <div className="card stack">
      <LastNews view={view} />
      <b>
        {cap(asker)} asks about {subjectsText(view.dossier, phase.subjects)}
      </b>
      <p className="muted small" style={{ margin: 0 }}>
        Offer any of these cards from your hand. The table only sees the total points and number of cards. If {asker}{" "}
        takes them, the cards go to {asker}, who pays you back with at least as many points.
      </p>
      {view.canOffer!.map((id) => (
        <button key={id} className={`clue pickable ${picked.includes(id) ? "selected" : ""}`} onClick={() => toggle(id)}>
          <span className="row">
            <span>{clueText(view.dossier, clueOf(view, id))}</span>
            <span className="pts">{clueOf(view, id).points}</span>
          </span>
        </button>
      ))}
      <div className="btn-row">
        <button onClick={() => act({ type: "offer", clueIds: [] })}>Offer nothing</button>
        <button className="primary" disabled={!picked.length} onClick={() => act({ type: "offer", clueIds: picked })}>
          {picked.length ? `Offer ${pts(total)}` : "Pick clues to offer"}
        </button>
      </div>
    </div>
  );
}

/** The asker's choice: which offers to take, and what to pay each back with. */
function ChoosePanel({ view, act }: { view: PlayerView; act: Act }) {
  const choices = view.choices!;
  const [pay, setPay] = useState<Record<string, number[]>>({});
  const [taking, setTaking] = useState<Record<string, boolean>>({});
  const points = (list: number[]) => list.reduce((n, id) => n + clueOf(view, id).points, 0);
  const paid = (from: string) => points(pay[from] ?? []);
  // A card can only pay one person.
  const spentElsewhere = (from: string) =>
    new Set(Object.entries(pay).flatMap(([k, v]) => (k !== from && taking[k] ? v : [])));
  const deals = choices.filter((c) => taking[c.from]).map((c) => ({ from: c.from, payback: pay[c.from] ?? [] }));
  const short = choices.filter((c) => taking[c.from] && paid(c.from) < c.points);
  const togglePay = (from: string, id: number) =>
    setPay((p) => {
      const cur = p[from] ?? [];
      return { ...p, [from]: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] };
    });
  const handPoints = points(view.you.hand);

  return (
    <div className="card stack">
      <LastNews view={view} />
      <b>Choose which offers to take</b>
      <p className="muted small" style={{ margin: 0 }}>
        You see the cards once you take an offer. Pay each one back from your hand with at least as many points;
        fewer cards is fine. A card they've seen before still counts, if you're feeling mean.
      </p>
      {choices.map((c) => {
        const name = nameOf(view, c.from);
        const on = !!taking[c.from];
        const elsewhere = spentElsewhere(c.from);
        const canAfford = handPoints >= c.points;
        return (
          <div key={c.from} className="stack" style={{ gap: 6 }}>
            <button
              className={`clue pickable ${on ? "selected" : ""}`}
              disabled={!canAfford}
              onClick={() => setTaking((t) => ({ ...t, [c.from]: !on }))}
            >
              <span className="row">
                <span>
                  <b>{cap(name)}</b> offers {pts(c.points)} on {cards(c.cards)}
                  {!canAfford && <span className="src">Your hand isn't worth that much.</span>}
                </span>
                <span>{on ? "✓ Taking" : "Take"}</span>
              </span>
            </button>
            {on && (
              <div className="stack" style={{ gap: 6, paddingLeft: 12 }}>
                <span className="muted small">
                  Pay {name} back: {paid(c.from)} of {c.points} points chosen
                </span>
                {view.you.hand
                  .filter((id) => !elsewhere.has(id))
                  .map((id) => (
                    <button
                      key={id}
                      className={`clue pickable ${(pay[c.from] ?? []).includes(id) ? "selected" : ""}`}
                      onClick={() => togglePay(c.from, id)}
                    >
                      <span className="row">
                        <span>{clueText(view.dossier, clueOf(view, id))}</span>
                        <span className="pts">{clueOf(view, id).points}</span>
                      </span>
                    </button>
                  ))}
              </div>
            )}
          </div>
        );
      })}
      <button className="primary full lg" disabled={short.length > 0} onClick={() => act({ type: "accept", deals })}>
        {short.length
          ? `Pay ${nameOf(view, short[0].from)} at least ${pts(short[0].points)}`
          : deals.length
            ? `Trade with ${deals.map((d) => nameOf(view, d.from)).join(" and ")}`
            : "Take nothing"}
      </button>
    </div>
  );
}

/** End of a round: choose which half of your hand goes back under the deck. */
function DiscardPanel({ view, act }: { view: PlayerView; act: Act }) {
  const need = view.mustDiscard!;
  const [picked, setPicked] = useState<number[]>([]);
  const toggle = (id: number) =>
    setPicked((p) => (p.includes(id) ? p.filter((x) => x !== id) : p.length < need ? [...p, id] : p));
  return (
    <div className="card stack">
      <LastNews view={view} />
      <b>End of round {view.round}: discard {cards(need)}</b>
      <p className="muted small" style={{ margin: 0 }}>
        Your notebook keeps everything you've seen; this only decides what you can still trade. Discards go under the
        deck, and you'll draw the same number of fresh cards.
      </p>
      {view.you.hand.map((id) => (
        <button key={id} className={`clue pickable ${picked.includes(id) ? "selected" : ""}`} onClick={() => toggle(id)}>
          <span className="row">
            <span>{clueText(view.dossier, clueOf(view, id))}</span>
            <span className="pts">{clueOf(view, id).points}</span>
          </span>
        </button>
      ))}
      <button
        className="primary full lg"
        disabled={picked.length !== need}
        onClick={() => act({ type: "discard", clueIds: picked })}
      >
        {picked.length === need ? `Discard ${cards(need)}` : `Pick ${need - picked.length} more`}
      </button>
    </div>
  );
}

function AccuseForm({ view, act }: { view: PlayerView; act: Act }) {
  const { analysis } = useAnalysis(view);
  const d = view.dossier;
  const auto = view.assist === "grid";
  const start = auto ? analysis.solved : null;
  const [agent, setAgent] = useState<number | null>(start?.agent ?? null);
  const [device, setDevice] = useState<number | null>(start?.device ?? null);
  const [room, setRoom] = useState<number | null>(start?.room ?? null);
  const [hour, setHour] = useState<number | null>(start?.hour ?? null);
  const [confirm, setConfirm] = useState(false);
  const m = analysis.marginals;
  const out = (dim: keyof typeof m, i: number) => auto && m[dim][i] === 0;
  const answer: Answer | null =
    agent !== null && device !== null && room !== null && hour !== null ? { agent, device, room, hour } : null;
  const stakes =
    view.mode === "coop"
      ? "The table gets one accusation. If it's wrong, the mole gets away."
      : "If you're wrong, you're out of the running, though you still answer questions.";

  return (
    <div className="stack">
      <ChoiceRow<number> label="Who" value={agent} onChange={setAgent}
        options={d.agents.map((a) => ({ id: a.id, label: a.name, ruledOut: out("agent", a.id) }))} />
      <ChoiceRow<number> label="With what" value={device} onChange={setDevice}
        options={d.devices.map((x) => ({ id: x.id, label: x.name, ruledOut: out("device", x.id) }))} />
      <ChoiceRow<number> label="Where" value={room} onChange={setRoom}
        options={d.rooms.map((r) => ({ id: r.id, label: r.name, ruledOut: out("room", r.id) }))} />
      <ChoiceRow<number> label="When" value={hour} onChange={setHour}
        options={d.hours.map((h, i) => ({ id: i, label: h, ruledOut: out("hour", i) }))} />
      <p className="muted small" style={{ margin: 0 }}>{stakes}</p>
      {!confirm ? (
        <button className="danger full lg" disabled={!answer} onClick={() => setConfirm(true)}>
          Accuse
        </button>
      ) : (
        <div className="stack">
          <b className="center">{answer && answerText(d, answer)}?</b>
          <div className="btn-row">
            <button onClick={() => setConfirm(false)}>Not yet</button>
            <button className="danger" onClick={() => answer && act({ type: "accuse", answer })}>
              Yes, accuse
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function GameOver({
  view,
  isHost,
  playAgain,
  onExit,
}: {
  view: PlayerView;
  isHost: boolean;
  playAgain: () => void;
  onExit: () => void;
}) {
  const phase = view.phase as Extract<PlayerView["phase"], { kind: "over" }>;
  const won = phase.winners.includes(view.you.id);
  const winnerNames = phase.winners.map((id) => nameOf(view, id));
  const headline =
    phase.reason === "solved"
      ? view.mode === "coop"
        ? "🎉 The table unmasked the mole"
        : won
          ? "🎉 You unmasked the mole"
          : `🕵️ ${cap(winnerNames[0])} unmasked the mole`
      : phase.reason === "outOfTime"
        ? "⌛ Out of time. The handler got away"
        : phase.reason === "wrongAccusation"
          ? "💨 Wrong accusation. The mole slipped away"
          : "💨 Every accusation was wrong. The mole slipped away";
  return (
    <div className="card stack center">
      <h2>{headline}</h2>
      {view.answer && <p style={{ margin: 0 }}>It was {answerText(view.dossier, view.answer)}.</p>}
      <span className="muted small">{view.turnsTaken} turns</span>
      {isHost ? (
        <button className="primary full lg" onClick={playAgain}>
          New case, same table
        </button>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>The host can deal a new case.</p>
      )}
      <button className="ghost full" onClick={onExit}>
        Leave
      </button>
    </div>
  );
}

function Log({ view }: { view: PlayerView }) {
  if (!view.log.length) return <p className="muted center">Nothing has happened yet.</p>;
  return (
    <div className="log">
      {[...view.log].reverse().map((e, i) => (
        <div key={view.log.length - i} className={`entry ${e.t === "accuse" ? "big" : ""}`}>
          {logText(view, e)}
        </div>
      ))}
    </div>
  );
}
