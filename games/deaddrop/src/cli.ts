import { parseArgs } from "node:util";
import { generateScenario } from "./generate.js";
import { Solver } from "./solver.js";
import { answerText, clueText, requirementText } from "./clues.js";
import { simulateGame } from "./simulate.js";
import type { Mode } from "./game.js";

/**
 * Print a scenario, or simulate bot games, so the content and the dealing
 * rules can be judged before there's any UI.
 *
 *   npm run deaddrop -- --seed 7 --players 4
 *   npm run deaddrop -- --sim 200 --players 4 --mode coop
 */
const { values } = parseArgs({
  options: {
    seed: { type: "string", default: String(Math.floor(Math.random() * 2 ** 31)) },
    players: { type: "string", default: "4" },
    sim: { type: "string" },
    mode: { type: "string", default: "competitive" },
    "turn-limit": { type: "string" },
  },
});
const seed = Number(values.seed);
const players = Number(values.players);

if (values.sim) {
  const games = Number(values.sim);
  const mode = values.mode as Mode;
  const limit = values["turn-limit"] ? Number(values["turn-limit"]) : undefined;
  const turns: number[] = [];
  const reasons = new Map<string, number>();
  for (let g = 0; g < games; g++) {
    const r = simulateGame(seed + g, players, mode, limit);
    turns.push(r.turns);
    reasons.set(r.reason, (reasons.get(r.reason) ?? 0) + 1);
  }
  turns.sort((a, b) => a - b);
  const q = (f: number) => turns[Math.min(turns.length - 1, Math.floor(f * turns.length))];
  console.log(`${games} ${mode} games, ${players} baseline bots`);
  console.log(`turns: median ${q(0.5)}, 10th pct ${q(0.1)}, 90th pct ${q(0.9)}, max ${turns[turns.length - 1]}`);
  console.log(`(about ${(q(0.5) / players).toFixed(1)} turns each at the median)`);
  for (const [r, n] of reasons) console.log(`  ${r}: ${n}`);
} else {
  const s = generateScenario({ seed, players });
  const d = s.dossier;
  const solver = new Solver(d);
  const clue = (id: number) => s.clues[id];
  const left = (ids: number[]) => solver.remaining(ids.map(clue));

  console.log(`${d.title} — seed ${seed}, ${players} players\n`);
  console.log("SUSPECTS");
  for (const a of d.agents) {
    const traits = d.traits.map((t) => t.values.find((v) => v.id === a.traits[t.id])!.label);
    console.log(`  ${a.name.padEnd(20)} ${traits.join(", ")}`);
  }
  console.log("\nROOMS");
  for (const r of d.rooms) console.log(`  ${r.name.padEnd(10)} [${r.features.join(", ")}]`);
  console.log("\nDEVICES");
  for (const x of d.devices)
    console.log(`  ${x.name.padEnd(26)} hidden ${d.rooms[x.location].preposition} the ${d.rooms[x.location].name}. ${requirementText(d, x.requirement)}`);

  console.log(`\nBefore any clues: ${solver.remaining([])} possible answers.`);
  console.log(`\nPUBLIC (${left(s.publicClues)} answers left)`);
  for (const id of s.publicClues) console.log(`  ${clueText(d, clue(id))}`);
  s.hands.forEach((hand, p) => {
    console.log(`\nPLAYER ${p + 1} (alone: ${left([...s.publicClues, ...hand])} answers left)`);
    for (const id of hand) console.log(`  ${clueText(d, clue(id))}`);
  });
  const all = s.clues.map((c) => c.id);
  console.log(`\nEverything together: ${left(all)} answer(s).`);
  console.log(`SOLUTION: ${answerText(d, s.secret.answer)}`);
}
