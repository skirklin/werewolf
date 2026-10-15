import {
  MAX_PLAYERS,
  MIN_PLAYERS,
  defaultTurnLimit,
  type Action,
  type Assist,
  type GameConfig,
  type PlayerView,
} from "@party/deaddrop";
import type { ClientGame, LobbySettingsProps } from "../../shell/game.js";
import { DeadDropHome } from "./Home.js";
import { DeadDropTable } from "./Table.js";

const ASSISTS: { id: Assist; label: string; blurb: string }[] = [
  { id: "grid", label: "🧮 Full grid", blurb: "The app crosses things off and says why." },
  { id: "notes", label: "📝 Notes", blurb: "Clues are filed; the logic is yours." },
];

function Settings({ config, players, onChange }: LobbySettingsProps<GameConfig>) {
  const limit = config.turnLimit ?? defaultTurnLimit(players);
  return (
    <div className="stack">
      <div className="btn-row">
        <button className={config.mode === "competitive" ? "primary" : ""} onClick={() => onChange({ ...config, mode: "competitive", turnLimit: undefined })}>
          ⚔️ Competitive
        </button>
        <button className={config.mode === "coop" ? "primary" : ""} onClick={() => onChange({ ...config, mode: "coop" })}>
          🤝 Co-op
        </button>
      </div>
      <p className="muted small" style={{ margin: 0 }}>
        {config.mode === "competitive"
          ? "First correct accusation wins. A wrong one puts you out of the running."
          : "Everyone wins or loses together, with one accusation and a turn limit."}
      </p>
      {config.mode === "coop" && (
        <div className="spread">
          <span>Turn limit</span>
          <div className="btn-row" style={{ alignItems: "center" }}>
            <button className="small" disabled={limit <= players} onClick={() => onChange({ ...config, turnLimit: limit - players })}>−</button>
            <b className="count" style={{ minWidth: 40, textAlign: "center" }}>{limit}</b>
            <button className="small" onClick={() => onChange({ ...config, turnLimit: limit + players })}>+</button>
          </div>
        </div>
      )}
      <div className="muted small group-label">Notebook help</div>
      <div className="stack" style={{ gap: 6 }}>
        {ASSISTS.map((a) => (
          <button key={a.id} className={`full ${(config.assist ?? "grid") === a.id ? "primary" : ""}`} onClick={() => onChange({ ...config, assist: a.id })}>
            {a.label}
            <div className="small" style={{ fontWeight: 400, opacity: 0.8 }}>{a.blurb}</div>
          </button>
        ))}
      </div>
    </div>
  );
}

export const deaddrop: ClientGame<GameConfig, PlayerView, Action> = {
  id: "deaddrop",
  name: "Dead Drop",
  emoji: "🕵️",
  tagline: "Trade intel, unmask the mole.",
  Home: DeadDropHome,

  initialConfig(_players, last) {
    const l = (last ?? {}) as Partial<GameConfig>;
    // A config saved before the gauge was dropped falls back to the full grid.
    const assist = l.assist === "notes" ? "notes" : "grid";
    return { mode: l.mode === "coop" ? "coop" : "competitive", assist, turnLimit: l.turnLimit };
  },

  configProblems(_config, players) {
    if (players < MIN_PLAYERS) return [`Need at least ${MIN_PLAYERS} players.`];
    if (players > MAX_PLAYERS) return [`At most ${MAX_PLAYERS} can play.`];
    return [];
  },

  LobbySettings: Settings,
  Table: DeadDropTable,
};
