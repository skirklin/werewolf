import { generateScenario } from "./generate.js";
import { createGame, projectView, reduce, type GameState, type Mode } from "./game.js";
import { botMove } from "./bot.js";
import { Solver } from "./solver.js";
import { makeRng } from "./rng.js";

export interface SimResult {
  turns: number;
  reason: string;
  winners: number;
}

/** Play one bot-only game to the end. */
export function simulateGame(seed: number, players: number, mode: Mode, turnLimit?: number): SimResult {
  const scenario = generateScenario({ seed, players });
  const seats = Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `Bot ${i + 1}` }));
  let state: GameState = createGame(scenario, seats, { mode, turnLimit });
  const solver = new Solver(scenario.dossier);
  const rng = makeRng(seed ^ 0x5eed);
  for (let guard = 0; guard < 10_000 && state.phase.kind !== "over"; guard++) {
    let moved = false;
    for (const p of state.players) {
      const action = botMove(projectView(state, p.id), solver, rng);
      if (action) {
        state = reduce(state, p.id, action);
        moved = true;
        break;
      }
    }
    if (!moved) throw new Error("Simulation stalled: nobody could move.");
  }
  if (state.phase.kind !== "over") throw new Error("Simulation ran away.");
  return { turns: state.turnsTaken, reason: state.phase.reason, winners: state.phase.winners.length };
}
