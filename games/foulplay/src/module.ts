import { GameError, type GameModule } from "@party/core";
import { MAX_PLAYERS, MIN_PLAYERS, defaultAccomplice, generateScenario } from "./generate.js";
import {
  createGame,
  projectView,
  reduce,
  type Action,
  type GameConfig,
  type GameState,
  type PlayerView,
} from "./game.js";

/** Foul Play as a platform game. */
export const foulplayModule: GameModule<GameConfig, GameState, PlayerView> = {
  id: "foulplay",
  name: "Foul Play",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,
  // Bump when the game state changes shape (see GameModule.stateVersion).
  stateVersion: 1,

  parseConfig(raw, players) {
    const c = (raw ?? {}) as Partial<GameConfig>;
    if (c.accomplice !== undefined && typeof c.accomplice !== "boolean")
      throw new GameError("Say whether there's an accomplice.");
    if (c.accomplice && players < 5) throw new GameError("An accomplice needs at least five players.");
    return { accomplice: c.accomplice ?? defaultAccomplice(players) };
  },

  start(seats, config, { seed }) {
    const scenario = generateScenario({ seed, players: seats.length, accomplice: config.accomplice });
    return createGame(scenario, seats, config);
  },

  // The engine checks every move itself, unknown ones included.
  act: (state, seatId, raw) => reduce(state, seatId, raw as Action),

  view: (state, seatId) => projectView(state, seatId),

  isOver: (state) => state.phase.kind === "over",
};
