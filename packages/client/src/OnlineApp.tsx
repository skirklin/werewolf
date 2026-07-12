import { useState } from "react";
import {
  recommendedConfig,
  validateConfig,
  type GameConfig,
  type PlayerView,
  type ClientMessage,
} from "@werewolf/shared";
import { useOnlineGame } from "./net.js";
import { RoleConfigEditor } from "./config.js";
import { RoleCard, InspectHistory, LogFeed } from "./ui.js";
import { NightAction, DayBoard, VoteAction, ShootAction, GameOver, PlayerList } from "./phases.js";

export function OnlineApp({ onExit }: { onExit: () => void }) {
  const game = useOnlineGame();
  const { view, code, error } = game;
  // Leaving clears saved creds so a reload doesn't auto-rejoin a finished game.
  const exit = () => {
    game.leave();
    onExit();
  };

  if (!code) return <Landing game={game} onExit={exit} />;
  if (!view) return <Centered title="Connecting…" onExit={exit} error={error} />;
  if (view.phase === "lobby") return <Lobby view={view} send={game.send} error={error} onExit={exit} />;

  return (
    <div className="app">
      <TopBar code={code} error={error} onExit={exit} />
      <GameView view={view} send={game.send} onExit={exit} />
    </div>
  );
}

function Landing({ game, onExit }: { game: ReturnType<typeof useOnlineGame>; onExit: () => void }) {
  const [name, setName] = useState("");
  const [joinCode, setJoinCode] = useState("");
  return (
    <div className="app">
      <TopBar onExit={onExit} error={game.error} />
      <div className="spacer" />
      <div className="card stack">
        <label className="field">
          <span className="muted small">Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" maxLength={20} />
        </label>
        <button className="primary full lg" disabled={!name.trim()} onClick={() => game.create(name)}>
          Create a room
        </button>
        <div className="divider" />
        <label className="field">
          <span className="muted small">Join with a code</span>
          <input
            className="code"
            value={joinCode}
            onChange={(e) => setJoinCode(e.target.value.toUpperCase().slice(0, 4))}
            placeholder="ABCD"
            maxLength={4}
          />
        </label>
        <button
          className="full lg"
          disabled={!name.trim() || joinCode.length < 4}
          onClick={() => game.join(joinCode, name)}
        >
          Join room
        </button>
      </div>
      <div className="spacer" />
    </div>
  );
}

function Lobby({
  view,
  send,
  error,
  onExit,
}: {
  view: PlayerView;
  send: (m: ClientMessage) => void;
  error: string | null;
  onExit: () => void;
}) {
  const [config, setConfig] = useState<GameConfig>(recommendedConfig(view.players.length));
  const isHost = view.you.isHost;
  const problems = validateConfig(config, view.players.length);

  return (
    <div className="app">
      <TopBar code={view.code} error={error} onExit={onExit} />
      <div className="phase-banner">
        <div className="muted small">Room code</div>
        <div className="big" style={{ letterSpacing: 6 }}>{view.code}</div>
        <p className="muted small">Others join at this device's URL with the code above.</p>
      </div>

      <div className="stack">
        <div className="spread">
          <b>{view.players.length} in the room</b>
        </div>
        <div className="players">
          {view.players.map((p) => (
            <div key={p.id} className="chip">
              <span className="avatar">{p.isHost ? "👑" : "🙂"}</span>
              <span className="name">{p.name}{p.id === view.you.id ? " (you)" : ""}</span>
              <span className={`dot ${p.connected ? "on" : ""}`} style={{ marginLeft: "auto" }} />
              {isHost && p.id !== view.you.id && (
                <button className="ghost small" onClick={() => send({ type: "kick", playerId: p.id })}>✕</button>
              )}
            </div>
          ))}
        </div>

        {isHost ? (
          <>
            <RoleConfigEditor config={config} playerCount={view.players.length} onChange={setConfig} />
            <button
              className="primary full lg"
              disabled={problems.length > 0}
              onClick={() => send({ type: "startGame", config })}
            >
              Start game
            </button>
          </>
        ) : (
          <p className="center muted">Waiting for the host to start…</p>
        )}
      </div>
    </div>
  );
}

function GameView({
  view,
  send,
  onExit,
}: {
  view: PlayerView;
  send: (m: ClientMessage) => void;
  onExit: () => void;
}) {
  return (
    <>
      {renderPhase(view, send, onExit)}
      <HostRecovery view={view} send={send} />
    </>
  );
}

function renderPhase(view: PlayerView, send: (m: ClientMessage) => void, onExit: () => void) {
  const dead = !view.you.alive;

  switch (view.phase) {
    case "roleReveal":
      return (
        <div className="stack">
          <RoleCard view={view} />
          {view.you.isHost ? (
            <button className="primary full lg" onClick={() => send({ type: "startNight" })}>
              Everyone's ready — begin night
            </button>
          ) : (
            <p className="center muted">Memorize your role. Waiting for the host…</p>
          )}
        </div>
      );

    case "night":
      if (dead) return <Spectator view={view} label="🌙 Night falls…" />;
      if (view.nightPrompt) return <NightAction view={view} send={send} />;
      return (
        <div className="stack">
          <div className="phase-banner"><div className="big">🌙</div><h2>Night falls</h2></div>
          <InspectHistory view={view} />
          <p className="center muted">Waiting for the night to end…</p>
        </div>
      );

    case "hunterShot":
      if (view.shootPrompt) return <ShootAction view={view} send={send} />;
      return (
        <div className="stack">
          <div className="phase-banner"><div className="big">🏹</div><h2>A shot rings out</h2></div>
          <p className="center muted">A fallen Hunter is taking someone with them…</p>
        </div>
      );

    case "dayDiscussion":
      return <DayBoard view={view} send={send} isHost={view.you.isHost} />;

    case "dayVote":
      if (dead) return <Spectator view={view} label="🗳️ The town is voting…" />;
      return <VoteAction view={view} send={send} />;

    case "gameOver":
      return <GameOver view={view} onExit={onExit} />;

    default:
      return null;
  }
}

/**
 * A subtle host-only escape hatch for phases that wait on one player. If someone
 * goes idle or drops, the host can force the game forward so it never wedges.
 */
function HostRecovery({ view, send }: { view: PlayerView; send: (m: ClientMessage) => void }) {
  if (!view.you.isHost) return null;
  const action =
    view.phase === "night"
      ? { label: "Force end night (someone's away)", msg: { type: "endNight" } as ClientMessage }
      : view.phase === "dayVote"
        ? { label: "Force the vote (someone's away)", msg: { type: "resolveVote" } as ClientMessage }
        : view.phase === "hunterShot"
          ? { label: "Skip the shot (Hunter's away)", msg: { type: "skipShot" } as ClientMessage }
          : null;
  if (!action) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <button className="ghost full small" onClick={() => send(action.msg)}>
        {action.label}
      </button>
    </div>
  );
}

function Spectator({ view, label }: { view: PlayerView; label: string }) {
  return (
    <div className="stack">
      <div className="phase-banner"><div className="big">💀</div><h2>You're out</h2><p className="muted">{label}</p></div>
      <LogFeed log={view.log} players={view.players} />
      <PlayerList players={view.players} youId={view.you.id} />
    </div>
  );
}

function TopBar({ code, error, onExit }: { code?: string; error?: string | null; onExit: () => void }) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="spread">
        <button className="ghost small" onClick={onExit}>← Leave</button>
        {code && <span className="pill">Room {code}</span>}
      </div>
      {error && <div className="err">⚠️ {error}</div>}
    </div>
  );
}

function Centered({ title, error, onExit }: { title: string; error: string | null; onExit: () => void }) {
  return (
    <div className="app">
      <TopBar onExit={onExit} error={error} />
      <div className="spacer" />
      <h2 className="center">{title}</h2>
      <div className="spacer" />
    </div>
  );
}
