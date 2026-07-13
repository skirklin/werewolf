import { useEffect, useState } from "react";
import QRCode from "qrcode";
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
import { NightAction, DayBoard, VoteAction, ShootAction, DetectionHistory, GameOver, PlayerList } from "./phases.js";

export function OnlineApp({ onExit }: { onExit: () => void }) {
  const game = useOnlineGame();
  const { view, code, error } = game;
  // Leaving clears saved creds so a reload doesn't auto-rejoin a finished game.
  const exit = () => {
    game.leave();
    onExit();
  };

  if (!code) return <Landing game={game} onExit={exit} />;
  if (!view) return <Centered title="Rounding up the pack…" onExit={exit} error={error} />;
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
  // Pre-fill the code when arriving via a shared invite link (?room=CODE).
  const [joinCode, setJoinCode] = useState(
    () => new URLSearchParams(location.search).get("room")?.toUpperCase().slice(0, 4) ?? ""
  );
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
          Start a game 🎲
        </button>
        <div className="divider" />
        <label className="field">
          <span className="muted small">Got a code? Hop in 👇</span>
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
          Join the fun
        </button>
      </div>
      <div className="spacer" />
    </div>
  );
}

/** Share the room: a QR to scan plus a one-tap share/copy of the invite link. */
function RoomInvite({ code }: { code: string }) {
  const url = `${location.origin}/?room=${code}`;
  const [qr, setQr] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let alive = true;
    QRCode.toDataURL(url, { margin: 1, width: 320, color: { dark: "#0f1020", light: "#ffffff" } })
      .then((d) => alive && setQr(d))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [url]);

  const canShare = "share" in navigator;
  const share = async () => {
    const shareData = { title: "Werewolf", text: `Join my Werewolf game (code ${code})`, url };
    if (canShare) {
      try {
        await navigator.share(shareData);
        return;
      } catch {
        /* user cancelled — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* clipboard blocked — the code + QR are still shown */
    }
  };

  return (
    <div className="card stack center">
      <div className="muted small">Friends hop in by scanning — or typing the code</div>
      <div className="big" style={{ letterSpacing: 8 }}>{code}</div>
      {qr && (
        <img
          src={qr}
          alt={`QR code to join room ${code}`}
          width={200}
          height={200}
          style={{ borderRadius: 12, alignSelf: "center" }}
        />
      )}
      <button className="primary full lg" onClick={share}>
        {copied ? "Copied! ✓" : canShare ? "📲 Share the invite" : "🔗 Copy the invite"}
      </button>
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
      <RoomInvite code={view.code} />

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
              Start the game 🐺
            </button>
          </>
        ) : (
          <p className="center muted">Hang tight — the host is setting the table…</p>
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
              Everyone in? Let the night begin 🌙
            </button>
          ) : (
            <p className="center muted">Memorize your role… then act natural. Waiting for the host.</p>
          )}
        </div>
      );

    case "night":
      if (dead) return <Spectator view={view} label="🌙 The night creeps by…" />;
      if (view.nightPrompt) return <NightAction view={view} send={send} />;
      return (
        <div className="stack">
          <div className="phase-banner"><div className="big">🌙</div><h2>Night falls</h2></div>
          <InspectHistory view={view} />
          <DetectionHistory view={view} />
          <p className="center muted">Shhh… the night is happening. Sit tight.</p>
        </div>
      );

    case "hunterShot":
      if (view.shootPrompt) return <ShootAction view={view} send={send} />;
      return (
        <div className="stack">
          <div className="phase-banner"><div className="big">🏹</div><h2>A shot rings out! 🏹</h2></div>
          <p className="center muted">A fallen Hunter is taking someone down with them…</p>
        </div>
      );

    case "dayDiscussion":
      return <DayBoard view={view} send={send} isHost={view.you.isHost} />;

    case "dayVote":
      if (dead) return <Spectator view={view} label="🗳️ The town is deliberating…" />;
      if (view.silencedIds.includes(view.you.id))
        return (
          <div className="stack">
            <div className="phase-banner"><div className="big">🤫</div><h2>Zipped it 🤫</h2><p className="muted">No vote for you today — sit tight and look innocent.</p></div>
            <LogFeed log={view.log} players={view.players} />
          </div>
        );
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
      ? { label: "Nudge the night along (someone's AFK)", msg: { type: "endNight" } as ClientMessage }
      : view.phase === "dayVote"
        ? { label: "Force the vote (someone's AFK)", msg: { type: "resolveVote" } as ClientMessage }
        : view.phase === "hunterShot"
          ? { label: "Skip the shot (Hunter's AFK)", msg: { type: "skipShot" } as ClientMessage }
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
      <div className="phase-banner"><div className="big">💀</div><h2>You're out 💀</h2><p className="muted">{label}</p></div>
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
