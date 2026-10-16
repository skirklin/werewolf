import { useEffect, useState } from "react";
import {
  answerText,
  clueText,
  sameSubject,
  type Action,
  type Answer,
  type Dimension,
  type PlayerView,
  type Subject,
} from "@party/foulplay";
import type { TableProps } from "../../shell/game.js";
import { Notebook, type Picking } from "./Notebook.js";
import { Dossier } from "./Dossier.js";
import { useAnalysis } from "./solver.js";
import { CardFan, Pips } from "./cards.js";
import { cap, cards, logText, nameOf, pts, subjectsText } from "./text.js";

type Act = (a: Action) => void;
type Tab = "notebook" | "dossier" | "log";

/** On your turn: what you're picking on the board, and what you've picked so far. */
interface TurnState {
  mode: "ask" | "accuse";
  subjects: Subject[];
  answer: Partial<Answer>;
}

/** A Foul Play game in progress, on one player's own device. */
export function FoulPlayTable({ view, room, isHost, act, playAgain, onExit }: TableProps<PlayerView, Action>) {
  const [tab, setTab] = useState<Tab>("notebook");
  const { analysis } = useAnalysis(view);
  const myTurn = view.phase.kind === "turn" && view.phase.active === view.you.seat;
  const [turn, setTurn] = useState<TurnState | null>(null);

  // A fresh turn starts in ask mode with nothing picked, on the board.
  useEffect(() => {
    setTurn(myTurn ? { mode: "ask", subjects: [], answer: {} } : null);
    if (myTurn) setTab("notebook");
  }, [myTurn, view.turnsTaken]);

  const setMode = (mode: TurnState["mode"]) => {
    setTab("notebook");
    setTurn((t) => {
      if (!t) return t;
      // With the full grid, a solved case comes pre-filled.
      const answer = mode === "accuse" && view.assist === "grid" && analysis.solved && !t.answer.agent ? analysis.solved : t.answer;
      return { ...t, mode, answer };
    });
  };

  const picking: Picking =
    turn?.mode === "ask"
      ? {
          mode: "ask",
          subjects: turn.subjects,
          onPick: (s) =>
            setTurn((t) =>
              t && {
                ...t,
                // Tap again to drop; a third pick replaces the oldest.
                subjects: t.subjects.some((x) => sameSubject(x, s))
                  ? t.subjects.filter((x) => !sameSubject(x, s))
                  : [...t.subjects, s].slice(-2),
              }
            ),
        }
      : turn?.mode === "accuse"
        ? {
            mode: "accuse",
            answer: turn.answer,
            onPick: (dim: Dimension, value: number) =>
              setTurn((t) => t && { ...t, answer: { ...t.answer, [dim]: t.answer[dim] === value ? undefined : value } }),
          }
        : null;

  return (
    <div className="stack">
      <Seats view={view} />
      {myTurn && turn ? (
        <TurnPanel view={view} act={act} turn={turn} setMode={setMode} />
      ) : (
        <ActionPanel view={view} act={act} isHost={isHost} playAgain={playAgain} onExit={onExit} />
      )}
      <div className="tabs">
        {(["notebook", "dossier", "log"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "notebook" ? "🗂️ Board" : t === "dossier" ? "📁 Dossier" : "📜 Log"}
          </button>
        ))}
      </div>
      {tab === "notebook" && <Notebook view={view} roomCode={room.code} picking={picking} />}
      {tab === "dossier" && <Dossier view={view} />}
      {tab === "log" && <Log view={view} />}
    </div>
  );
}

/** Who's at the table, whose turn it is, and how many cards each holds. */
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

  const name = (i: number) => cap(nameOf(view, view.players[i].id));
  let waiting: string;
  if (phase.kind === "turn") waiting = `${name(phase.active)} is deciding what to do.`;
  else if (phase.kind === "discard") {
    const left = view.moved!.filter((o) => !o).length;
    waiting = `End of round ${view.round}. Waiting for ${left} more to discard.`;
  } else if (phase.kind === "offers") {
    const left = view.moved!.filter((o) => !o).length;
    waiting = `${phase.active === me ? "Waiting for the table's offers" : "Waiting for the others"} (${left} still thinking).`;
  } else waiting = `${name(phase.active)} is choosing which offers to take.`;
  const mine = phase.kind === "offers" && phase.active !== me ? view.yours : null;
  return (
    <div className="card stack">
      <LastNews view={view} />
      {mine && (
        <div className="spread">
          <span className="muted small">You offered</span>
          <CardFan count={mine.length} points={mine.reduce((n, id) => n + clueOf(view, id).points, 0)} />
        </div>
      )}
      <p className="muted center" style={{ margin: 0 }}>{waiting}</p>
    </div>
  );
}

const clueOf = (view: PlayerView, id: number) => view.you.known.find((c) => c.id === id)!;

/** The latest public event, and the clues it brought me, if any. */
function LastNews({ view }: { view: PlayerView }) {
  const { solver } = useAnalysis(view);
  const last = view.log[view.log.length - 1];
  if (!last) return <p className="muted small" style={{ margin: 0 }}>The investigation is under way. Nobody has asked anything yet.</p>;
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
  if (last.t === "offers" && last.offers.some((o) => o.cards))
    return (
      <div className="stack" style={{ gap: 6 }}>
        <span className="muted small">The offers are in:</span>
        <OfferList view={view} offers={last.offers.filter((o) => o.cards)} />
      </div>
    );
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="muted small">{logText(view, last)}</span>
      {fresh.map((c) => (
        <div key={c.id} className="clue new">
          <span className="row">
            <span>{clueText(view.dossier, c)}</span>
            <Pips n={c.points} />
          </span>
        </div>
      ))}
      {narrowed && <span className="muted small">{narrowed}</span>}
    </div>
  );
}

/** Each offer as a fan of face-down cards. */
function OfferList({ view, offers }: { view: PlayerView; offers: { who: string; cards: number; points: number }[] }) {
  return (
    <div className="offer-list">
      {offers.map((o) => (
        <div key={o.who} className="offer-row spread">
          <b>{cap(nameOf(view, o.who))}</b>
          <CardFan count={o.cards} points={o.points} />
        </div>
      ))}
    </div>
  );
}

/**
 * Your turn. The picking happens on the board below; this shows what's been
 * picked and sends it.
 */
function TurnPanel({
  view,
  act,
  turn,
  setMode,
}: {
  view: PlayerView;
  act: Act;
  turn: TurnState;
  setMode: (m: TurnState["mode"]) => void;
}) {
  const { solver, analysis } = useAnalysis(view);
  const [confirm, setConfirm] = useState(false);
  const d = view.dossier;
  const { subjects, answer } = turn;
  const full =
    answer.agent !== undefined && answer.device !== undefined && answer.room !== undefined ? (answer as Answer) : null;
  // With the full grid, warn before accusing something the notebook rules out.
  const impossible =
    full && view.assist === "grid" && !solver.space.answers(analysis.candidates).includes(solver.space.keyOf(full));

  return (
    <div className="card stack">
      <LastNews view={view} />
      <b>Your turn</b>
      <div className="btn-row">
        <button className={turn.mode === "ask" ? "primary" : ""} onClick={() => setMode("ask")}>
          🗣️ Ask the table
        </button>
        <button className={turn.mode === "accuse" ? "primary" : ""} onClick={() => setMode("accuse")}>
          ☝️ Accuse
        </button>
      </div>

      {turn.mode === "ask" ? (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            Tap two subjects on the board below. Everyone else may offer you cards about either one; you pay back what
            you take with at least as many points.
          </p>
          <button
            className="primary full lg"
            disabled={subjects.length !== 2}
            onClick={() => subjects.length === 2 && act({ type: "ask", subjects: [subjects[0], subjects[1]] })}
          >
            {subjects.length === 2
              ? `Ask about ${subjectsText(d, subjects)}`
              : subjects.length === 1
                ? `${cap(subjectsText(d, subjects))}, and…`
                : "Pick two subjects below"}
          </button>
        </>
      ) : (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            Tap who, with what and where on the board below.{" "}
            {view.mode === "coop"
              ? "The table gets one accusation. If it's wrong, the killer gets away."
              : "If you're wrong, you're out of the running, though you still trade."}
          </p>
          <div className="pick-summary">
            <span className="pill">{answer.agent !== undefined ? d.agents[answer.agent].name : "who?"}</span>
            <span className="pill">{answer.device !== undefined ? d.devices[answer.device].name : "with what?"}</span>
            <span className="pill">{answer.room !== undefined ? d.rooms[answer.room].name : "where?"}</span>
          </div>
          {impossible && <p className="err" style={{ margin: 0 }}>Your notebook says it can't be that.</p>}
          {!confirm ? (
            <button className="danger full lg" disabled={!full} onClick={() => setConfirm(true)}>
              Accuse
            </button>
          ) : (
            <div className="stack">
              <b className="center">{full && answerText(d, full)}?</b>
              <div className="btn-row">
                <button onClick={() => setConfirm(false)}>Not yet</button>
                <button className="danger" onClick={() => full && act({ type: "accuse", answer: full })}>
                  Yes, accuse
                </button>
              </div>
            </div>
          )}
        </>
      )}
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
            <Pips n={clueOf(view, id).points} />
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
                  <b>{cap(name)}</b>
                  <span className="src">{on ? "✓ Taking" : canAfford ? "Tap to take" : "Your hand isn't worth that much"}</span>
                </span>
                <CardFan count={c.cards} points={c.points} />
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
                        <Pips n={clueOf(view, id).points} />
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
            <Pips n={clueOf(view, id).points} />
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
        ? "🎉 The table caught the killer"
        : won
          ? "🎉 You caught the killer"
          : `🔍 ${cap(winnerNames[0])} caught the killer`
      : phase.reason === "outOfTime"
        ? "⌛ Out of time. The killer got away"
        : phase.reason === "wrongAccusation"
          ? "💨 Wrong accusation. The killer slipped away"
          : "💨 Every accusation was wrong. The killer slipped away";
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
