import { useEffect, useState } from "react";
import {
  answerText,
  clueText,
  leadKey,
  leadText,
  sameLead,
  type Action,
  type Answer,
  type Dimension,
  type Lead,
  type PlayerView,
  type Tampering,
} from "@party/foulplay";
import type { TableProps } from "../../shell/game.js";
import { Board, CardView, Evidence, type Picking } from "./Notebook.js";
import { Dossier } from "./Dossier.js";
import { useNotes, type Notes } from "./solver.js";
import { PART_LABEL, cap, cards, logText, nameOf, optionName, seatName } from "./text.js";

type Act = (a: Action) => void;
type Tab = "board" | "evidence" | "case" | "log";

/** A Foul Play game in progress, on one player's own device. */
export function FoulPlayTable({ view, room, isHost, act, playAgain, onExit }: TableProps<PlayerView, Action>) {
  const notes = useNotes(view, room.code);
  const [tab, setTab] = useState<Tab>("board");
  const phase = view.phase;
  const choosing = phase.kind === "turn" && phase.active === view.you.seat && phase.step === "investigate";
  // Calling an inquest: the accusation is picked on the board.
  const [inquest, setInquest] = useState<Partial<Answer> | null>(null);
  useEffect(() => {
    if (!choosing) setInquest(null);
  }, [choosing]);

  const picking: Picking = inquest
    ? {
        answer: inquest,
        onPick: (dim: Dimension, value: number) =>
          setInquest((a) => a && { ...a, [dim]: a[dim] === value ? undefined : value }),
      }
    : null;

  return (
    <div className="stack">
      <Seats view={view} />
      <RolePanel view={view} />
      <ActionPanel
        view={view}
        notes={notes}
        act={act}
        isHost={isHost}
        playAgain={playAgain}
        onExit={onExit}
        inquest={inquest}
        startInquest={() => {
          setInquest(notes.analysis.solved ?? {});
          setTab("board");
        }}
        stopInquest={() => setInquest(null)}
      />
      <div className="tabs">
        {(["board", "evidence", "case", "log"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "board" ? "🗂️ Board" : t === "evidence" ? `🃏 Evidence` : t === "case" ? "📁 Case" : "📜 Log"}
          </button>
        ))}
      </div>
      {tab === "board" && <Board view={view} notes={notes} picking={picking} />}
      {tab === "evidence" && <Evidence view={view} notes={notes} />}
      {tab === "case" && <Dossier view={view} />}
      {tab === "log" && <Log view={view} />}
    </div>
  );
}

/** Who's at the table, whose turn it is, and who's still to vote. */
function Seats({ view }: { view: PlayerView }) {
  const phase = view.phase;
  const active = "active" in phase ? phase.active : -1;
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="seats">
        {view.players.map((p, i) => {
          const mark = !p.alive ? "☠️" : i === active ? "▶" : view.voted ? (view.voted[i] ? "✓" : "…") : "🕴️";
          return (
            <span key={p.id} className={`seat ${i === active ? "active" : ""} ${p.alive ? "" : "out"}`}>
              {mark} {seatName(view, i)}
              <span className="muted"> · 🂠{p.handSize}</span>
            </span>
          );
        })}
      </div>
      <span className="muted small">
        {phase.kind === "vote" || (phase.kind === "over" && phase.by === "dawn")
          ? "Dawn"
          : `Night, round ${view.round} of ${view.rounds}`}
      </span>
    </div>
  );
}

/** Your role, hidden until you tap, so a neighbour can't read it off your screen. */
function RolePanel({ view }: { view: PlayerView }) {
  const [open, setOpen] = useState(false);
  const d = view.dossier;
  const g = view.guilty;
  const me = d.agents[view.you.seat].name;
  if (!open)
    return (
      <button className="ghost full" onClick={() => setOpen(true)}>
        🔒 You are {me}. Tap to see your role.
      </button>
    );
  return (
    <div className={`card stack role ${g ? "guilty" : ""}`} style={{ gap: 6 }}>
      <div className="spread">
        <b>
          {view.you.role === "killer"
            ? "🔪 You are the killer"
            : view.you.role === "accomplice"
              ? "🤝 You are the accomplice"
              : "🕊️ You are innocent"}
        </b>
        <button className="ghost mini" onClick={() => setOpen(false)}>Hide</button>
      </div>
      {!g && (
        <span className="muted small">
          You know you didn&apos;t do it. Find out who did, with what and where, before dawn.
        </span>
      )}
      {g?.answer && <span>It was you, {answerText(d, g.answer).replace(/^[^,]+, /, "")}.</span>}
      {g && view.you.role === "killer" && (
        <span className="muted small">
          {g.accomplice !== null ? `Your accomplice is ${seatName(view, g.accomplice)}.` : "You have no accomplice."}{" "}
          You win unless the table names all three at dawn.
        </span>
      )}
      {g && view.you.role === "accomplice" && (
        <span className="muted small">
          {seatName(view, g.killer)} did it. You don&apos;t know with what or where. You win with them.
        </span>
      )}
      {g && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="muted small">
            Forgeries ({g.plantsLeft} left to plant). Plant one by following its lead and tampering instead of drawing.
          </span>
          {g.forgeries.map(({ forgery, planted, card }) => {
            return (
              <div key={forgery.clue} className={`clue ${planted ? "doubted" : ""}`}>
                <span className="row">
                  <span>{clueText(d, card)}</span>
                </span>
                <span className="src">
                  {planted ? "✓ Planted · " : ""}
                  {leadText(d, forgery.lead)}
                </span>
              </div>
            );
          })}
        </div>
      )}
      {g?.marked && <span className="small">☠️ You&apos;ve marked {nameOf(view, g.marked)}. They&apos;ll be found at the end of the round.</span>}
    </div>
  );
}

function ActionPanel({
  view,
  notes,
  act,
  isHost,
  playAgain,
  onExit,
  inquest,
  startInquest,
  stopInquest,
}: {
  view: PlayerView;
  notes: Notes;
  act: Act;
  isHost: boolean;
  playAgain: () => void;
  onExit: () => void;
  inquest: Partial<Answer> | null;
  startInquest: () => void;
  stopInquest: () => void;
}) {
  const phase = view.phase;
  const me = view.you.seat;
  if (phase.kind === "over") return <GameOver view={view} isHost={isHost} playAgain={playAgain} onExit={onExit} />;
  if (phase.kind === "confer" && phase.with === me) return <ShowPanel view={view} notes={notes} act={act} />;
  if (phase.kind === "trim" && phase.active === me) return <TrimPanel view={view} notes={notes} act={act} />;
  if ((phase.kind === "inquest" || phase.kind === "vote") && view.voted && !view.voted[me])
    return phase.kind === "inquest" ? <VerdictPanel view={view} act={act} /> : <DawnPanel view={view} notes={notes} act={act} />;
  if (phase.kind === "turn" && phase.active === me) {
    if (phase.step === "share") return <SharePanel view={view} notes={notes} act={act} />;
    if (inquest) return <InquestPanel view={view} notes={notes} act={act} answer={inquest} onCancel={stopInquest} />;
    return <InvestigatePanel view={view} act={act} onInquest={startInquest} />;
  }

  const name = (i: number) => cap(nameOf(view, view.players[i].id));
  let waiting: string;
  if (!view.you.alive && phase.kind !== "turn") waiting = "You're dead. The living are deciding.";
  else if (phase.kind === "turn") waiting = `${name(phase.active)} is ${phase.step === "investigate" ? "investigating" : "deciding what to share"}.`;
  else if (phase.kind === "confer") waiting = `${name(phase.active)} is conferring with ${nameOf(view, view.players[phase.with].id)}.`;
  else if (phase.kind === "trim") waiting = `${name(phase.active)} is over the hand limit, and choosing what to give up.`;
  else waiting = `Waiting for ${view.voted!.filter((v) => !v).length} more to vote.`;
  const last = view.log.at(-1);
  return (
    <div className="card stack">
      {last && <span className="muted small">{logText(view, last)}</span>}
      {phase.kind === "inquest" && <b className="center">{inquestLine(view)}</b>}
      <p className="muted center" style={{ margin: 0 }}>{waiting}</p>
    </div>
  );
}

function inquestLine(view: PlayerView): string {
  const p = view.phase as Extract<PlayerView["phase"], { kind: "inquest" }>;
  return `${cap(nameOf(view, view.players[p.active].id))} accuses ${answerText(view.dossier, p.answer)}.`;
}

/** Who has followed a lead so far, from the public log. */
function lookedBy(view: PlayerView, lead: Lead): string[] {
  const who = view.log.flatMap((e) => (e.t === "investigate" && sameLead(e.lead, lead) ? [e.who] : []));
  return [...new Set(who)];
}

/** Step one of your turn: pick a lead. The guilty may tamper with it instead. */
function InvestigatePanel({ view, act, onInquest }: { view: PlayerView; act: Act; onInquest: () => void }) {
  const d = view.dossier;
  const g = view.guilty;
  const [lead, setLead] = useState<Lead | null>(null);
  const [tamper, setTamper] = useState<Tampering | null>(null);
  const [striking, setStriking] = useState(false);
  const dry = view.you.findings.filter((f) => f.clue === null).map((f) => leadKey(f.lead));
  // Leads where your last look found something, and you were told there was more.
  const last = new Map(view.you.findings.map((f) => [leadKey(f.lead), f]));
  const more = new Set([...last].filter(([, f]) => f.more).map(([k]) => k));
  const plantable = g ? g.forgeries.filter((f) => !f.planted && g.plantsLeft > 0) : [];

  const leadButton = (l: Lead, label: string) => {
    const by = lookedBy(view, l);
    const sub = dry.includes(leadKey(l))
      ? "nothing more for you"
      : more.has(leadKey(l))
        ? "you know there's more here"
        : by.length
        ? `looked at by ${by.map((id) => nameOf(view, id)).join(", ")}`
        : "nobody's looked yet";
    const on = lead && sameLead(lead, l);
    return (
      <button
        key={leadKey(l)}
        className={on ? "selected" : ""}
        onClick={() => {
          setLead(l);
          if (tamper?.how === "plant" && !plantable.some((f) => f.forgery.clue === tamper.clue && sameLead(f.forgery.lead, l)))
            setTamper(null);
        }}
      >
        {label}
        <span className="src">{sub}</span>
      </button>
    );
  };
  const has = (l: Lead) => view.leads.some((x) => sameLead(x, l));
  const label = lead ? leadText(d, lead) : null;

  return (
    <div className="card stack">
      <b>Your turn: investigate</b>
      <p className="muted small" style={{ margin: 0 }}>
        Pick a lead and draw its top card. Only you see what it says; the table sees where you looked.
      </p>
      <div className="leads">
        {leadButton({ kind: "body" }, "🩸 Examine the body")}
        {has({ kind: "body2" }) && leadButton({ kind: "body2" }, "🩸 Examine the second body")}
      </div>
      <div className="muted small group-label">🚪 The rooms</div>
      <div className="leads">
        {d.rooms.flatMap((r) => [
          leadButton({ kind: "staff", room: r.id }, `🗣️ Staff: ${r.name}`),
          leadButton({ kind: "search", room: r.id }, `🔦 Search: ${r.name}`),
        ])}
      </div>
      <div className="muted small group-label">🕴️ Alibis</div>
      <div className="leads">
        {d.agents.map((a) => leadButton({ kind: "alibi", agent: a.id }, `🧾 ${a.name}${a.id === view.you.seat ? " (you)" : ""}`))}
      </div>

      {g && (
        <div className="stack" style={{ gap: 6 }}>
          <div className="muted small group-label">🤫 Tamper instead (looks the same to the table)</div>
          <div className="choices">
            <button className={`choice ${!tamper ? "selected" : ""}`} onClick={() => setTamper(null)}>Draw honestly</button>
            <button className={`choice ${tamper?.how === "bury" ? "selected" : ""}`} onClick={() => setTamper({ how: "bury" })}>
              Bury the top card
            </button>
          </div>
          {plantable.map((f) => {
            const on = tamper?.how === "plant" && tamper.clue === f.forgery.clue;
            return (
              <button
                key={f.forgery.clue}
                className={`clue pickable ${on ? "selected" : ""}`}
                onClick={() => {
                  setTamper({ how: "plant", clue: f.forgery.clue });
                  setLead(f.forgery.lead);
                }}
              >
                <span className="row">
                  <span>Plant: {clueText(d, f.card)}</span>
                </span>
                <span className="src">{leadText(d, f.forgery.lead)}</span>
              </button>
            );
          })}
        </div>
      )}

      <button
        className="primary full lg"
        disabled={!lead}
        onClick={() => lead && act({ type: "investigate", lead: leadKey(lead), ...(tamper ? { tamper } : {}) })}
      >
        {!label
          ? "Pick a lead above"
          : tamper?.how === "bury"
            ? `${label}, and bury what's there`
            : tamper?.how === "plant"
              ? `${label}, and plant the forgery`
              : label}
      </button>

      {g?.canStrike && (
        <div className="stack" style={{ gap: 6 }}>
          {!striking ? (
            <button className="ghost full" onClick={() => setStriking(true)}>☠️ Strike again (once a game)</button>
          ) : (
            <>
              <span className="muted small">
                Pick a victim. They&apos;ll be found at the end of this round, with everything they were carrying.
              </span>
              <div className="choices">
                {view.players.map((p, i) =>
                  p.alive && i !== view.you.seat ? (
                    <button key={p.id} className="choice danger" onClick={() => act({ type: "strike", target: p.id })}>
                      {seatName(view, i)}
                    </button>
                  ) : null
                )}
              </div>
              <button className="ghost small" onClick={() => setStriking(false)}>Not now</button>
            </>
          )}
        </div>
      )}

      {!view.you.inquestUsed && (
        <button className="ghost full" onClick={onInquest}>
          ⚖️ Call an inquest instead
        </button>
      )}
    </div>
  );
}

/** Naming who, with what and where, for the table to vote on. Picked on the board below. */
function InquestPanel({
  view,
  notes,
  act,
  answer,
  onCancel,
}: {
  view: PlayerView;
  notes: Notes;
  act: Act;
  answer: Partial<Answer>;
  onCancel: () => void;
}) {
  const d = view.dossier;
  const full = answer.agent !== undefined && answer.device !== undefined && answer.room !== undefined ? (answer as Answer) : null;
  const impossible =
    full && !notes.solver.space.answers(notes.analysis.candidates).includes(notes.solver.space.keyOf(full));
  return (
    <div className="card stack">
      <b>⚖️ Call an inquest</b>
      <p className="muted small" style={{ margin: 0 }}>
        Tap who, with what and where on the board below. Everyone alive votes; if most say yes, the game ends there, right
        or wrong. You only get one.
      </p>
      <div className="pick-summary">
        <span className="pill">{answer.agent !== undefined ? d.agents[answer.agent].name : "who?"}</span>
        <span className="pill">{answer.device !== undefined ? d.devices[answer.device].name : "with what?"}</span>
        <span className="pill">{answer.room !== undefined ? d.rooms[answer.room].name : "where?"}</span>
      </div>
      {impossible && <p className="err" style={{ margin: 0 }}>Your board says it can&apos;t be that.</p>}
      <div className="btn-row">
        <button onClick={onCancel}>Back</button>
        <button className="danger" disabled={!full} onClick={() => full && act({ type: "inquest", answer: full })}>
          Call it
        </button>
      </div>
    </div>
  );
}

/** What your investigation just turned up, if anything. */
function LastFinding({ view, notes }: { view: PlayerView; notes: Notes }) {
  const f = view.you.findings.at(-1);
  if (!f || f.round !== view.round) return null;
  if (f.clue === null)
    return <p className="muted small" style={{ margin: 0 }}>{leadText(view.dossier, f.lead)}: nothing more to find there.</p>;
  const c = view.you.known.find((x) => x.id === f.clue);
  return c ? (
    <div className="stack" style={{ gap: 4 }}>
      <span className="muted small">You found:</span>
      <CardView view={view} clue={c} notes={notes} />
      {f.more && <span className="muted small">🔎 There&apos;s more to find there.</span>}
    </div>
  ) : null;
}

/** Step two of your turn: testify, confer, or keep your cards to yourself. */
function SharePanel({ view, notes, act }: { view: PlayerView; notes: Notes; act: Act }) {
  const [mode, setMode] = useState<"testify" | "confer" | null>(null);
  const [card, setCard] = useState<number | null>(null);
  const [withId, setWith] = useState<string | null>(null);
  const hand = view.you.hand.map((id) => view.you.known.find((c) => c.id === id)!).filter(Boolean);
  const others = view.players.filter((p, i) => p.alive && i !== view.you.seat);
  return (
    <div className="card stack">
      <LastFinding view={view} notes={notes} />
      <b>Share something?</b>
      <div className="btn-row">
        <button className={mode === "testify" ? "primary" : ""} disabled={!hand.length} onClick={() => setMode("testify")}>
          📜 Testify
        </button>
        <button className={mode === "confer" ? "primary" : ""} disabled={!hand.length || !others.length} onClick={() => setMode("confer")}>
          🤫 Confer
        </button>
      </div>
      {mode && (
        <p className="muted small" style={{ margin: 0 }}>
          {mode === "testify"
            ? "Put a card on the public record. Everyone reads it, with where it came from, and it leaves your hand."
            : "Show one card to one player, and they show you one back. You both keep your cards; the table only sees that you talked."}
        </p>
      )}
      {mode === "confer" && (
        <div className="choices">
          {others.map((p) => (
            <button key={p.id} className={`choice ${withId === p.id ? "selected" : ""}`} onClick={() => setWith(p.id)}>
              {seatName(view, view.players.indexOf(p))}
            </button>
          ))}
        </div>
      )}
      {mode && hand.map((c) => <CardView key={c.id} view={view} clue={c} selected={card === c.id} onClick={() => setCard(c.id)} />)}
      {mode === "testify" && (
        <button className="primary full lg" disabled={card === null} onClick={() => card !== null && act({ type: "testify", card })}>
          {card === null ? "Pick a card" : "Testify"}
        </button>
      )}
      {mode === "confer" && (
        <button
          className="primary full lg"
          disabled={card === null || !withId}
          onClick={() => card !== null && withId && act({ type: "confer", with: withId, card })}
        >
          {!withId ? "Pick someone" : card === null ? "Pick a card to show" : `Confer with ${nameOf(view, withId)}`}
        </button>
      )}
      <button className="ghost full" onClick={() => act({ type: "pass" })}>
        Keep my cards to myself
      </button>
    </div>
  );
}

/** Over the hand limit: one card goes on the record, or in the fire. */
function TrimPanel({ view, notes, act }: { view: PlayerView; notes: Notes; act: Act }) {
  const [card, setCard] = useState<number | null>(null);
  const hand = view.you.hand.map((id) => view.you.known.find((c) => c.id === id)!).filter(Boolean);
  return (
    <div className="card stack">
      <b>You&apos;re holding {cards(hand.length)}; the limit is {view.handLimit}</b>
      <p className="muted small" style={{ margin: 0 }}>
        Testify one, or burn it. Burning destroys it for good, and the table sees that you burned something. Your notes
        keep everything you&apos;ve seen either way.
      </p>
      {hand.map((c) => (
        <CardView key={c.id} view={view} clue={c} notes={undefined} selected={card === c.id} onClick={() => setCard(c.id)} />
      ))}
      <div className="btn-row">
        <button className="danger" disabled={card === null} onClick={() => card !== null && act({ type: "burn", card })}>
          🔥 Burn it
        </button>
        <button className="primary" disabled={card === null} onClick={() => card !== null && act({ type: "testify", card })}>
          📜 Testify
        </button>
      </div>
      {notes.clash && <span className="muted small">Your board has a contradiction; see the Board tab.</span>}
    </div>
  );
}

/** Someone conferred with you: see their card, show one back. */
function ShowPanel({ view, notes, act }: { view: PlayerView; notes: Notes; act: Act }) {
  const phase = view.phase as Extract<PlayerView["phase"], { kind: "confer" }>;
  const [card, setCard] = useState<number | null>(null);
  const shown = view.you.known.find((c) => c.id === view.shownYou);
  const hand = view.you.hand.map((id) => view.you.known.find((c) => c.id === id)!).filter(Boolean);
  const who = nameOf(view, view.players[phase.active].id);
  return (
    <div className="card stack">
      <b>{cap(who)} wants a word</b>
      {shown && (
        <>
          <span className="muted small">{cap(who)} showed you:</span>
          <CardView view={view} clue={shown} notes={notes} />
        </>
      )}
      <span className="muted small">Show {who} one of yours:</span>
      {hand.map((c) => (
        <CardView key={c.id} view={view} clue={c} selected={card === c.id} onClick={() => setCard(c.id)} />
      ))}
      <button className="primary full lg" disabled={card === null} onClick={() => card !== null && act({ type: "show", card })}>
        {card === null ? "Pick a card" : `Show ${who}`}
      </button>
    </div>
  );
}

/** An inquest: does the accusation stand? */
function VerdictPanel({ view, act }: { view: PlayerView; act: Act }) {
  return (
    <div className="card stack center">
      <b>⚖️ {inquestLine(view)}</b>
      <p className="muted small" style={{ margin: 0 }}>
        If most of the living say yes, the game ends now: the innocents win only if all three are right.
      </p>
      <div className="btn-row">
        <button onClick={() => act({ type: "vote", value: 0 })}>No, not yet</button>
        <button className="danger" onClick={() => act({ type: "vote", value: 1 })}>Yes, that&apos;s it</button>
      </div>
    </div>
  );
}

/** Dawn: vote who, then with what, then where. */
function DawnPanel({ view, notes, act }: { view: PlayerView; notes: Notes; act: Act }) {
  const phase = view.phase as Extract<PlayerView["phase"], { kind: "vote" }>;
  const d = view.dossier;
  const counts = notes.analysis.marginals[phase.part];
  const so = view.accusation;
  return (
    <div className="card stack">
      <b>🌅 Dawn: {PART_LABEL[phase.part]}?</b>
      <p className="muted small" style={{ margin: 0 }}>
        {phase.revote
          ? "That was a tie. Vote again between the tied; if it ties again, the inspector picks."
          : "Argue it out, then vote. The most votes wins."} The
        innocents need all three right.
      </p>
      {(so.agent !== undefined || so.device !== undefined) && (
        <div className="pick-summary">
          {so.agent !== undefined && <span className="pill">{d.agents[so.agent].name}</span>}
          {so.device !== undefined && <span className="pill">{d.devices[so.device].name}</span>}
        </div>
      )}
      <div className="choices">
        {phase.options.map((v) => (
          <button key={v} className={`choice ${counts && counts[v] === 0 ? "ruled-out" : ""}`} onClick={() => act({ type: "vote", value: v })}>
            {optionName(d, phase.part, v)}
          </button>
        ))}
      </div>
    </div>
  );
}

function GameOver({ view, isHost, playAgain, onExit }: { view: PlayerView; isHost: boolean; playAgain: () => void; onExit: () => void }) {
  const phase = view.phase as Extract<PlayerView["phase"], { kind: "over" }>;
  const r = view.reveal!;
  const d = view.dossier;
  const won = phase.winners.includes(view.you.id);
  const headline =
    phase.result === "caught"
      ? "🎉 The killer was caught"
      : "💨 The wrong answer stood. The killer walks free";
  const visits = (agent: number) => r.secret.visits[agent].map((x) => d.rooms[x].name).join(", ");
  return (
    <div className="card stack">
      <h2 className="center" style={{ margin: 0 }}>{headline}</h2>
      <p className="center" style={{ margin: 0 }}>{won ? "You win." : "You lose."}</p>
      <p style={{ margin: 0 }}>
        It was <b>{answerText(d, r.secret.answer)}</b>. {seatName(view, r.killer)} did it
        {r.accomplice !== null ? `, with ${seatName(view, r.accomplice)} as accomplice` : ""}.
      </p>
      {phase.accusation.agent !== undefined && (
        <span className="muted small">
          The {phase.by === "inquest" ? "inquest" : "table"} named:{" "}
          {(["agent", "device", "room"] as const)
            .filter((p) => phase.accusation[p] !== undefined)
            .map((p) => optionName(d, p, phase.accusation[p]!))
            .join(", ")}
          .
        </span>
      )}
      <div className="muted small group-label">🤫 What the guilty did</div>
      {r.tampers.length ? (
        r.tampers.map((t, i) => (
          <div key={i} className="clue">
            {cap(nameOf(view, t.by))} {t.how === "bury" ? "buried the top card at" : "planted a forgery at"}: {leadText(d, t.lead)}
            {t.how === "plant" && <span className="src">{clueText(d, r.clues[t.clue])}</span>}
          </div>
        ))
      ) : (
        <span className="muted small">No tampering at all.</span>
      )}
      <div className="muted small group-label">🕰️ Everyone&apos;s evening</div>
      {d.agents.map((a) => (
        <div key={a.id} className="small">
          <b>{a.name}</b>: {visits(a.id)}
        </div>
      ))}
      {isHost ? (
        <button className="primary full lg" onClick={playAgain}>New case, same table</button>
      ) : (
        <p className="muted small center" style={{ margin: 0 }}>The host can deal a new case.</p>
      )}
      <button className="ghost full" onClick={onExit}>Leave</button>
    </div>
  );
}

function Log({ view }: { view: PlayerView }) {
  if (!view.log.length) return <p className="muted center">Nothing has happened yet.</p>;
  return (
    <div className="log">
      {[...view.log].reverse().map((e, i) => {
        const card = e.t === "testify" ? view.you.known.find((c) => c.id === e.clue) : null;
        return (
          <div key={view.log.length - i} className={`entry ${e.t === "death" || e.t === "dawn" ? "big" : ""}`}>
            {logText(view, e)}
            {card && <div className="small">“{clueText(view.dossier, card)}”</div>}
          </div>
        );
      })}
    </div>
  );
}
