import { useEffect, useMemo, useRef, useState } from "react";
import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  answerText,
  botMove,
  createGame,
  defaultTurnLimit,
  generateScenario,
  makeRng,
  projectView,
  reduce,
  whoMustAct,
  type Action,
  type Assist,
  type GameConfig,
  type GameState,
  type Mode,
} from "@party/foulplay";
import type { RoomInfo } from "@party/core";
import { FoulPlayTable } from "./Table.js";
import { solverFor } from "./solver.js";

/**
 * Practice on one device: every seat is either a person or a bot. With one
 * person it's a solo game against bots; with several it's pass-the-device,
 * with a hand-off screen whenever the move passes between people. The engine
 * runs here in the browser, and the screen is the same one online play uses.
 */

interface SeatSetup {
  name: string;
  bot: boolean;
}

interface Setup {
  seats: SeatSetup[];
  mode: Mode;
  assist: Assist;
}

const BOT_NAMES = ["Cipher", "Echo", "Falcon", "Juno", "Kestrel", "Lark"];
/** Long enough to follow what a bot did, short enough not to drag. */
const BOT_DELAY_MS = 900;
const STORE_KEY = "foulplay.practice";

function defaultSetup(): Setup {
  return {
    seats: [{ name: "You", bot: false }, ...BOT_NAMES.slice(0, 2).map((name) => ({ name, bot: true }))],
    mode: "competitive",
    assist: "grid",
  };
}

function loadSetup(): Setup {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    if (raw) {
      const s = JSON.parse(raw) as Setup;
      // A table saved before the gauge was dropped falls back to the full grid.
      if (Array.isArray(s.seats) && s.seats.length >= MIN_PLAYERS && s.seats.length <= MAX_PLAYERS)
        return { ...s, assist: s.assist === "notes" ? "notes" : "grid" };
    }
  } catch {
    /* fall back to the default table */
  }
  return defaultSetup();
}

export function FoulPlayLocal({ onExit }: { onExit: () => void }) {
  const [setup, setSetup] = useState<Setup | null>(null);
  if (!setup) return <SetupScreen onStart={setSetup} onExit={onExit} />;
  return <Practice setup={setup} onQuit={() => setSetup(null)} />;
}

function SetupScreen({ onStart, onExit }: { onStart: (s: Setup) => void; onExit: () => void }) {
  const [s, setS] = useState<Setup>(loadSetup);
  const humans = s.seats.filter((x) => !x.bot).length;
  const setSeat = (i: number, patch: Partial<SeatSetup>) =>
    setS({ ...s, seats: s.seats.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const addSeat = () =>
    setS({ ...s, seats: [...s.seats, { name: BOT_NAMES.find((n) => !s.seats.some((x) => x.name === n)) ?? "Bot", bot: true }] });
  const removeSeat = (i: number) => setS({ ...s, seats: s.seats.filter((_, j) => j !== i) });
  const names = s.seats.map((x) => x.name.trim());
  const problem =
    humans === 0
      ? "Keep at least one seat for a person."
      : names.some((n) => !n)
        ? "Every seat needs a name."
        : new Set(names).size !== names.length
          ? "Give every seat a different name."
          : null;

  const start = () => {
    const clean = { ...s, seats: s.seats.map((x) => ({ ...x, name: x.name.trim() })) };
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(clean));
    } catch {
      /* ignore storage errors */
    }
    onStart(clean);
  };

  return (
    <div className="app">
      <div className="spread">
        <button className="ghost small" onClick={onExit}>← Back</button>
        <span className="pill">Practice</span>
      </div>
      <div className="phase-banner">
        <div className="big">🤖</div>
        <h2>Who&apos;s at the table?</h2>
        <p className="muted small">
          One person and some bots for a solo game. More than one person passes the device between them.
        </p>
      </div>
      <div className="stack">
        {s.seats.map((seat, i) => (
          <div key={i} className="chip">
            <button className="ghost small" onClick={() => setSeat(i, { bot: !seat.bot })} title="Person or bot">
              {seat.bot ? "🤖" : "🙂"}
            </button>
            <input value={seat.name} maxLength={20} onChange={(e) => setSeat(i, { name: e.target.value })} />
            <button className="ghost small" disabled={s.seats.length <= MIN_PLAYERS} onClick={() => removeSeat(i)}>
              ✕
            </button>
          </div>
        ))}
        <button className="ghost full" disabled={s.seats.length >= MAX_PLAYERS} onClick={addSeat}>
          + Add a seat
        </button>
        <p className="muted small center" style={{ margin: 0 }}>Tap 🙂/🤖 to switch a seat between a person and a bot.</p>

        <div className="btn-row">
          <button className={s.mode === "competitive" ? "primary" : ""} onClick={() => setS({ ...s, mode: "competitive" })}>
            ⚔️ Competitive
          </button>
          <button className={s.mode === "coop" ? "primary" : ""} onClick={() => setS({ ...s, mode: "coop" })}>
            🤝 Co-op
          </button>
        </div>
        <div className="btn-row">
          {(["grid", "notes"] as const).map((a) => (
            <button key={a} className={s.assist === a ? "primary" : ""} onClick={() => setS({ ...s, assist: a })}>
              {a === "grid" ? "🧮 Full grid" : "📝 Notes only"}
            </button>
          ))}
        </div>
        {problem && <p className="err center" style={{ margin: 0 }}>{problem}</p>}
        <button className="primary full lg" disabled={!!problem} onClick={start}>
          Deal a case
        </button>
      </div>
    </div>
  );
}

function deal(setup: Setup): GameState {
  const seed = Math.floor(Math.random() * 2 ** 31);
  const scenario = generateScenario({ seed, players: setup.seats.length });
  const config: GameConfig = {
    mode: setup.mode,
    assist: setup.assist,
    ...(setup.mode === "coop" ? { turnLimit: defaultTurnLimit(setup.seats.length) } : {}),
  };
  return createGame(scenario, seatIds(setup).map((id, i) => ({ id, name: setup.seats[i].name })), config);
}

const seatIds = (setup: Setup) => setup.seats.map((_, i) => `seat${i}`);

function Practice({ setup, onQuit }: { setup: Setup; onQuit: () => void }) {
  const [state, setState] = useState<GameState | null>(null);
  const humans = setup.seats.map((s, i) => (s.bot ? -1 : i)).filter((i) => i >= 0);
  const firstHuman = humans[0];
  // The person whose screen is showing, and whether they've taken the device.
  const [viewer, setViewer] = useState(firstHuman);
  const [handedTo, setHandedTo] = useState(firstHuman);
  const [error, setError] = useState<string | null>(null);
  const [peek, setPeek] = useState(false);
  const rng = useRef(makeRng(Math.floor(Math.random() * 2 ** 31)));

  // Deal after first paint so "Dealing…" shows while the generator works.
  useEffect(() => {
    if (state) return;
    const t = setTimeout(() => setState(deal(setup)), 30);
    return () => clearTimeout(t);
  }, [state, setup]);

  // Several seats can owe a move at once (offers, discards).
  const owed = state ? whoMustAct(state) : [];
  const bot = owed.find((i) => setup.seats[i].bot);
  const people = owed.filter((i) => !setup.seats[i].bot);

  // Bots take their moves on a timer, one at a time.
  useEffect(() => {
    if (!state || bot === undefined) return;
    const t = setTimeout(() => {
      const id = state.players[bot].id;
      const move = botMove(projectView(state, id), solverFor(state.scenario.dossier), rng.current);
      if (move) setState(reduce(state, id, move));
    }, BOT_DELAY_MS);
    return () => clearTimeout(t);
  }, [state, bot]);

  // When a person who owes a move isn't holding the device, it goes to them.
  const nextPerson = people.includes(viewer) ? viewer : people[0];
  useEffect(() => {
    if (nextPerson !== undefined && nextPerson !== viewer) setViewer(nextPerson);
  }, [nextPerson, viewer]);

  const room = useMemo<RoomInfo>(
    () => ({
      // Notebook marks are kept per room code, so give each person their own.
      code: `PRACTICE-${viewer}`,
      game: "foulplay",
      phase: "playing",
      over: state?.phase.kind === "over",
      players: setup.seats.map((s, i) => ({ id: `seat${i}`, name: s.name, isHost: i === firstHuman, connected: true })),
      config: null,
    }),
    [viewer, state?.phase.kind, setup, firstHuman]
  );

  if (!state) return <Centered title="Dealing a case…" onQuit={onQuit} />;

  // Pass-the-device: hide the last person's notebook until the next one has the phone.
  if (humans.length > 1 && handedTo !== viewer && state.phase.kind !== "over")
    return <Handoff name={setup.seats[viewer].name} onOpen={() => setHandedTo(viewer)} />;

  const id = state.players[viewer].id;
  const act = (a: Action) => {
    try {
      setState(reduce(state, id, a));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="app">
      <div className="stack" style={{ gap: 8 }}>
        <div className="spread">
          <button className="ghost small" onClick={onQuit}>← Quit</button>
          <button className="ghost small" onClick={() => setPeek(!peek)}>{peek ? "🙈 Hide answer" : "🔍 Peek"}</button>
        </div>
        {peek && (
          <div className="pill" style={{ textAlign: "center" }}>
            Answer: {answerText(state.scenario.dossier, state.scenario.secret.answer)}
          </div>
        )}
        {error && <div className="err">⚠️ {error}</div>}
      </div>
      <FoulPlayTable
        view={projectView(state, id)}
        room={room}
        you={id}
        isHost
        act={act}
        playAgain={() => {
          setState(null);
          setViewer(firstHuman);
          setHandedTo(firstHuman);
        }}
        onExit={onQuit}
      />
    </div>
  );
}

function Handoff({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <div className="handoff" onClick={onOpen}>
      <div className="big" style={{ fontSize: "3rem" }}>📱➡️</div>
      <div className="to">Pass to {name}</div>
      <div className="sub">Eyes on the phone, {name}, and only you. Tap when you&apos;re holding it.</div>
      <button className="primary lg" onClick={onOpen}>I&apos;m {name}. Show me 👀</button>
    </div>
  );
}

function Centered({ title, onQuit }: { title: string; onQuit: () => void }) {
  return (
    <div className="app">
      <div className="spread">
        <button className="ghost small" onClick={onQuit}>← Quit</button>
      </div>
      <div className="spacer" />
      <h2 className="center">{title}</h2>
      <div className="spacer" />
    </div>
  );
}
