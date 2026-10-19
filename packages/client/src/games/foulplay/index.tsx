import { MAX_PLAYERS, MIN_PLAYERS, defaultAccomplice, type Action, type GameConfig, type PlayerView } from "@party/foulplay";
import type { ClientGame, LobbySettingsProps } from "../../shell/game.js";
import { FoulPlayHome } from "./Home.js";
import { FoulPlayTable } from "./Table.js";

function Settings({ config, players, onChange }: LobbySettingsProps<GameConfig>) {
  const accomplice = config.accomplice ?? defaultAccomplice(players);
  return (
    <div className="stack">
      {players >= 5 ? (
        <>
          <div className="btn-row">
            <button className={!accomplice ? "primary" : ""} onClick={() => onChange({ ...config, accomplice: false })}>
              🔪 Killer alone
            </button>
            <button className={accomplice ? "primary" : ""} onClick={() => onChange({ ...config, accomplice: true })}>
              🤝 With an accomplice
            </button>
          </div>
          <p className="muted small" style={{ margin: 0 }}>
            The accomplice knows the whole truth, and helps the killer pin it on someone else.
          </p>
        </>
      ) : (
        <p className="muted small" style={{ margin: 0 }}>One of you is the killer. No accomplice at four players.</p>
      )}
    </div>
  );
}

export const foulplay: ClientGame<GameConfig, PlayerView, Action> = {
  id: "foulplay",
  name: "Foul Play",
  emoji: "🔍",
  tagline: "Everyone had means, motive and opportunity. Only one of you did it.",
  beta: true,
  Home: FoulPlayHome,

  initialConfig(players, last) {
    const l = (last ?? {}) as Partial<GameConfig>;
    // Only carry the accomplice over if this table is big enough for one.
    return typeof l.accomplice === "boolean" && players >= 5 ? { accomplice: l.accomplice } : {};
  },

  configProblems(_config, players) {
    if (players < MIN_PLAYERS) return [`Need at least ${MIN_PLAYERS} players.`];
    if (players > MAX_PLAYERS) return [`At most ${MAX_PLAYERS} can play.`];
    return [];
  },

  LobbySettings: Settings,
  Table: FoulPlayTable,
};
