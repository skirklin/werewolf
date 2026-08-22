import type { Strategy } from "./strategy.js";
import { RandomStrategy } from "./strategies/random.js";
import { HeuristicStrategy } from "./strategies/heuristic.js";
import { LlmStrategy } from "./strategies/llm.js";
import { getPlaybook, PLAYBOOKS } from "./playbooks.js";

export const STRATEGY_HELP = `Strategies
  random           picks legal moves at random, never speaks — the control
  heuristic        plays its own information, no reading of what others say
  llm              a Claude agent per seat, sees only that seat's view
  llm+PLAYBOOK     an llm seat using a named prompt variant
  llm@MODEL        an llm seat pinned to a specific model, e.g. llm@claude-sonnet-5
  llm+PLAYBOOK@MODEL   both

Playbooks: ${Object.keys(PLAYBOOKS).join(", ")}

A lineup is a comma-separated list of "name:count" (order doesn't matter — seats
are dealt roles at random either way).`;

/**
 * Expand `"llm:4,heuristic:3"` into one strategy name per seat. A bare name
 * without a count means a single seat.
 */
export function parseLineup(spec: string): string[] {
  const seats: string[] = [];
  for (const part of spec.split(",")) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    const [name, count] = trimmed.split(":");
    const n = count === undefined ? 1 : Number(count);
    if (!Number.isInteger(n) || n < 1) throw new Error(`Bad seat count in "${trimmed}".`);
    for (let i = 0; i < n; i++) seats.push(name.trim());
  }
  return seats;
}

/**
 * Build one strategy instance from its spec: `kind[+playbook][@model]`.
 * `defaultModel` and `defaultPlaybook` fill in whatever the spec leaves out.
 */
export function makeStrategy(
  spec: string,
  defaultModel?: string,
  defaultPlaybook?: string
): Strategy {
  const [before, model] = spec.split("@");
  const [kind, playbook] = before.split("+");
  switch (kind) {
    case "random":
      return new RandomStrategy();
    case "heuristic":
      return new HeuristicStrategy();
    case "llm": {
      const chosen = playbook ?? defaultPlaybook;
      return new LlmStrategy({
        model: model ?? defaultModel,
        playbook: chosen ? getPlaybook(chosen) : undefined,
      });
    }
    default:
      throw new Error(
        `Unknown strategy "${spec}". Known: random, heuristic, llm[+playbook][@model].`
      );
  }
}
