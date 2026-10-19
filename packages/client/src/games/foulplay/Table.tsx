import { useState } from "react";
import { answerText, atPlace, clueText, placeName, type Action, type Answer, type PlayerView } from "@party/foulplay";
import type { TableProps } from "../../shell/game.js";
import { Board, CardView, Evidence } from "./Notebook.js";
import { HouseMap } from "./HouseMap.js";
import { Briefing, CaseChips } from "./Briefing.js";
import { Dossier } from "./Dossier.js";
import { useNotes, type Notes } from "./solver.js";
import { PART_LABEL, cap, cards, logText, nameOf, optionName, seatName } from "./text.js";

type Act = (a: Action) => void;
type Tab = "board" | "evidence" | "case" | "log";

/** A Foul Play game in progress, on one player's own device (or the one being passed round). */
export function FoulPlayTable({ view, room, isHost, act, playAgain, onExit }: TableProps<PlayerView, Action>) {
  const notes = useNotes(view, room.code);
  const [tab, setTab] = useState<Tab>("board");
  // Your role, story and evening stay hidden until you ask, so a neighbour can't read them off your screen.
  const [secrets, setSecrets] = useState(false);
  const [briefing, setBriefing] = useBriefing(view, room.code);
  const phase = view.phase;
  const moving = phase.kind === "turn" && phase.active === view.you.seat && phase.step === "move";

  if (briefing && phase.kind !== "over")
    return (
      <Briefing
        view={view}
        onDone={() => {
          setBriefing(false);
          setSecrets(true);
        }}
      />
    );

  return (
    <div className="stack">
      <YouPanel view={view} open={secrets} setOpen={setSecrets} onBriefing={() => setBriefing(true)} />
      <ActionPanel view={view} notes={notes} act={act} isHost={isHost} playAgain={playAgain} onExit={onExit} />
      <HouseMap view={view} act={moving ? act : null} secrets={secrets} />
      <div className="tabs">
        {(["board", "evidence", "case", "log"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "board" ? "🗂️ Board" : t === "evidence" ? "🃏 Evidence" : t === "case" ? "📁 Case" : "📜 Log"}
          </button>
        ))}
      </div>
      {tab === "board" && <Board view={view} notes={notes} picking={null} />}
      {tab === "evidence" && <Evidence view={view} />}
      {tab === "case" && <Dossier view={view} />}
      {tab === "log" && <Log view={view} />}
    </div>
  );
}

/** Shown once per player per case, before anything else; reopened from your panel. */
function useBriefing(view: PlayerView, roomCode: string): [boolean, (v: boolean) => void] {
  const key = `foulplay.briefed.${roomCode}.${view.you.id}.${view.dossier.agents.map((a) => a.name).join("")}${view.you.story.device}${view.you.story.room}`;
  const [open, setOpen] = useState(() => {
    try {
      return localStorage.getItem(key) === null;
    } catch {
      return true;
    }
  });
  const set = (v: boolean) => {
    setOpen(v);
    try {
      if (!v) localStorage.setItem(key, "1");
    } catch {
      /* storage blocked: you'll just see the briefing again next time */
    }
  };
  return [open, set];
}

/** Your role card: what's yours alone. Hidden until you tap. */
function YouPanel({
  view,
  open,
  setOpen,
  onBriefing,
}: {
  view: PlayerView;
  open: boolean;
  setOpen: (v: boolean) => void;
  onBriefing: () => void;
}) {
  const d = view.dossier;
  const g = view.guilty;
  const me = view.you.seat;
  const myName = d.agents[me].name;
  if (!open)
    return (
      <button className="ghost full" onClick={() => setOpen(true)}>
        🔒 You are {myName}
        {view.you.alive ? "" : " (dead)"}. Tap to show your role and the case against you.
      </button>
    );
  const role =
    view.you.role === "killer" ? "🔪 The killer" : view.you.role === "accomplice" ? "🤝 The accomplice" : "🕊️ Innocent";
  return (
    <div className={`card stack role ${g ? "guilty" : ""}`} style={{ gap: 6 }}>
      <div className="spread">
        <b>
          {myName} · {role}
        </b>
        <span className="btn-row" style={{ gap: 4 }}>
          <button className="ghost mini" onClick={onBriefing}>📖 Briefing</button>
          <button className="ghost mini" onClick={() => setOpen(false)}>Hide</button>
        </span>
      </div>
      {!g ? (
        <div className="frame-row small">
          The case against you: <CaseChips view={view} against={view.you.story} />
        </div>
      ) : (
        <>
          <div className="frame-row small">
            The truth: <CaseChips view={view} against={g.answer} short />
            {view.you.role === "accomplice" ? ` (by ${d.agents[g.killer].name})` : ""}
          </div>
          {view.you.role === "killer" && g.accomplice !== null && (
            <span className="small">Accomplice: {seatName(view, g.accomplice)}</span>
          )}
          <div className="stack" style={{ gap: 2 }}>
            {view.players.map((p, i) =>
              i === g.killer ? null : (
                <div key={p.id} className="small frame-row">
                  {p.alive ? "" : "☠️ "}
                  Against {d.agents[i].name}: <CaseChips view={view} against={g.stories[i]} short />
                </div>
              )
            )}
          </div>
        </>
      )}
      <span className="muted small">👣 Your evening: {view.you.evening.map((r) => d.rooms[r].name).join(", ")}</span>
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
}: {
  view: PlayerView;
  notes: Notes;
  act: Act;
  isHost: boolean;
  playAgain: () => void;
  onExit: () => void;
}) {
  const phase = view.phase;
  const me = view.you.seat;
  if (phase.kind === "over") return <GameOver view={view} isHost={isHost} playAgain={playAgain} onExit={onExit} />;
  if (phase.kind === "night" && phase.active === me) return <NightPanel view={view} act={act} />;
  if (phase.kind === "vote" && view.voted && !view.voted[me]) return <DawnPanel view={view} notes={notes} act={act} />;
  if (phase.kind === "trial" && view.voted && !view.voted[me]) return <TrialPanel view={view} act={act} />;
  if (phase.kind === "turn" && phase.active === me) return <TurnPanel view={view} notes={notes} act={act} />;

  const name = (i: number) => cap(nameOf(view, view.players[i].id));
  const waiting =
    !view.you.alive && phase.kind !== "vote"
      ? "You're dead. You can watch, but not talk."
      : phase.kind === "turn"
        ? `${name(phase.active)} ${phase.step === "move" ? "is deciding where to go" : "is deciding what to do"}.`
        : phase.kind === "night"
          ? `Night. ${name(phase.active)} has the device.`
          : phase.kind === "trial"
            ? `${name(phase.by)} called the Reconstruction: ${answerText(view.dossier, phase.answer)}. Waiting for ${view.voted!.filter((v) => !v).length} more to say.`
            : `Waiting for ${view.voted!.filter((v) => !v).length} more to vote.`;
  const last = view.log.at(-1);
  return (
    <div className="card stack">
      {last && <span className="muted small">{logText(view, last)}</span>}
      <p className="muted center" style={{ margin: 0 }}>{waiting}</p>
    </div>
  );
}

/** Your turn: move, then search or keep watch, then testify or burn. Or call the Reconstruction. */
function TurnPanel({ view, notes, act }: { view: PlayerView; notes: Notes; act: Act }) {
  const phase = view.phase as Extract<PlayerView["phase"], { kind: "turn" }>;
  const [calling, setCalling] = useState(false);
  const d = view.dossier;
  const here = view.players[view.you.seat].place;
  const company = view.players.filter((p, i) => p.alive && i !== view.you.seat && p.place === here);
  const hand = view.you.hand.map((id) => view.you.known.find((c) => c.id === id)!).filter(Boolean);
  const last = view.log.at(-1);
  const justFound =
    last?.t === "search" && last.who === view.you.id && last.found === "private" ? hand.at(-1) : null;
  const steps = ["move", "act", "wrap"] as const;

  return (
    <div className="card stack">
      <b>Your turn</b>
      <div className="steps">
        {steps.map((st, i) => (
          <span key={st} className={`step ${phase.step === st ? "on" : steps.indexOf(phase.step) > i ? "done" : ""}`}>
            {i + 1}. {st === "move" ? "Move" : st === "act" ? "Search or watch" : "Testify or burn"}
          </span>
        ))}
      </div>
      {phase.step === "move" ? (
        <>
          <p className="small" style={{ margin: 0 }}>
            You&apos;re {atPlace(d, here)}. Tap a room on the map to go there or to join someone, or stay put.
          </p>
          <button className="full" onClick={() => act({ type: "stay" })}>Stay {atPlace(d, here)}</button>
          {!view.you.called && !calling && (
            <button className="ghost full" onClick={() => setCalling(true)}>
              🕯️ Call the Reconstruction instead (once a game)
            </button>
          )}
          {calling && <Reconstruction view={view} notes={notes} act={act} onCancel={() => setCalling(false)} />}
        </>
      ) : phase.step === "wrap" ? (
        <>
          {hand.length === 0 && <p className="muted small" style={{ margin: 0 }}>Nothing in your hand.</p>}
          <button className="primary full lg" onClick={() => act({ type: "end" })}>
            End my turn
          </button>
        </>
      ) : (
        <>
          <p className="small" style={{ margin: 0 }}>
            {company.length
              ? `${company.map((p) => p.name).join(", ")} ${company.length === 1 ? "is" : "are"} here with you: whatever you find goes straight on the public record.`
              : "You're alone: whatever you find goes into your hand, unseen. Everyone will see the count here drop."}{" "}
            {cards(view.counts[here])} left here.
          </p>
          <div className="btn-row">
            <button className="primary" disabled={!view.counts[here]} onClick={() => act({ type: "search" })}>
              🔦 Search
            </button>
            <button onClick={() => act({ type: "watch" })}>👁️ Keep watch</button>
          </div>
        </>
      )}
      {justFound && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="muted small">You just found:</span>
          <CardView view={view} clue={justFound} />
        </div>
      )}
      {hand.length > 0 && (
        <div className="stack" style={{ gap: 6 }}>
          <span className="muted small">
            In your hand: testify a card to put it on the public record, or burn it (nobody sees). Both are free.
          </span>
          {hand.map((c) => (
            <div key={c.id} className="stack" style={{ gap: 4 }}>
              <CardView view={view} clue={c} />
              <div className="btn-row">
                <button className="small" onClick={() => act({ type: "testify", card: c.id })}>📜 Testify</button>
                <button className="small danger" onClick={() => act({ type: "burn", card: c.id })}>🔥 Burn</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * The night: the device goes round the table and everyone taps through, so
 * nobody can tell who made a choice. Only the killer's counts.
 */
function NightPanel({ view, act }: { view: PlayerView; act: Act }) {
  const d = view.dossier;
  const n = view.night;
  if (view.you.role !== "killer" || !n)
    return (
      <div className="card stack center">
        <h2 style={{ margin: 0 }}>🌙 Night</h2>
        <p className="muted small" style={{ margin: 0 }}>The house is dark. Close your eyes and pass it on.</p>
        <button className="primary full lg" onClick={() => act({ type: "night" })}>Sleep</button>
      </div>
    );
  return (
    <div className="card stack">
      <h2 style={{ margin: 0 }}>🌙 Night</h2>
      <p className="muted small" style={{ margin: 0 }}>
        Everyone else just taps through. Choose quickly and pass it on.
      </p>
      {n.alone.length > 0 && (
        <>
          <span className="muted small">☠️ Murder a guest who&apos;s alone (once a game). Their body leaves fresh evidence.</span>
          <div className="choices">
            {n.alone.map((id) => {
              const seat = view.players.findIndex((p) => p.id === id);
              return (
                <button key={id} className="choice danger" onClick={() => act({ type: "night", plan: { murder: id } })}>
                  {seatName(view, seat)} {atPlace(d, view.players[seat].place)}
                </button>
              );
            })}
          </div>
        </>
      )}
      {n.emptyRooms.length > 0 && view.guilty?.stacks && (
        <>
          <span className="muted small">🔥 Or destroy the top card in an empty room:</span>
          {n.emptyRooms.map((place) => (
            <button key={place} className="clue pickable" onClick={() => act({ type: "night", plan: { destroy: place } })}>
              <span className="row">
                <span>{clueText(d, view.guilty!.stacks![place][0])}</span>
              </span>
              <span className="src">
                {cap(placeName(d, place))}
              </span>
            </button>
          ))}
        </>
      )}
      <button className="ghost full" onClick={() => act({ type: "night", plan: { rest: true } })}>Do nothing tonight</button>
    </div>
  );
}

/** Name the whole answer, then put it to the table. */
function Reconstruction({ view, notes, act, onCancel }: { view: PlayerView; notes: Notes; act: Act; onCancel: () => void }) {
  const [answer, setAnswer] = useState<Partial<Answer>>({});
  const whole = answer.agent !== undefined && answer.device !== undefined && answer.room !== undefined;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <b>🕯️ The Reconstruction</b>
      <p className="muted small" style={{ margin: 0 }}>
        Name who, with what and where, and everyone alive says yes or no. If most say yes, that&apos;s the verdict: right,
        and the innocents win; wrong, and the killer does. If not, play goes on, and your turn is spent. You only get one.
      </p>
      <Board view={view} notes={notes} picking={{ answer, onPick: (dim, v) => setAnswer({ ...answer, [dim]: v }) }} />
      <div className="btn-row">
        <button className="primary" disabled={!whole} onClick={() => act({ type: "accuse", answer: answer as Answer })}>
          {whole ? `Accuse: ${answerText(view.dossier, answer as Answer)}` : "Pick all three"}
        </button>
        <button className="ghost" onClick={onCancel}>Not yet</button>
      </div>
    </div>
  );
}

/** Someone has called the Reconstruction: agree, or not. Votes are shown once everyone has said. */
function TrialPanel({ view, act }: { view: PlayerView; act: Act }) {
  const phase = view.phase as Extract<PlayerView["phase"], { kind: "trial" }>;
  const d = view.dossier;
  return (
    <div className="card stack">
      <b>🕯️ {cap(nameOf(view, view.players[phase.by].id))} calls the Reconstruction</b>
      <p style={{ margin: 0 }}>
        &ldquo;It was <b>{answerText(d, phase.answer)}</b>.&rdquo;
      </p>
      <p className="muted small" style={{ margin: 0 }}>
        Do you agree? If most of the table does, that&apos;s the verdict, right or wrong. Everyone&apos;s answer is shown
        afterwards.
      </p>
      <div className="btn-row">
        <button className="primary" onClick={() => act({ type: "verdict", agree: true })}>✅ Yes, that&apos;s it</button>
        <button onClick={() => act({ type: "verdict", agree: false })}>❌ No</button>
      </div>
    </div>
  );
}

/** Dawn, if it comes to it: vote who, then with what, then where. */
function DawnPanel({ view, notes, act }: { view: PlayerView; notes: Notes; act: Act }) {
  const phase = view.phase as Extract<PlayerView["phase"], { kind: "vote" }>;
  const d = view.dossier;
  const so = view.accusation;
  return (
    <div className="card stack">
      <b>🌅 Dawn: {PART_LABEL[phase.part]}?</b>
      <p className="muted small" style={{ margin: 0 }}>
        {phase.revote
          ? "That was a tie. Vote again between the tied; if it ties again, the inspector picks."
          : "Nobody convinced the table in time, so it votes. The most votes wins."}{" "}
        The innocents need all three right.
      </p>
      {(so.agent !== undefined || so.device !== undefined) && (
        <div className="pick-summary">
          {so.agent !== undefined && <span className="pill">{d.agents[so.agent].name}</span>}
          {so.device !== undefined && <span className="pill">{d.devices[so.device].name}</span>}
        </div>
      )}
      <div className="choices">
        {phase.options.map((v) => (
          <button key={v} className={`choice ${notes.markOf(phase.part, v) === "out" ? "ruled-out" : ""}`} onClick={() => act({ type: "vote", value: v })}>
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
    phase.by === "trial"
      ? phase.caught
        ? "🎉 The Reconstruction was right. The killer is arrested"
        : `🎭 The table convicted ${d.agents[phase.accusation.agent!].name}. The killer walks free`
      : phase.by === "outnumbered"
          ? "☠️ The guilty took over the house"
          : phase.caught
            ? "🎉 The table named the killer at dawn"
            : "💨 The wrong answer stood at dawn. The killer walks free";
  const visits = (agent: number) => r.secret.visits[agent].map((x) => d.rooms[x].name).join(", ");
  return (
    <div className="card stack">
      <h2 className="center" style={{ margin: 0 }}>{headline}</h2>
      <p className="center" style={{ margin: 0 }}>{won ? "You win." : "You lose."}</p>
      <p style={{ margin: 0 }}>
        It was <b>{answerText(d, r.secret.answer)}</b>. {seatName(view, r.killer)} did it
        {r.accomplice !== null ? `, with ${seatName(view, r.accomplice)} as accomplice` : ""}.
      </p>
      <div className="muted small group-label">🔥 What was destroyed</div>
      {r.secretly.length ? (
        r.secretly.map((t, i) => (
          <div key={i} className="clue">
            {t.what === "burn"
              ? `${cap(nameOf(view, t.who))} (${t.who === view.players[r.killer].id ? "the killer" : r.accomplice !== null && t.who === view.players[r.accomplice].id ? "the accomplice" : "innocent"}) burned, in round ${t.round}:`
              : `Destroyed in the night, ${atPlace(d, t.place)}:`}
            <span className="src">{clueText(d, r.clues[t.clue])}</span>
          </div>
        ))
      ) : (
        <span className="muted small">Nothing at all.</span>
      )}
      <div className="muted small group-label">🕰️ The case against each guest, and their evening</div>
      {d.agents.map((a) => (
        <div key={a.id} className="small">
          <b>{a.name}</b>
          {a.id === r.killer ? " 🔪" : ""}: {answerText(d, r.stories[a.id]).replace(/^[^,]+, /, "")}. Went to {visits(a.id)}.
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
          <div key={view.log.length - i} className={`entry ${e.t === "murder" || e.t === "dawn" ? "big" : ""}`}>
            {logText(view, e)}
            {card && <div className="small">“{clueText(view.dossier, card)}”</div>}
          </div>
        );
      })}
    </div>
  );
}
