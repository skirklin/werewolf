import { useState } from "react";
import {
  answerText,
  categoryOf,
  clueText,
  subjectText,
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
import { cap, logText, nameOf, CATEGORY_LABEL } from "./text.js";

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
        {view.players.map((p, i) => (
          <span key={p.id} className={`seat ${i === active ? "active" : ""} ${p.out ? "out" : ""}`}>
            {i === active ? "▶" : "🕴️"} {p.id === view.you.id ? "You" : p.name}
            <span className="muted">· {p.knownCount}</span>
          </span>
        ))}
      </div>
      {view.mode === "coop" && view.turnLimit !== null && (
        <span className="muted small">
          Co-op · turn {Math.min(view.turnsTaken + 1, view.turnLimit)} of {view.turnLimit}
        </span>
      )}
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
  if (view.mustGive) return <GivePanel view={view} act={act} />;
  if (phase.kind === "turn" && phase.active === me) return <MyTurn view={view} act={act} />;
  if (phase.kind === "counter" && phase.by === me)
    return (
      <div className="card stack">
        <LastNews view={view} />
        <b>Your turn to ask {nameOf(view, view.players[phase.active].id)} something back</b>
        <AskForm view={view} act={act} fixedTarget={view.players[phase.active].id} />
        <button className="ghost full" onClick={() => act({ type: "decline" })}>
          Don&apos;t ask anything
        </button>
      </div>
    );

  const name = (i: number) => cap(nameOf(view, view.players[i].id));
  const waiting =
    phase.kind === "turn"
      ? `${name(phase.active)} is deciding what to do.`
      : phase.kind === "answer"
        ? `${name(phase.from)} is choosing a clue for ${nameOf(view, view.players[phase.to].id)}.`
        : `${name(phase.by)} may ask ${nameOf(view, view.players[phase.active].id)} something back.`;
  return (
    <div className="card stack">
      <LastNews view={view} />
      <p className="muted center" style={{ margin: 0 }}>{waiting}</p>
    </div>
  );
}

/** The latest public event, and, if it was a clue handed to me, what it says. */
function LastNews({ view }: { view: PlayerView }) {
  const { solver } = useAnalysis(view);
  const last = view.log[view.log.length - 1];
  if (!last) return <p className="muted small" style={{ margin: 0 }}>The reception is under way. Nobody has asked anything yet.</p>;
  const mine = last.t === "gave" && last.to === view.you.id;
  const clue = mine ? view.you.known[view.you.known.length - 1] : null;
  let narrowed: string | null = null;
  if (clue && view.assist !== "notes") {
    const before = solver.remaining(view.you.known.slice(0, -1));
    const after = solver.remaining(view.you.known);
    narrowed = before === after ? "It didn't narrow anything down." : `It ruled out ${before - after} of ${before} answers.`;
  }
  return (
    <div className="stack" style={{ gap: 6 }}>
      <span className="muted small">{logText(view, last)}</span>
      {clue && (
        <div className="clue new">
          {clueText(view.dossier, clue)}
          {narrowed && <span className="src">{narrowed}</span>}
        </div>
      )}
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
          🗣️ Ask
        </button>
        <button className={mode === "accuse" ? "primary" : ""} onClick={() => setMode("accuse")}>
          ☝️ Accuse
        </button>
      </div>
      {mode === "ask" ? <AskForm view={view} act={act} /> : <AccuseForm view={view} act={act} />}
    </div>
  );
}

function AskForm({ view, act, fixedTarget }: { view: PlayerView; act: Act; fixedTarget?: string }) {
  const others = view.players.filter((p) => p.id !== view.you.id);
  const [target, setTarget] = useState<string | null>(fixedTarget ?? (others.length === 1 ? others[0].id : null));
  const [subject, setSubject] = useState<Subject | null>(null);
  return (
    <div className="stack">
      {!fixedTarget && (
        <ChoiceRow<string>
          label="Ask whom"
          options={others.map((p) => ({ id: p.id, label: p.name + (p.out ? " (out)" : "") }))}
          value={target}
          onChange={setTarget}
        />
      )}
      <SubjectPicker dossier={view.dossier} value={subject} onChange={setSubject} />
      {subject && (
        <p className="muted small" style={{ margin: 0 }}>
          If they have nothing new on {subjectText(view.dossier, subject)}, they must give you something about{" "}
          {CATEGORY_LABEL[categoryOf(subject)]} instead.
        </p>
      )}
      <button
        className="primary full lg"
        disabled={!target || !subject}
        onClick={() => target && subject && act({ type: "ask", target, subject })}
      >
        {target && subject
          ? `Ask ${nameOf(view, target)} about ${subjectText(view.dossier, subject)}`
          : "Pick someone and a subject"}
      </button>
    </div>
  );
}

function GivePanel({ view, act }: { view: PlayerView; act: Act }) {
  const phase = view.phase as Extract<PlayerView["phase"], { kind: "answer" }>;
  const { ids, fallback } = view.mustGive!;
  const [pick, setPick] = useState<number | null>(ids.length === 1 ? ids[0] : null);
  const asker = nameOf(view, view.players[phase.to].id);
  const about = subjectText(view.dossier, phase.subject);
  return (
    <div className="card stack">
      <b>
        {cap(asker)} asked you about {about}
      </b>
      <p className="muted small" style={{ margin: 0 }}>
        {fallback
          ? `You've nothing new for them on ${about}, so you must give something about ${
              CATEGORY_LABEL[categoryOf(phase.subject)]
            }. Everyone will see that you did.`
          : "Choose which clue to hand over. They keep it; so do you."}
      </p>
      {ids.map((id) => {
        const clue = view.you.known.find((c) => c.id === id)!;
        return (
          <button key={id} className={`clue pickable ${pick === id ? "selected" : ""}`} onClick={() => setPick(id)}>
            {clueText(view.dossier, clue)}
          </button>
        );
      })}
      <button className="primary full lg" disabled={pick === null} onClick={() => pick !== null && act({ type: "give", clueId: pick })}>
        Hand it over
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
