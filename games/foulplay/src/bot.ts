import type { Answer, Clue } from "./types.js";
import { selfKnowledge, type Action, type Part, type PlayerView } from "./game.js";
import { Solver } from "./solver.js";
import type { Rng } from "./rng.js";
import { pick } from "./rng.js";

/**
 * A baseline player for simulations and practice. Its job is to be a
 * yardstick, not to play well, and it doesn't talk.
 *
 * Innocent: testifies whatever it holds, and each turn either heads for the
 * room with the most evidence left or joins someone (so its search, or
 * theirs, is witnessed).
 *
 * Killer: knows where everything is. It goes for the most damaging card it
 * can reach unwatched, searches it up and burns it; otherwise it tags along
 * with someone. At night it murders a guest left alone, or destroys a card
 * in an empty room.
 *
 * Accomplice: searches alone when it can, and burns anything that points at
 * the killer.
 */
export function botMove(view: PlayerView, solver: Solver, rng: Rng): Action | null {
  const phase = view.phase;
  const seat = view.you.seat;
  const g = view.guilty;
  const clue = (id: number) => view.you.known.find((c) => c.id === id)!;

  if (phase.kind === "vote" && view.voted && !view.voted[seat]) return { type: "vote", value: dawnVote(view, solver, rng) };

  if (phase.kind === "night" && phase.active === seat) {
    if (view.you.role !== "killer" || !view.night || !g?.stacks) return { type: "night" };
    const { alone, emptyRooms } = view.night;
    if (alone.length && rng() < 0.6) return { type: "night", plan: { murder: pick(alone, rng) } };
    const target = emptyRooms
      .map((place) => ({ place, score: harm(g.stacks![place][0], view) }))
      .sort((a, b) => b.score - a.score)[0];
    if (target && target.score >= 2) return { type: "night", plan: { destroy: target.place } };
    if (alone.length) return { type: "night", plan: { murder: pick(alone, rng) } };
    return { type: "night", plan: { rest: true } };
  }

  if (phase.kind !== "turn" || phase.active !== seat) return null;

  // Free moves first: the innocent shows what it holds; the guilty get rid of it.
  const found = view.you.hand.filter((id) => view.you.how[id]?.via !== "memory");
  if (g) {
    const bad = found.find((id) => harm(clue(id), view) >= 1);
    if (bad !== undefined) return { type: "burn", card: bad };
  } else if (view.you.hand.length) return { type: "testify", card: view.you.hand[0] };

  const here = view.players[seat].place;
  const others = view.players.filter((p, i) => p.alive && i !== seat);
  const someoneAt = (place: number) => view.players.some((p, i) => p.alive && i !== seat && p.place === place);

  if (phase.step === "move") {
    if (g?.stacks) {
      // The killer: the most damaging card it can get at with nobody watching.
      const best = g.stacks
        .map((stack, place) => ({ place, score: stack.length ? harm(stack[0], view) : 0 }))
        .filter((x) => x.score >= 1 && !someoneAt(x.place))
        .sort((a, b) => b.score - a.score || (a.place === here ? -1 : 1))[0];
      if (best) return best.place === here ? { type: "stay" } : { type: "move", to: best.place };
      return others.length ? { type: "join", who: pick(others, rng).id } : { type: "stay" };
    }
    if (g) {
      // The accomplice: somewhere quiet with something in it.
      const quiet = view.counts.flatMap((n, place) => (n && !someoneAt(place) ? [place] : []));
      if (quiet.length && rng() < 0.7) return { type: "move", to: pick(quiet, rng) };
      return others.length ? { type: "join", who: pick(others, rng).id } : { type: "stay" };
    }
    // An innocent: join someone now and then, otherwise go where the evidence is.
    if (others.length && rng() < 0.35) {
      const withCards = others.filter((p) => view.counts[p.place] > 0);
      return { type: "join", who: pick(withCards.length ? withCards : others, rng).id };
    }
    const most = Math.max(...view.counts);
    if (most === 0) return { type: "stay" };
    const rich = view.counts.flatMap((n, place) => (n === most ? [place] : []));
    return rich.includes(here) ? { type: "stay" } : { type: "move", to: pick(rich, rng) };
  }

  if (phase.step === "wrap") return { type: "end" };

  // Act.
  if (!view.counts[here]) return { type: "watch" };
  if (g && someoneAt(here)) return { type: "watch" }; // don't hand them evidence
  return { type: "search" };
}

/**
 * How much a card hurts the guilty, as the guilty see it. The killer knows
 * everything; the accomplice only knows who, so it judges by whether a card
 * points at the killer.
 */
function harm(c: Clue | undefined, view: PlayerView): number {
  const g = view.guilty;
  if (!c || !g) return 0;
  const killer = g.killer;
  const looks = view.dossier.agents[killer].traits;
  switch (c.kind) {
    case "moleTrait":
      return c.is && looks[c.trait] === c.value ? 3 : 1;
    case "visitors":
      return c.agents.includes(killer) ? 3 : 1;
    case "whereabouts":
      return c.agent === killer ? 3 : 1;
    case "isRoom":
    case "isDevice":
    case "handoffFeature":
      return g.answer ? 3 : 1;
    case "notRoom":
    case "notDevice":
      return 1;
    default:
      return 0;
  }
}

/** The cards everyone has seen: the public record. */
export function publicCards(view: PlayerView): Clue[] {
  const ids = new Set(view.record.map((r) => r.clue));
  return view.you.known.filter((c) => ids.has(c.id));
}

/** What a player goes on: their role, and everything they've seen (it's all true). */
export function believed(view: PlayerView): Clue[] {
  return [...selfKnowledge(view), ...view.you.known];
}

function dawnVote(view: PlayerView, solver: Solver, rng: Rng): number {
  const phase = view.phase as Extract<PlayerView["phase"], { kind: "vote" }>;
  const g = view.guilty;
  const counts = (clues: Clue[]) => marginalsGiven(solver, clues, view.accusation, phase.part);
  if (g) {
    // Push the table toward the likeliest-looking wrong answer.
    const truth = g.answer?.[phase.part] ?? (phase.part === "agent" ? g.killer : null);
    const wrong = phase.options.filter((v) => v !== truth);
    const c = counts(publicCards(view));
    const from = wrong.length ? wrong : phase.options;
    const top = Math.max(...from.map((v) => c[v] ?? 0));
    return pick(from.filter((v) => (c[v] ?? 0) === top), rng);
  }
  // Innocents settle a dead heat the same way every time, so they vote together.
  const c = counts(believed(view));
  const p = counts(publicCards(view));
  const score = (v: number) => (c[v] ?? 0) * 1000 + (p[v] ?? 0);
  const top = Math.max(...phase.options.map(score));
  return Math.min(...phase.options.filter((v) => score(v) === top));
}

/** Per value of `part`, how many answers fit these cards and the accusation so far. */
function marginalsGiven(solver: Solver, clues: Clue[], so: Partial<Answer>, part: Part): number[] {
  const sp = solver.space;
  const d = sp.dossier;
  const out = new Array<number>(part === "agent" ? d.agents.length : part === "device" ? d.devices.length : d.rooms.length).fill(0);
  for (const k of sp.answers(solver.candidates(clues))) {
    const a = sp.answerOfKey(k);
    if ((so.agent ?? a.agent) !== a.agent || (so.device ?? a.device) !== a.device || (so.room ?? a.room) !== a.room) continue;
    out[a[part]]++;
  }
  return out;
}
