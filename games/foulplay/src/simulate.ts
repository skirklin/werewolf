import { generateScenario, type GenerateOptions } from "./generate.js";
import { createGame, projectView, reduce, type GameState } from "./game.js";
import { botMove } from "./bot.js";
import { Solver } from "./solver.js";
import { makeRng } from "./rng.js";

export interface SimResult {
  rounds: number;
  turns: number;
  caught: boolean;
  by: "proof" | "unprovable" | "outnumbered" | "dawn";
  murders: number;
  burned: number;
}

/** Play one bot-only game to the end. */
export function simulateGame(
  seed: number,
  players: number,
  opts: { accomplice?: boolean; rounds?: number; murders?: number; gen?: Partial<GenerateOptions> } = {}
): SimResult {
  const scenario = generateScenario({ seed, players, accomplice: opts.accomplice, ...opts.gen });
  const seats = Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `Bot ${i + 1}` }));
  let state: GameState = createGame(scenario, seats, { accomplice: opts.accomplice, rounds: opts.rounds, murders: opts.murders });
  const solver = new Solver(scenario.dossier);
  const rng = makeRng(seed ^ 0x5eed);
  for (let guard = 0; guard < 20_000 && state.phase.kind !== "over"; guard++) {
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
  return {
    rounds: state.round,
    turns: state.turnsTaken,
    caught: state.phase.caught,
    by: state.phase.by,
    murders: state.log.filter((e) => e.t === "murder").length,
    burned: state.secretly.length,
  };
}
