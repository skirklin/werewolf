import { useState } from "react";
import { answerText, atPlace, clueText, hallOf, placeName, type Action, type PlayerView } from "@party/foulplay";
import type { TableProps } from "../../shell/game.js";
import { Board, CardView, Evidence } from "./Notebook.js";
import { Dossier } from "./Dossier.js";
import { useNotes, type Notes } from "./solver.js";
import { PART_LABEL, cap, cards, logText, nameOf, optionName, seatName } from "./text.js";

type Act = (a: Action) => void;
type Tab = "board" | "evidence" | "case" | "log";

/** A Foul Play game in progress, on one player's own device (or the one being passed round). */
export function FoulPlayTable({ view, room, isHost, act, playAgain, onExit }: TableProps<PlayerView, Action>) {
  const notes = useNotes(view, room.code);
  const [tab, setTab] = useState<Tab>("board");
  const phase = view.phase;
  const moving = phase.kind === "turn" && phase.active === view.you.seat && phase.step === "move";

  return (
    <div className="stack">
      <RolePanel view={view} />
      <ActionPanel view={view} notes={notes} act={act} isHost={isHost} playAgain={playAgain} onExit={onExit} />
      <House view={view} act={moving ? act : null} />
      <div className="tabs">
        {(["board", "evidence", "case", "log"] as const).map((t) => (
          <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
            {t === "board" ? "🗂️ Board" : t === "evidence" ? "🃏 Evidence" : t === "case" ? "📁 Case" : "📜 Log"}
          </button>
        ))}
      </div>
      {tab === "board" && <Board view={view} notes={notes} picking={null} />}
      {tab === "evidence" && <Evidence view={view} notes={notes} />}
      {tab === "case" && <Dossier view={view} />}
      {tab === "log" && <Log view={view} />}
    </div>
  );
}

/**
 * The house: every room and the Hall, how much evidence is left in each, and
 * who's there. On your move, tap a room to go there or a guest to join them.
 */
function House({ view, act }: { view: PlayerView; act: Act | null }) {
  const d = view.dossier;
  const me = view.you.seat;
  const hall = hallOf(d);
  const active = "active" in view.phase ? view.phase.active : -1;
  const places = [hall, ...d.rooms.map((r) => r.id)];
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="spread">
        <b>🏚️ The house</b>
        <span className="muted small">
          {view.phase.kind === "vote" || view.phase.kind === "over" ? "Dawn" : `Round ${view.round} of ${view.rounds}`}
        </span>
      </div>
      <div className="house">
        {places.map((place) => {
          const here = view.players.map((p, i) => ({ p, i })).filter(({ p }) => p.alive && p.place === place);
          const mine = view.players[me].place === place;
          return (
            <div key={place} className={`place ${mine ? "mine" : ""}`}>
              <button
                className="place-name"
                disabled={!act}
                onClick={() => act?.(mine ? { type: "stay" } : { type: "move", to: place })}
              >
                <b>{place === hall ? "Hall" : d.rooms[place].name}</b>
                <span className="count" title="Evidence left here">🂠 {view.counts[place]}</span>
              </button>
              <div className="people">
                {here.length === 0 && <span className="muted small">empty</span>}
                {here.map(({ p, i }) => (
                  <button
                    key={p.id}
                    className={`guest ${i === active ? "active" : ""} ${i === me ? "you" : ""}`}
                    disabled={!act || i === me}
                    onClick={() => act?.({ type: "join", who: p.id })}
                  >
                    {i === active ? "▶ " : ""}
                    {p.id === view.you.id ? "You" : p.name}
                  </button>
                ))}
              </div>
            </div>
          );
        })}
      </div>
      {act && <p className="muted small center" style={{ margin: 0 }}>Tap a room to go there, or a guest to join them.</p>}
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
        🔒 You are {me}
        {view.you.alive ? "" : " (dead)"}. Tap to see your role.
      </button>
    );
  return (
    <div className={`card stack role ${g ? "guilty" : ""}`} style={{ gap: 6 }}>
      <div className="spread">
        <b>
          {view.you.role === "killer" ? "🔪 You are the killer" : view.you.role === "accomplice" ? "🤝 You are the accomplice" : "🕊️ You are innocent"}
        </b>
        <button className="ghost mini" onClick={() => setOpen(false)}>Hide</button>
      </div>
      {!g && (
        <span className="muted small">
          You didn&apos;t do it. Find the evidence and get it on the record before the killer destroys too much of it.
          Anyone can say anything; only the record is proof.
        </span>
      )}
      {g?.answer && <span>It was you, {answerText(d, g.answer).replace(/^[^,]+, /, "")}.</span>}
      {g && view.you.role === "killer" && (
        <span className="muted small">
          {g.accomplice !== null ? `Your accomplice is ${seatName(view, g.accomplice)}.` : "You have no accomplice."} Destroy
          evidence by searching alone and burning what you find; at night, murder a guest who&apos;s alone, or destroy a
          card in an empty room. You win once the case can&apos;t be proved.
        </span>
      )}
      {g && view.you.role === "accomplice" && (
        <span className="muted small">
          {seatName(view, g.killer)} did it. You don&apos;t know with what or where. Search alone and burn what would hang
          them. You win with them.
        </span>
      )}
      {g?.stacks && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="muted small">What&apos;s left in the house (top card first):</span>
          {g.stacks.map((stack, place) =>
            stack.length ? (
              <div key={place} className="small">
                <b>{cap(placeName(d, place))}:</b> {stack.map((c) => clueText(d, c)).join(" | ")}
              </div>
            ) : null
          )}
        </div>
      )}
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
  if (phase.kind === "turn" && phase.active === me) return <TurnPanel view={view} act={act} />;

  const name = (i: number) => cap(nameOf(view, view.players[i].id));
  const waiting =
    !view.you.alive && phase.kind !== "vote"
      ? "You're dead. You can watch, but not talk."
      : phase.kind === "turn"
        ? `${name(phase.active)} ${phase.step === "move" ? "is deciding where to go" : "is deciding what to do"}.`
        : phase.kind === "night"
          ? `Night. ${name(phase.active)} has the device.`
          : `Waiting for ${view.voted!.filter((v) => !v).length} more to vote.`;
  const last = view.log.at(-1);
  return (
    <div className="card stack">
      {last && <span className="muted small">{logText(view, last)}</span>}
      <p className="muted center" style={{ margin: 0 }}>{waiting}</p>
    </div>
  );
}

/** Your turn: move, then search or keep watch. Testifying (and, for the guilty, burning) is free. */
function TurnPanel({ view, act }: { view: PlayerView; act: Act }) {
  const phase = view.phase as Extract<PlayerView["phase"], { kind: "turn" }>;
  const d = view.dossier;
  const here = view.players[view.you.seat].place;
  const company = view.players.filter((p, i) => p.alive && i !== view.you.seat && p.place === here);
  const hand = view.you.hand.map((id) => view.you.known.find((c) => c.id === id)!).filter(Boolean);
  const last = view.log.at(-1);
  const justFound =
    last?.t === "search" && last.who === view.you.id && last.found === "private" ? hand.at(-1) : null;

  return (
    <div className="card stack">
      <b>
        Your turn
        {phase.step === "move" ? ": where to?" : phase.step === "act" ? `: ${atPlace(d, here)}` : ": anything to testify?"}
      </b>
      {phase.step === "move" ? (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            You&apos;re {atPlace(d, here)}. Go to a room, join a guest, or stay. Then you&apos;ll search or keep watch.
          </p>
          <button className="full" onClick={() => act({ type: "stay" })}>Stay {atPlace(d, here)}</button>
        </>
      ) : phase.step === "wrap" ? (
        <button className="primary full lg" onClick={() => act({ type: "end" })}>
          End my turn
        </button>
      ) : (
        <>
          <p className="muted small" style={{ margin: 0 }}>
            {company.length
              ? `${company.map((p) => p.name).join(", ")} ${company.length === 1 ? "is" : "are"} here, so anything you find goes on the record.`
              : "You're alone: anything you find goes into your hand, unseen. Testify it to prove it."}{" "}
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
            In your hand. Testifying puts a card on the public record{view.guilty ? "; burning destroys it unseen" : ""}. Both
            are free.
          </span>
          {hand.map((c) => (
            <div key={c.id} className="stack" style={{ gap: 4 }}>
              <CardView view={view} clue={c} />
              <div className="btn-row">
                <button className="small" onClick={() => act({ type: "testify", card: c.id })}>📜 Testify</button>
                {view.guilty && (
                  <button className="small danger" onClick={() => act({ type: "burn", card: c.id })}>🔥 Burn</button>
                )}
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
              <span className="src">{cap(placeName(d, place))}</span>
            </button>
          ))}
        </>
      )}
      <button className="ghost full" onClick={() => act({ type: "night", plan: { rest: true } })}>Do nothing tonight</button>
    </div>
  );
}

/** Dawn, if it comes to it: vote who, then with what, then where. */
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
          : "The evidence never settled it, so the table votes. The most votes wins."}{" "}
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
          <button key={v} className={`choice ${counts[v] === 0 ? "ruled-out" : ""}`} onClick={() => act({ type: "vote", value: v })}>
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
    phase.by === "proof"
      ? "🎉 The evidence proved it. The killer is arrested"
      : phase.by === "unprovable"
        ? "🔥 Too much evidence was destroyed. The killer walks free"
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
              ? `${cap(nameOf(view, t.who))} burned, in round ${t.round}:`
              : `Destroyed in the night, ${atPlace(d, t.place)}:`}
            <span className="src">{clueText(d, r.clues[t.clue])}</span>
          </div>
        ))
      ) : (
        <span className="muted small">Nothing at all.</span>
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
          <div key={view.log.length - i} className={`entry ${e.t === "murder" || e.t === "dawn" ? "big" : ""}`}>
            {logText(view, e)}
            {card && <div className="small">“{clueText(view.dossier, card)}”</div>}
          </div>
        );
      })}
    </div>
  );
}
