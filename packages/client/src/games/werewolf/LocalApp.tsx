import { useState } from "react";
import {
  recommendedConfig,
  validateConfig,
  publicPlayers,
  publicLog,
  type GameConfig,
  type PlayerView,
} from "@party/werewolf";
import { useLocalGame } from "./local.js";
import { RoleConfigEditor } from "./config.js";
import { RoleCard, LogFeed, RolesInPlay, TownNews, BallotLines, useTimeTheme, timeLabel, nameOf } from "./ui.js";
import { TargetGrid, NightAction, NightResult, ColdShoulderNote, GameOver, PlayerList, AnnouncementScreen, NoticeCard } from "./phases.js";

export function LocalApp({ onExit }: { onExit: () => void }) {
  const game = useLocalGame();
  if (!game.state) return <Setup onStart={game.start} onExit={onExit} />;
  return <LocalPlay game={game} onExit={onExit} />;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

const NAMES_KEY = "werewolf.localNames";

/** Last game's roster (so families don't retype names every time), min 4 rows. */
function loadNames(): string[] {
  let saved: string[] = [];
  try {
    const raw = localStorage.getItem(NAMES_KEY);
    if (raw) saved = (JSON.parse(raw) as string[]).filter((n) => typeof n === "string");
  } catch {
    /* ignore */
  }
  while (saved.length < 4) saved.push("");
  return saved;
}

function Setup({
  onStart,
  onExit,
}: {
  onStart: (names: string[], config: GameConfig) => void;
  onExit: () => void;
}) {
  const [names, setNames] = useState<string[]>(loadNames);
  const [config, setConfig] = useState<GameConfig>(recommendedConfig(4));
  const filled = names.map((n) => n.trim()).filter(Boolean);
  const problems = validateConfig(config, filled.length);

  const start = () => {
    try {
      localStorage.setItem(NAMES_KEY, JSON.stringify(filled));
    } catch {
      /* ignore storage errors */
    }
    onStart(filled, config);
  };

  const setName = (i: number, v: string) =>
    setNames((ns) => ns.map((n, j) => (j === i ? v : n)));

  return (
    <div className="app">
      <div className="spread">
        <button className="ghost small" onClick={onExit}>← Back</button>
        <span className="pill">Pass the device</span>
      </div>
      <div className="phase-banner"><div className="big">🤝</div><h2>Who's playing?</h2></div>

      <div className="stack">
        {names.map((n, i) => (
          <div key={i} className="spread" style={{ gap: 8 }}>
            <input
              value={n}
              placeholder={`Player ${i + 1}`}
              maxLength={20}
              onChange={(e) => setName(i, e.target.value)}
            />
            {names.length > 3 && (
              <button className="ghost small" aria-label="Remove player" onClick={() => setNames((ns) => ns.filter((_, j) => j !== i))}>✕</button>
            )}
          </div>
        ))}
        <button className="ghost full" onClick={() => setNames((ns) => [...ns, ""])}>+ Add a player</button>

        <div className="divider" />
        <RoleConfigEditor config={config} playerCount={filled.length} onChange={setConfig} />

        <button className="primary full lg" disabled={problems.length > 0} onClick={start}>
          Deal the roles
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

function LocalPlay({
  game,
  onExit,
}: {
  game: ReturnType<typeof useLocalGame>;
  onExit: () => void;
}) {
  const { state, turn, seatId, view } = game;
  const [openedTurn, setOpenedTurn] = useState<string>("");
  const [nightIntroRound, setNightIntroRound] = useState<number>(-1);
  const [seenRole, setSeenRole] = useState<Set<string>>(new Set());
  useTimeTheme(state?.phase ?? null);
  if (!state || !view) return null;

  if (state.phase === "gameOver") {
    return (
      <div className="app">
        {/* Back to setup, where the roster is already remembered. */}
        <GameOver view={view} onPlayAgain={game.reset} onExit={() => { game.reset(); onExit(); }} />
      </div>
    );
  }

  // Public: night intro — a beat to recap the day and tell everyone eyes closed.
  if (state.phase === "night" && nightIntroRound !== state.round) {
    return (
      <Public title={timeLabel("night", state.round)} onExit={onExit}>
        <LogFeed log={publicLog(state).filter((e) => e.round >= state.round - 1)} players={publicPlayers(state)} />
        <p className="muted center">Everyone, close your eyes. Pass the phone around as prompted.</p>
        <button className="primary full lg" onClick={() => setNightIntroRound(state.round)}>
          Begin the night
        </button>
      </Public>
    );
  }

  // Public: day board.
  if (state.phase === "dayDiscussion") {
    return (
      <Public title={timeLabel("day", state.round)} onExit={onExit}>
        <TownNews log={publicLog(state)} voteHistory={view.voteHistory} round={state.round} players={publicPlayers(state)} />
        <ColdShoulderNote view={view} />
        <PlayerList players={publicPlayers(state)} youId="-" />
        <RolesInPlay roleIds={view.possibleRoles} wolves={view.wolfCount} />
        <p className="muted center small">Talk it out. When you're ready, put it to a vote.</p>
        <button className="primary full lg" onClick={game.callVote}>Call a vote</button>
      </Public>
    );
  }

  // Public: the vote's result, read out to the table. Built from public
  // players only, so the role shown is one the whole table may see.
  if (state.phase === "announce") {
    return (
      <div className="app">
        {/* Private news waits for each player's own turn (see VoteTurn). */}
        <AnnouncementScreen view={{ ...view, players: publicPlayers(state) }} onContinue={game.proceed} privateNews={false} />
      </div>
    );
  }

  // Private turns behind a handoff gate, one per seat per phase.
  if (!seatId) return null;
  const tid = `${state.phase}:${seatId}:${state.round}`;
  if (openedTurn !== tid) return <Handoff name={nameOf(state.players, seatId)} onOpen={() => setOpenedTurn(tid)} />;

  // First time this player holds the device: show their secret role, so the
  // device only has to circle once.
  if (state.phase === "night" && !seenRole.has(seatId)) {
    return (
      <div className="app">
        <RoleCard view={view} />
        <div style={{ marginTop: 12 }}><RolesInPlay roleIds={view.possibleRoles} wolves={view.wolfCount} open /></div>
        <div className="spacer" />
        <p className="muted center small">Memorize it! You'll act on it now, then pass the phone along.</p>
        <button className="primary full lg" onClick={() => setSeenRole((s) => new Set(s).add(seatId))}>
          Got it →
        </button>
      </div>
    );
  }

  switch (turn.kind) {
    case "night":
      return <div className="app"><NightAction view={view} send={game.act} /></div>;
    case "nightPass":
      // A Seer or Detective reads their result before passing the phone on.
      if (view.nightAwaitingAck) return <div className="app"><NightResult view={view} send={game.act} /></div>;
      return (
        <div className="app">
          <div className="spacer" />
          <div className="phase-banner"><div className="big">😴</div><h2>Nothing to do</h2><p className="muted">The night passes quietly for you.</p></div>
          <div className="spacer" />
          <button className="primary full lg" onClick={game.passNight}>Tap to pass the phone</button>
        </div>
      );
    case "vote":
      return <VoteTurn view={view} onSubmit={game.submitVote} />;
    default:
      return null;
  }
}

function VoteTurn({ view, onSubmit }: { view: PlayerView; onSubmit: (id: string | null) => void }) {
  const others = view.players.filter((p) => p.alive && p.id !== view.you.id);
  return (
    <div className="app">
      <div className="phase-banner"><div className="big">🗳️</div><h2>{view.you.name}, cast your vote</h2><p className="muted">Who should the town eliminate?</p></div>
      {/* Overnight news meant only for this player (a new role, a raise). */}
      <NoticeCard view={view} />
      <TargetGrid view={view} ids={others.map((p) => p.id)} selected={null} onPick={(id) => onSubmit(id)} />
      <div className="spacer" />
      <button className="ghost full" onClick={() => onSubmit(null)}>Abstain</button>
      {Object.keys(view.votes).length > 0 && (
        <div className="card tight stack" style={{ marginTop: 12 }}>
          <b>Votes so far (they're public)</b>
          <BallotLines votes={view.votes} name={(id) => nameOf(view.players, id)} />
        </div>
      )}
    </div>
  );
}

/** The whole screen is the tap target; the button is there to be obvious. */
function Handoff({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <div className="handoff" onClick={onOpen}>
      <div className="big" style={{ fontSize: "3rem" }}>📱➡️</div>
      <div className="to">Pass to {name}</div>
      <div className="sub">Eyes on the phone, {name} — and only you. Tap when you're holding it.</div>
      <button className="primary lg">I'm {name} — show me 👀</button>
    </div>
  );
}

function Public({ title, children, onExit }: { title: string; children: React.ReactNode; onExit: () => void }) {
  return (
    <div className="app">
      <div className="spread"><button className="ghost small" onClick={onExit}>← Quit</button></div>
      <div className="phase-banner"><h2>{title}</h2></div>
      <div className="stack grow">{children}</div>
    </div>
  );
}
