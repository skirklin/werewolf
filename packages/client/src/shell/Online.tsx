import { useEffect, useState } from "react";
import QRCode from "qrcode";
import { normalizeRoomCode, ROOM_CODE_LENGTH, type RoomInfo } from "@party/core";
import { useRoom, type RoomConnection } from "./net.js";
import type { ClientGame } from "./game.js";
import { gameById } from "../games/index.js";

/**
 * Playing on separate devices, for any game: create or join a room, wait in
 * the lobby while the host sets things up, then hand over to the game's own
 * screen. Arriving by invite link or with a saved seat skips straight in.
 *
 * @param game the game to offer creating a room for (joining works for any)
 * @param onExit called with the id of the game whose room was left, if any
 */
export function Online({ game, onExit }: { game?: ClientGame; onExit: (gameId?: string) => void }) {
  const net = useRoom();
  const { room, view, code, error } = net;
  // Leaving clears saved creds so a reload doesn't auto-rejoin a finished game.
  const exit = () => {
    const left = room?.game ?? game?.id;
    net.leave();
    onExit(left);
  };

  if (!code) return <Landing game={game} net={net} onExit={exit} />;
  if (!room) return <Centered title="Finding the room…" onExit={exit} error={error} />;
  const playing = gameById(room.game);
  if (!playing)
    return <Centered title="This room is for a game this app can't show yet." onExit={exit} error={error} />;
  const isHost = room.players.some((p) => p.id === net.playerId && p.isHost);
  if (room.phase === "lobby") return <Lobby game={playing} room={room} net={net} isHost={isHost} onExit={exit} />;
  if (!view) return <Centered title="Dealing…" onExit={exit} error={error} />;

  const Table = playing.Table;
  return (
    <div className="app">
      <TopBar code={code} error={error} onExit={exit} />
      <Table
        view={view}
        room={room}
        you={net.playerId!}
        isHost={isHost}
        act={net.act}
        playAgain={() => net.send({ type: "playAgain" })}
        onExit={exit}
      />
    </div>
  );
}

function Landing({ game, net, onExit }: { game?: ClientGame; net: RoomConnection; onExit: () => void }) {
  const [name, setName] = useState("");
  // Pre-fill the code when arriving via a shared invite link (?room=CODE).
  const [joinCode, setJoinCode] = useState(() =>
    normalizeRoomCode(new URLSearchParams(location.search).get("room") ?? "")
  );
  return (
    <div className="app">
      <TopBar onExit={onExit} error={net.error} />
      <div className="spacer" />
      <div className="card stack">
        <label className="field">
          <span className="muted small">Your name</span>
          <input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam" maxLength={20} />
        </label>
        {game && (
          <>
            <button className="primary full lg" disabled={!name.trim()} onClick={() => net.create(game.id, name)}>
              Create a {game.name} room
            </button>
            <div className="divider" />
          </>
        )}
        <label className="field">
          <span className="muted small">Join with a code</span>
          <input
            className="code"
            value={joinCode}
            onChange={(e) => setJoinCode(normalizeRoomCode(e.target.value))}
            placeholder="ABCD"
            maxLength={ROOM_CODE_LENGTH}
            autoCapitalize="characters"
            autoCorrect="off"
            autoComplete="off"
            spellCheck={false}
          />
        </label>
        <button
          className={game ? "full lg" : "primary full lg"}
          disabled={!name.trim() || joinCode.length < ROOM_CODE_LENGTH}
          onClick={() => net.join(joinCode, name)}
        >
          Join room
        </button>
      </div>
      <div className="spacer" />
    </div>
  );
}

/** Share the room: a QR to scan plus a one-tap share/copy of the invite link. */
function RoomInvite({ code, gameName }: { code: string; gameName: string }) {
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
    const shareData = { title: gameName, text: `Join my ${gameName} game (code ${code})`, url };
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
      <div className="muted small">Others join by scanning, or with the code</div>
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
  game,
  room,
  net,
  isHost,
  onExit,
}: {
  game: ClientGame;
  room: RoomInfo;
  net: RoomConnection;
  isHost: boolean;
  onExit: () => void;
}) {
  const players = room.players.length;
  // After a rematch the room offers the last game's setup back, so the host
  // doesn't have to redo their toggles.
  const [config, setConfig] = useState(() => game.initialConfig(players, room.config));
  const problems = game.configProblems(config, players);
  const Settings = game.LobbySettings;

  return (
    <div className="app">
      <TopBar code={room.code} error={net.error} onExit={onExit} />
      <RoomInvite code={room.code} gameName={game.name} />

      <div className="stack">
        <div className="spread">
          <b>{players} in the room</b>
        </div>
        <div className="players">
          {room.players.map((p) => (
            <div key={p.id} className="chip">
              <span className="avatar">{p.isHost ? "👑" : "🙂"}</span>
              <span className="name">{p.name}{p.id === net.playerId ? " (you)" : ""}</span>
              <span className={`dot ${p.connected ? "on" : ""}`} style={{ marginLeft: "auto" }} />
              {isHost && p.id !== net.playerId && (
                <button className="ghost small" onClick={() => net.send({ type: "kick", playerId: p.id })}>✕</button>
              )}
            </div>
          ))}
        </div>

        {isHost ? (
          <>
            {Settings && <Settings config={config} players={players} onChange={setConfig} />}
            {problems.length > 0 && !Settings && <p className="center muted small">{problems[0]}</p>}
            <button
              className="primary full lg"
              disabled={problems.length > 0}
              onClick={() => net.send({ type: "startGame", config })}
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

export function TopBar({ code, error, onExit }: { code?: string; error?: string | null; onExit: () => void }) {
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
