import { GameError, type GameModule } from "@party/core";
import { MAX_PLAYERS, MIN_PLAYERS, generateScenario } from "./generate.js";
import {
  createGame,
  projectView,
  reduce,
  type Action,
  type GameConfig,
  type GameState,
  type PlayerView,
} from "./game.js";

/** Dead Drop as a platform game. */
export const deaddropModule: GameModule<GameConfig, GameState, PlayerView> = {
  id: "deaddrop",
  name: "Dead Drop",
  minPlayers: MIN_PLAYERS,
  maxPlayers: MAX_PLAYERS,

  parseConfig(raw) {
    const c = (raw ?? {}) as Partial<GameConfig>;
    if (c.mode !== "competitive" && c.mode !== "coop") throw new GameError("Pick competitive or co-op.");
    if (c.turnLimit !== undefined && !(Number.isInteger(c.turnLimit) && c.turnLimit >= 1 && c.turnLimit <= 500))
      throw new GameError("The turn limit should be a whole number of turns.");
    if (c.assist !== undefined && !["notes", "gauge", "grid"].includes(c.assist))
      throw new GameError("Unknown level of notebook help.");
    return {
      mode: c.mode,
      assist: c.assist ?? "grid",
      ...(c.turnLimit !== undefined && c.mode === "coop" ? { turnLimit: c.turnLimit } : {}),
    };
  },

  start(seats, config, { seed }) {
    const scenario = generateScenario({ seed, players: seats.length });
    return createGame(scenario, seats, config);
  },

  act(state, seatId, raw) {
    const action = raw as Action;
    if (!action || !["ask", "give", "decline", "accuse"].includes(action.type))
      throw new GameError("Unsupported action.");
    return reduce(state, seatId, action);
  },

  view: (state, seatId) => projectView(state, seatId),

  isOver: (state) => state.phase.kind === "over",
};
