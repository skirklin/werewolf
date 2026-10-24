import {
  recommendedConfig,
  validateConfig,
  type GameConfig,
  type PlayerView,
  type WerewolfAction,
} from "@party/werewolf";
import type { ClientGame } from "../../shell/game.js";
import { WerewolfHome } from "./Home.js";
import { WerewolfTable } from "./Table.js";
import { RoleConfigEditor } from "./config.js";
import { WhatsNew } from "./WhatsNew.js";

export const werewolf: ClientGame<GameConfig, PlayerView, WerewolfAction> = {
  id: "werewolf",
  name: "Werewolf",
  emoji: "🐺",
  tagline: "Villagers, wolves, and a truly alarming amount of lying.",
  Home: WerewolfHome,

  /**
   * Reuse the last game's setup if it still fits the table — it may not, or
   * may name a role this client doesn't know, which makes validateConfig throw.
   */
  initialConfig(players, last) {
    try {
      if (last && validateConfig(last as GameConfig, players).length === 0) return last as GameConfig;
    } catch {
      /* unknown role id — fall through to the defaults */
    }
    return recommendedConfig(players);
  },

  configProblems: (config, players) => validateConfig(config, players).map((p) => p.message),

  LobbySettings: ({ config, players, onChange }) => (
    <RoleConfigEditor config={config} playerCount={players} onChange={onChange} online />
  ),

  LobbyNotes: WhatsNew,

  Table: WerewolfTable,
};
