import { useState } from "react";
import {
  recommendedConfig,
  validateConfig,
  getRole,
  fabricatedInspect,
  fabricatedSameTeam,
  isWolfForWin,
  publicPlayers,
  publicLog,
  type GameConfig,
  type GameState,
  type PlayerView,
  type Turn,
} from "@party/werewolf";
import { useLocalGame } from "./local.js";
import { RoleConfigEditor } from "./config.js";
import { RoleCard, LogFeed } from "./ui.js";
import { TargetGrid, WitchPanel, SwapPanel, RaisePanel, SilencedNote, GameOver, PlayerList } from "./phases.js";

export function LocalApp({ onExit }: { onExit: () => void }) {
  const game = useLocalGame();
  if (!game.state) return <Setup onStart={game.start} onExit={onExit} />;
  return <LocalPlay game={game} onExit={onExit} />;
}

// ---------------------------------------------------------------------------
// Setup
// ---------------------------------------------------------------------------

/** Last game's roster (so families don't retype names every time), min 4 rows. */
function loadNames(): string[] {
  let saved: string[] = [];
  try {
    const raw = localStorage.getItem("werewolf.localNames");
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
      localStorage.setItem("werewolf.localNames", JSON.stringify(filled));
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
              <button className="ghost" onClick={() => setNames((ns) => ns.filter((_, j) => j !== i))}>✕</button>
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

  // The inspector's own vision, matching exactly what the engine will record.
  // Seer = exact role, Aura Seer = werewolf-or-not, and a Drunk mimicking either
  // gets a deterministic fake in the same format.
  const resolveInspect = (targetId: string) => {
    const t = state.players.find((p) => p.id === targetId)!;
    const seatId = "seatId" in turn ? turn.seatId : "";
    const seat = state.players.find((p) => p.id === seatId)!;
    const drunk = seat.roleId === "drunk";
    const effRole = state.drunkDisguise[seatId] ?? seat.roleId!;
    const format = getRole(effRole).night?.reveal ?? "exactRole";
    const reveal = drunk
      ? fabricatedInspect(state.seed, state.round, targetId, format)
      : format === "exactRole"
        ? t.roleId!
        : isWolfForWin(t.roleId!)
          ? "werewolf"
          : "not-werewolf";
    if (reveal === "werewolf") return { name: t.name, isWolf: true, label: "is a Werewolf." };
    if (reveal === "not-werewolf") return { name: t.name, isWolf: false, label: "is not a werewolf." };
    return { name: t.name, isWolf: false, label: `is the ${getRole(reveal).name}` };
  };

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
      <Public title={`🌙 Night ${state.round}`} onExit={onExit}>
        <LogFeed log={publicLog(state)} players={publicPlayers(state)} />
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
      <Public title={`☀️ Day ${state.round}`} onExit={onExit}>
        <LogFeed log={publicLog(state)} players={publicPlayers(state)} />
        <SilencedNote view={view} />
        <PlayerList players={publicPlayers(state)} youId="-" />
        <p className="muted center small">Talk it out. When you're ready, put it to a vote.</p>
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
        <p className="muted center small">Memorize it! You'll act on it now, then pass the phone along.</p>
        <button className="primary full lg" onClick={() => setSeenRole((s) => new Set(s).add(seatId))}>
          Got it →
        </button>
      </div>
    );
  }

  switch (turn.kind) {
    case "night":
      if (view.nightPrompt?.kind === "witch")
        return <WitchPanel view={view} onSubmit={game.submitWitch} />;
      if (view.nightPrompt?.kind === "swap")
        return <SwapPanel view={view} onSubmit={game.submitSwap} />;
      if (view.nightPrompt?.kind === "detect")
        return <DetectTurn state={state} view={view} onSubmit={game.submitDetect} />;
      if (view.nightPrompt?.kind === "raise")
        return <RaisePanel view={view} onSubmit={game.submitRaise} />;
      return <NightTurn view={view} resolveInspect={resolveInspect} onSubmit={game.submitNight} />;
    case "nightPass":
      return (
        <div className="app">
          <div className="spacer" />
          <div className="phase-banner"><div className="big">😴</div><h2>Nothing to do</h2><p className="muted">The night passes quietly for you.</p></div>
          <div className="spacer" />
          <button className="primary full lg" onClick={game.passNight}>Tap to pass the phone</button>
        </div>
      );
    case "shoot":
      return <ShootTurn view={view} onSubmit={game.submitShoot} />;
    case "vote":
      return <VoteTurn view={view} onSubmit={game.submitVote} />;
    default:
      return null;
  }
}

/** Detective in pass-device: pick two, see the same-team result, then pass on. */
function DetectTurn({
  state,
  view,
  onSubmit,
}: {
  state: GameState;
  view: PlayerView;
  onSubmit: (aId: string, bId: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const [result, setResult] = useState<[string, string] | null>(null);
  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : [cur[1], id]));

  if (result) {
    const [a, b] = result;
    const name = (id: string) => state.players.find((p) => p.id === id)!.name;
    const team = (id: string) => getRole(state.players.find((p) => p.id === id)!.roleId!).team;
    // A Drunk mimicking the Detective gets a deterministic fake verdict.
    const same = state.players.find((p) => p.id === view.you.id)?.roleId === "drunk"
      ? fabricatedSameTeam(state.seed, state.round, a, b)
      : team(a) === team(b);
    return (
      <div className="app">
        <div className="rolecard">
          <div className="emoji">{same ? "🤝" : "🎭"}</div>
          <div className="rname">{name(a)} & {name(b)}</div>
          <div className="blurb">{same ? "are on the same team." : "are on different teams."}</div>
        </div>
        <div className="spacer" />
        <button className="primary full lg" onClick={() => onSubmit(a, b)}>Seen it — hide & pass on</button>
      </div>
    );
  }

  return (
    <div className="app">
      <div className="phase-banner"><div className="big">🕵️</div><h2>Detective</h2><p className="muted">Investigate two players. Pick {2 - picked.length} more.</p></div>
      <TargetGrid view={view} ids={view.nightPrompt!.targetIds} selected={null} onPick={toggle} multi={picked} />
      <div className="spacer" />
      <button className="primary full lg" disabled={picked.length !== 2} onClick={() => setResult([picked[0], picked[1]])}>Investigate</button>
    </div>
  );
}

function ShootTurn({ view, onSubmit }: { view: PlayerView; onSubmit: (id: string) => void }) {
  return (
    <div className="app">
      <div className="phase-banner"><div className="big">🏹</div><h2>{view.you.name}, your dying shot</h2><p className="muted">You've fallen — take one player down with you.</p></div>
      <TargetGrid view={view} ids={view.shootPrompt!.targetIds} selected={null} onPick={onSubmit} />
    </div>
  );
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
        <button className="primary full lg" onClick={() => onSubmit(picked)}>Seen it — hide & pass on</button>
      </div>
    );
  }

  const promptText =
    prompt.kind === "kill" ? "Choose tonight's victim"
    : prompt.kind === "protect" ? "Choose someone to protect — never the same patient twice running"
    : prompt.kind === "silence" ? "Choose whose vote to silence tomorrow"
    : prompt.kind === "convert" ? "Choose someone to turn into a werewolf"
    : "Choose someone to inspect";

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
      <div className="sub">Eyes on the phone, {name} — and only you. Tap when you're holding it.</div>
      <button className="primary lg" onClick={onOpen}>I'm {name} — show me 👀</button>
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
