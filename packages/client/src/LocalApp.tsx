import { useState } from "react";
import {
  recommendedConfig,
  validateConfig,
  getRole,
  publicPlayers,
  publicLog,
  type GameConfig,
  type PlayerView,
  type Turn,
} from "@werewolf/shared";
import { useLocalGame } from "./local.js";
import { RoleConfigEditor } from "./config.js";
import { RoleCard, LogFeed } from "./ui.js";
import { TargetGrid, GameOver, PlayerList } from "./phases.js";

export function LocalApp({ onExit }: { onExit: () => void }) {
  const game = useLocalGame();
  if (!game.state) return <Setup onStart={game.start} onExit={onExit} />;
  return <LocalPlay game={game} onExit={onExit} />;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

function Setup({
  onStart,
  onExit,
}: {
  onStart: (names: string[], config: GameConfig) => void;
  onExit: () => void;
}) {
  const [names, setNames] = useState<string[]>(["", "", "", ""]);
  const [config, setConfig] = useState<GameConfig>(recommendedConfig(4));
  const filled = names.map((n) => n.trim()).filter(Boolean);
  const problems = validateConfig(config, filled.length);

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
              <button className="ghost" onClick={() => setNames((ns) => ns.filter((_, j) => j !== i))}>✕</button>
            )}
          </div>
        ))}
        <button className="ghost full" onClick={() => setNames((ns) => [...ns, ""])}>+ Add player</button>

        <div className="divider" />
        <RoleConfigEditor config={config} playerCount={filled.length} onChange={setConfig} />

        <button
          className="primary full lg"
          disabled={problems.length > 0}
          onClick={() => onStart(filled, config)}
        >
          Deal roles & start
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Play
// ---------------------------------------------------------------------------

function turnId(turn: Turn, round: number): string {
  const seat = "seatId" in turn ? turn.seatId : "-";
  return `${turn.kind}:${seat}:${round}`;
}

function LocalPlay({
  game,
  onExit,
}: {
  game: ReturnType<typeof useLocalGame>;
  onExit: () => void;
}) {
  const { state, turn, view } = game;
  const [openedTurn, setOpenedTurn] = useState<string>("");
  const [nightIntroRound, setNightIntroRound] = useState<number>(-1);
  const [seenRole, setSeenRole] = useState<Set<string>>(new Set());
  if (!state || !view) return null;

  // The inspector's own vision — allowed knowledge, computed from the true role.
  // Granularity comes from the acting role (Seer = exact, Aura Seer = werewolf-or-not).
  const resolveInspect = (targetId: string) => {
    const t = state.players.find((p) => p.id === targetId)!;
    const seatId = "seatId" in turn ? turn.seatId : "";
    const reveal = getRole(state.players.find((p) => p.id === seatId)!.roleId!).night?.reveal;
    const isWolf = getRole(t.roleId!).team === "werewolf";
    return {
      name: t.name,
      isWolf,
      label:
        reveal === "exactRole"
          ? `is the ${getRole(t.roleId!).name}`
          : isWolf
            ? "is a Werewolf!"
            : "is not a werewolf.",
    };
  };

  if (state.phase === "gameOver") {
    return (
      <div className="app">
        <GameOver view={view} onExit={() => { game.reset(); onExit(); }} />
      </div>
    );
  }

  // Public: night intro — a beat to recap the day and tell everyone eyes closed.
  if (state.phase === "night" && nightIntroRound !== state.round) {
    return (
      <Public title={`🌙 Night ${state.round}`} onExit={onExit}>
        <LogFeed log={publicLog(state)} players={publicPlayers(state)} />
        <p className="muted center">Everyone, close your eyes. Pass the device around as prompted.</p>
        <button className="primary full lg" onClick={() => setNightIntroRound(state.round)}>
          Begin night
        </button>
      </Public>
    );
  }

  // Public: day board.
  if (state.phase === "dayDiscussion") {
    return (
      <Public title={`☀️ Day ${state.round}`} onExit={onExit}>
        <LogFeed log={publicLog(state)} players={publicPlayers(state)} />
        <PlayerList players={publicPlayers(state)} youId="-" />
        <p className="muted center small">Discuss out loud. When ready, put it to a vote.</p>
        <button className="primary full lg" onClick={game.callVote}>Call a vote</button>
      </Public>
    );
  }

  // Private turns behind a handoff gate.
  const tid = turnId(turn, state.round);
  const seatId = "seatId" in turn ? turn.seatId : "";
  const seatName = state.players.find((p) => p.id === seatId)?.name ?? "";
  if (openedTurn !== tid) return <Handoff name={seatName} onOpen={() => setOpenedTurn(tid)} />;

  // First time this player holds the device: show their secret role (folds the
  // old separate role-reveal pass into the night, so the device circles once).
  if ((turn.kind === "night" || turn.kind === "nightPass") && !seenRole.has(seatId)) {
    return (
      <div className="app">
        <RoleCard view={view} />
        <div className="spacer" />
        <p className="muted center small">Memorize it — you'll act on it now, then pass the device on.</p>
        <button className="primary full lg" onClick={() => setSeenRole((s) => new Set(s).add(seatId))}>
          Continue →
        </button>
      </div>
    );
  }

  switch (turn.kind) {
    case "night":
      return <NightTurn view={view} resolveInspect={resolveInspect} onSubmit={game.submitNight} />;
    case "nightPass":
      return (
        <div className="app">
          <div className="spacer" />
          <div className="phase-banner"><div className="big">😴</div><h2>Nothing to do</h2><p className="muted">The night passes quietly for you.</p></div>
          <div className="spacer" />
          <button className="primary full lg" onClick={game.passNight}>Tap to pass on</button>
        </div>
      );
    case "vote":
      return <VoteTurn view={view} onSubmit={game.submitVote} />;
    default:
      return null;
  }
}

function NightTurn({
  view,
  resolveInspect,
  onSubmit,
}: {
  view: PlayerView;
  resolveInspect: (targetId: string) => { name: string; isWolf: boolean; label: string };
  onSubmit: (targetId: string) => void;
}) {
  const prompt = view.nightPrompt!;
  const role = getRole(prompt.roleId);
  const [picked, setPicked] = useState<string | null>(null);
  const [showResult, setShowResult] = useState(false);
  const packmates = view.players.filter((p) => view.packmates.includes(p.id));

  if (showResult && picked) {
    const r = resolveInspect(picked);
    return (
      <div className="app">
        <div className="rolecard">
          <div className="emoji">{r.isWolf ? "🐺" : "✅"}</div>
          <div className="rname">{r.name}</div>
          <div className="blurb">{r.label}</div>
        </div>
        <div className="spacer" />
        <button className="primary full lg" onClick={() => onSubmit(picked)}>Got it — hide & pass on</button>
      </div>
    );
  }

  const promptText =
    prompt.kind === "kill" ? "Choose tonight's victim" : prompt.kind === "protect" ? "Choose someone to protect" : "Choose someone to inspect";

  return (
    <div className="app">
      <div className="phase-banner"><div className="big">{role.emoji}</div><h2>{role.name}</h2><p className="muted">{promptText}</p></div>
      {packmates.length > 0 && (
        <p className="center small">🐺 Your pack: <b>{packmates.map((p) => p.name).join(", ")}</b></p>
      )}
      <TargetGrid view={view} ids={prompt.targetIds} selected={picked} groupChoices={prompt.groupChoices} onPick={setPicked} />
      <div className="spacer" />
      <button
        className="primary full lg"
        disabled={!picked}
        onClick={() => (prompt.kind === "inspect" ? setShowResult(true) : onSubmit(picked!))}
      >
        Confirm
      </button>
    </div>
  );
}

function VoteTurn({ view, onSubmit }: { view: PlayerView; onSubmit: (id: string | null) => void }) {
  const others = view.players.filter((p) => p.alive && p.id !== view.you.id);
  return (
    <div className="app">
      <div className="phase-banner"><div className="big">🗳️</div><h2>{view.you.name}, cast your vote</h2><p className="muted">Who should the town eliminate?</p></div>
      <TargetGrid view={view} ids={others.map((p) => p.id)} selected={null} onPick={(id) => onSubmit(id)} />
      <div className="spacer" />
      <button className="ghost full" onClick={() => onSubmit(null)}>Abstain</button>
    </div>
  );
}

function Handoff({ name, onOpen }: { name: string; onOpen: () => void }) {
  return (
    <div className="handoff" onClick={onOpen}>
      <div className="big" style={{ fontSize: "3rem" }}>📱➡️</div>
      <div className="to">Pass to {name}</div>
      <div className="sub">Only {name} should look. Tap when you're holding the device.</div>
      <button className="primary lg" onClick={onOpen}>I'm {name} — reveal</button>
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
