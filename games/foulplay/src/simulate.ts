import { generateScenario, type GenerateOptions } from "./generate.js";
import { createGame, projectView, reduce, type GameState } from "./game.js";
import { botMove } from "./bot.js";
import { Solver } from "./solver.js";
import { makeRng } from "./rng.js";

export interface SimResult {
  turns: number;
  result: "caught" | "wrong";
  by: "inquest" | "dawn";
  /** How many answers the public record left at the end. */
  publicLeft: number;
  /** How many answers everything the innocents had seen, pooled, left. */
  pooledLeft: number;
  struck: boolean;
}

/** Play one bot-only game to the end. */
export function simulateGame(
  seed: number,
  players: number,
  opts: { accomplice?: boolean; rounds?: number; gen?: Partial<GenerateOptions> } = {}
): SimResult {
  const scenario = generateScenario({ seed, players, accomplice: opts.accomplice, ...opts.gen });
  const seats = Array.from({ length: players }, (_, i) => ({ id: `p${i}`, name: `Bot ${i + 1}` }));
  let state: GameState = createGame(scenario, seats, { accomplice: opts.accomplice, rounds: opts.rounds });
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
  const clue = (id: number) => scenario.clues[id];
  const forged = new Set(scenario.forged);
  const pooled = new Set(state.players.filter((p) => p.role === "innocent").flatMap((p) => p.known));
  return {
    turns: state.turnsTaken,
    result: state.phase.result,
    by: state.phase.by,
    publicLeft: solver.remaining(state.record.map((r) => clue(r.clue)).filter((c) => !forged.has(c.id))),
    pooledLeft: solver.remaining([...pooled].filter((id) => !forged.has(id)).map(clue)),
    struck: state.strikeDone,
  };
}
