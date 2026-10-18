import { parseArgs } from "node:util";
import { generateScenario } from "./generate.js";
import { answerText, atPlace, clueText, placeName, requirementText } from "./clues.js";
import { simulateGame, type SimResult } from "./simulate.js";

/**
 * Print a case, or simulate bot games, so the content and the dealing rules
 * can be judged before there's any UI.
 *
 *   npm run foulplay -- --seed 7 --players 5
 *   npm run foulplay -- --sim 200 --players 5
 */
const { values } = parseArgs({
  options: {
    seed: { type: "string", default: String(Math.floor(Math.random() * 2 ** 31)) },
    players: { type: "string", default: "5" },
    sim: { type: "string" },
    accomplice: { type: "string" },
    rounds: { type: "string" },
  },
});
const seed = Number(values.seed);
const players = Number(values.players);
const accomplice = values.accomplice === undefined ? undefined : values.accomplice === "yes";

if (values.sim) {
  const games = Number(values.sim);
  const results: SimResult[] = [];
  for (let g = 0; g < games; g++)
    results.push(
      simulateGame(seed + g, players, {
        accomplice,
        rounds: values.rounds ? Number(values.rounds) : undefined,
      })
    );
  const share = (f: (r: SimResult) => boolean) => `${Math.round((100 * results.filter(f).length) / games)}%`;
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(`${games} games, ${players} baseline bots`);
  console.log(`killer wins: ${share((r) => !r.caught)}`);
  for (const by of ["trial", "outnumbered", "dawn"] as const) {
    console.log(`  ended by ${by.padEnd(12)} caught ${share((r) => r.by === by && r.caught)}, got away ${share((r) => r.by === by && !r.caught)}`);
  }
  console.log(`median rounds: ${median(results.map((r) => r.rounds))}, turns: ${median(results.map((r) => r.turns))}`);
  const mean = (xs: number[]) => (xs.reduce((a, b) => a + b, 0) / xs.length).toFixed(2);
  console.log(`reconstructions a game: innocents ${mean(results.map((r) => r.calls.innocent))}, guilty ${mean(results.map((r) => r.calls.guilty))}`);
  console.log(`median murders: ${median(results.map((r) => r.murders))}, cards destroyed: ${median(results.map((r) => r.burned))}`);
} else {
  const s = generateScenario({ seed, players, accomplice });
  const d = s.dossier;
  const role = (i: number) => (i === s.killer ? " (KILLER)" : i === s.accomplice ? " (accomplice)" : "");
  console.log(`${d.title} — seed ${seed}, ${players} players\n`);
  console.log("GUESTS (and their one memory)");
  for (const a of d.agents) console.log(`  ${(a.name + role(a.id)).padEnd(30)} ${s.memories[a.id].map((id) => clueText(d, s.clues[id])).join(" ")}`);
  console.log("\nSTORIES (and evenings)");
  for (const a of d.agents)
    console.log(`  ${a.name.padEnd(18)} ${answerText(d, s.stories[a.id])}. Went to: ${s.secret.visits[a.id].map((r) => d.rooms[r].name).join(", ")}`);
  console.log("\nWEAPONS");
  for (const x of d.devices)
    console.log(`  ${x.name.padEnd(16)} kept ${atPlace(d, x.location)}. ${requirementText(d, x.requirement)}`);
  console.log("\nTHE HOUSE");
  s.stacks.forEach((stack, place) => {
    console.log(`  ${placeName(d, place)}`);
    for (const id of stack) console.log(`    ${clueText(d, s.clues[id])}`);
  });
  console.log(`\nSOLUTION: ${answerText(d, s.secret.answer)}`);
}
