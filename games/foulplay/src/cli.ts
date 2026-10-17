import { parseArgs } from "node:util";
import { generateScenario } from "./generate.js";
import { Solver } from "./solver.js";
import { answerText, clueText, leadOfKey, leadText, requirementText } from "./clues.js";
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
    witness: { type: "string" },
    "hand-size": { type: "string" },
  },
});
const seed = Number(values.seed);
const players = Number(values.players);
const accomplice = values.accomplice === undefined ? undefined : values.accomplice === "yes";

if (values.sim) {
  const games = Number(values.sim);
  const results: SimResult[] = [];
  for (let g = 0; g < games; g++) results.push(
      simulateGame(seed + g, players, {
        accomplice,
        rounds: values.rounds ? Number(values.rounds) : undefined,
        gen: {
          ...(values.witness ? { witnessChance: Number(values.witness) } : {}),
          ...(values["hand-size"] ? { handSize: Number(values["hand-size"]) } : {}),
        },
      })
    );
  const share = (f: (r: SimResult) => boolean) => `${Math.round((100 * results.filter(f).length) / games)}%`;
  const median = (xs: number[]) => [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)];
  console.log(`${games} games, ${players} baseline bots`);
  console.log(`killer wins: ${share((r) => r.result !== "caught")}`);
  console.log(`  caught at an inquest: ${share((r) => r.result === "caught" && r.by === "inquest")}`);
  console.log(`  caught at dawn:       ${share((r) => r.result === "caught" && r.by === "dawn")}`);
  console.log(`  wrong at an inquest:  ${share((r) => r.result === "wrong" && r.by === "inquest")}`);
  console.log(`  wrong at dawn:        ${share((r) => r.result === "wrong" && r.by === "dawn")}`);
  console.log(`second strike used: ${share((r) => r.struck)}`);
  console.log(`median answers left on the public record: ${median(results.map((r) => r.publicLeft))}`);
  console.log(`median answers left from all the innocents saw: ${median(results.map((r) => r.pooledLeft))}`);
  console.log(`median turns: ${median(results.map((r) => r.turns))}`);
} else {
  const s = generateScenario({ seed, players, accomplice });
  const d = s.dossier;
  const solver = new Solver(d);
  const clue = (id: number) => s.clues[id];
  const left = (ids: number[]) => solver.remaining(ids.map(clue));
  const role = (i: number) => (i === s.killer ? " (KILLER)" : i === s.accomplice ? " (accomplice)" : "");

  console.log(`${d.title} — seed ${seed}, ${players} players\n`);
  console.log("GUESTS");
  for (const a of d.agents) {
    const traits = d.traits.map((t) => t.values.find((v) => v.id === a.traits[t.id])!.label);
    console.log(`  ${(a.name + role(a.id)).padEnd(30)} ${traits.join(", ")}`);
  }
  console.log("\nROOMS");
  for (const r of d.rooms) console.log(`  ${r.name.padEnd(10)} [${r.features.join(", ")}]`);
  console.log("\nWEAPONS");
  for (const x of d.devices)
    console.log(`  ${x.name.padEnd(16)} kept ${d.rooms[x.location].preposition} the ${d.rooms[x.location].name}. ${requirementText(d, x.requirement)}`);

  console.log(`\nBefore any evidence: ${solver.remaining([])} possible answers.`);
  s.hands.forEach((hand, p) => {
    console.log(`\n${d.agents[p].name}${role(p)} remembers (alone: ${left(hand)} answers left)`);
    for (const id of hand) console.log(`  ${clueText(d, clue(id))}`);
  });
  console.log("\nLEADS");
  for (const [key, ids] of Object.entries(s.stacks)) {
    const lead = leadOfKey(key);
    console.log(`  ${lead ? leadText(d, lead) : key}`);
    for (const id of ids) console.log(`    ${clueText(d, clue(id))}`);
  }
  console.log("\nFORGERIES");
  for (const f of s.forgeries.killer) console.log(`  killer, ${leadText(d, f.lead)}: ${clueText(d, clue(f.clue))}`);
  for (const f of s.forgeries.accomplice) console.log(`  accomplice, ${leadText(d, f.lead)}: ${clueText(d, clue(f.clue))}`);
  console.log(`\nSOLUTION: ${answerText(d, s.secret.answer)}`);
}
