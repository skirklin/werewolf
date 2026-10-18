import type { Answer, Clue } from "./types.js";
import { selfKnowledge, type Action, type Part, type PlayerView } from "./game.js";
import { breaks } from "./clues.js";
import { Solver, sameAnswer } from "./solver.js";
import type { Rng } from "./rng.js";
import { pick } from "./rng.js";

/**
 * A baseline player for simulations and practice. Its job is to be a
 * yardstick, not to play well, and it doesn't talk.
 *
 * Innocent: testifies what it finds, except sightings that fit its own
 * story, which it burns. Each turn it heads for the room with the most
 * evidence left or joins someone. It calls the Reconstruction once what it
 * knows leaves one answer, and agrees to one that fits what it knows when
 * there's little else it could be.
 *
 * The guilty pick someone to frame: the innocent whose story the record
 * hasn't broken, with the fewest cards left that could break it. They burn
 * those cards (the killer knows where they are and goes for them), and call
 * the Reconstruction on that story once the record can't tell it from the
 * truth. At night the killer murders a guest left alone, or destroys a card
 * in an empty room.
 */
export function botMove(view: PlayerView, solver: Solver, rng: Rng): Action | null {
  const phase = view.phase;
  const seat = view.you.seat;
  const g = view.guilty;
  const clue = (id: number) => view.you.known.find((c) => c.id === id)!;

  if (phase.kind === "vote" && view.voted && !view.voted[seat]) return { type: "vote", value: dawnVote(view, solver, rng) };
  if (phase.kind === "trial" && view.voted && !view.voted[seat]) return { type: "verdict", agree: agrees(view, solver, phase.answer) };

  const target = g ? frameTarget(view) : null;

  if (phase.kind === "night" && phase.active === seat) {
    if (view.you.role !== "killer" || !view.night || !g?.stacks) return { type: "night" };
    const { alone, emptyRooms } = view.night;
    if (alone.length && rng() < 0.4) return { type: "night", plan: { murder: pick(alone, rng) } };
    const best = emptyRooms
      .map((place) => ({ place, score: harm(g.stacks![place][0], view, target) }))
      .sort((a, b) => b.score - a.score)[0];
    if (best && best.score >= 2) return { type: "night", plan: { destroy: best.place } };
    if (alone.length) return { type: "night", plan: { murder: pick(alone, rng) } };
    if (best && best.score >= 1) return { type: "night", plan: { destroy: best.place } };
    return { type: "night", plan: { rest: true } };
  }

  if (phase.kind !== "turn" || phase.active !== seat) return null;

  // Free moves first: show what helps, get rid of what doesn't.
  const found = view.you.hand.filter((id) => view.you.how[id]?.via !== "memory");
  if (g) {
    const bad = found.find((id) => harm(clue(id), view, target) >= 1);
    if (bad !== undefined) return { type: "burn", card: bad };
  } else {
    const mine = found.find((id) => pointsAtMe(clue(id), view));
    if (mine !== undefined) return { type: "burn", card: mine };
    if (view.you.hand.length) return { type: "testify", card: view.you.hand[0] };
  }

  const here = view.players[seat].place;
  const others = view.players.filter((p, i) => p.alive && i !== seat);
  const someoneAt = (place: number) => view.players.some((p, i) => p.alive && i !== seat && p.place === place);

  if (phase.step === "move") {
    const call = reconstruction(view, solver, target);
    if (call) return { type: "accuse", answer: call };
    if (g?.stacks) {
      // The killer: the most damaging card it can get at with nobody watching.
      const best = g.stacks
        .map((stack, place) => ({ place, score: stack.length ? harm(stack[0], view, target) : 0 }))
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

/** A sighting that fits the story the house tells about you. */
function pointsAtMe(c: Clue, view: PlayerView): boolean {
  return c.kind === "seen" && c.agent === view.you.seat;
}

/**
 * Who the guilty frame: a living innocent whose story the record hasn't
 * broken, with the fewest cards left that could break it (as far as the
 * guilty can see). Both of them work it out the same way, so they agree.
 */
export function frameTarget(view: PlayerView): number | null {
  const g = view.guilty;
  if (!g) return null;
  const d = view.dossier;
  const record = publicCards(view);
  const open = view.players
    .map((_, i) => i)
    .filter((i) => view.players[i].alive && i !== g.killer && i !== g.accomplice)
    .filter((i) => !record.some((c) => breaks(d, c, g.stories[i], g.evenings[i])));
  if (!open.length) return null;
  const left = (i: number) =>
    g.stacks ? g.stacks.flat().filter((c) => breaks(d, c, g.stories[i], g.evenings[i])).length : 0;
  return open.sort((a, b) => left(a) - left(b) || a - b)[0];
}

/**
 * How much a card hurts the guilty: breaking the story they're pinning on
 * someone is the worst; a sighting of one of them, or anything that clears
 * some other innocent, still helps the table.
 */
function harm(c: Clue | undefined, view: PlayerView, target: number | null): number {
  const g = view.guilty;
  if (!c || !g) return 0;
  const d = view.dossier;
  if (target !== null && breaks(d, c, g.stories[target], g.evenings[target])) return 3;
  if (c.kind === "seen" && (c.agent === g.killer || c.agent === g.accomplice)) return 2;
  if (c.kind === "moleTrait" && c.is) return 2;
  const clears = view.players.some(
    (p, i) => p.alive && i !== g.killer && i !== g.accomplice && breaks(d, c, g.stories[i], g.evenings[i])
  );
  return clears ? 1 : 0;
}

/** Whether to call the Reconstruction now, and on what. */
function reconstruction(view: PlayerView, solver: Solver, target: number | null): Answer | null {
  if (view.you.called) return null;
  const g = view.guilty;
  if (g) {
    if (target === null || view.round < 3) return null;
    // Once the record can't tell the frame from the truth, try it.
    const story = g.stories[target];
    const record = publicCards(view);
    const fits = solver.consistent([...record, ...storyAsCards(view, story)]);
    return fits && solver.remaining(record) <= 6 ? story : null;
  }
  const a = solver.analyze(believed(view));
  if (a.solved) return a.solved;
  // Near enough, late enough: go with the likeliest.
  if (view.round < view.rounds || a.remaining > 2) return null;
  return likeliest(solver, believed(view));
}

/** The answer whose parts each fit the most of what's left. */
function likeliest(solver: Solver, clues: Clue[]): Answer | null {
  const sp = solver.space;
  const a = solver.analyze(clues);
  let best: Answer | null = null;
  let score = -1;
  for (const k of sp.answers(a.candidates)) {
    const x = sp.answerOfKey(k);
    const s = a.marginals.agent[x.agent] * a.marginals.device[x.device] * a.marginals.room[x.room];
    if (s > score) [best, score] = [x, s];
  }
  return best;
}

/** Agree to a Reconstruction? */
function agrees(view: PlayerView, solver: Solver, answer: Answer): boolean {
  const g = view.guilty;
  if (g) return !sameAnswer(answer, g.answer);
  const mine = believed(view);
  if (!solver.consistent([...mine, ...storyAsCards(view, answer)])) return false;
  const a = solver.analyze(mine);
  if (a.remaining <= 1) return true;
  // Little else it could be, and nobody looks likelier.
  const top = Math.max(...a.marginals.agent);
  return a.remaining <= 2 && a.marginals.agent[answer.agent] === top;
}

/** An answer as cards, so the solver can check it against what's known. */
function storyAsCards(view: PlayerView, a: Answer): Clue[] {
  return [
    { kind: "isRoom", room: a.room, id: -200 },
    { kind: "isDevice", device: a.device, id: -201 },
    ...view.dossier.agents.filter((x) => x.id !== a.agent).map((x, i): Clue => ({ kind: "notAgent", agent: x.id, id: -210 - i })),
  ];
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
    // Push the table toward the frame, or failing that the likeliest-looking wrong answer.
    const target = frameTarget(view);
    const truth = g.answer[phase.part];
    if (target !== null && g.stories[target][phase.part] !== truth && phase.options.includes(g.stories[target][phase.part]))
      return g.stories[target][phase.part];
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
