import type { Answer, Clue, Lead } from "./types.js";
import { selfKnowledge, type Action, type Part, type PlayerView } from "./game.js";
import { leadKey } from "./clues.js";
import { Solver } from "./solver.js";
import type { Rng } from "./rng.js";
import { pick } from "./rng.js";

/**
 * A baseline player for simulations and practice. Its job is to be a
 * yardstick, not to play well.
 *
 * Innocent: trusts its own memories most, then the public record, then what
 * it drew, then what it was shown, and sets aside whatever contradicts what
 * it trusts more. It investigates leads that could still tell it something,
 * testifies now and then, calls an inquest once it's sure, and votes for
 * whatever it believes.
 *
 * Guilty: plants its forgeries, buries evidence, strikes once in the second
 * round, and votes for whatever the public record makes look likeliest, as
 * long as it's wrong.
 */
export function botMove(view: PlayerView, solver: Solver, rng: Rng): Action | null {
  const phase = view.phase;
  const seat = view.you.seat;
  const guilty = view.guilty;
  const clue = (id: number) => view.you.known.find((c) => c.id === id)!;

  if (phase.kind === "confer" && phase.with === seat) {
    // Show something. The guilty show whatever helps least.
    const hand = view.you.hand.map(clue);
    const choice = guilty ? leastUseful(solver, hand, publicCards(view)) : pick(hand, rng);
    return { type: "show", card: choice.id };
  }

  if (phase.kind === "trim" && phase.active === seat) {
    const hand = view.you.hand.map(clue);
    if (guilty) return { type: "burn", card: mostDamaging(solver, hand, publicCards(view)).id };
    return { type: "testify", card: mostUseful(solver, hand, publicCards(view)).id };
  }

  if (phase.kind === "inquest" && view.yourVote === null && view.you.alive && view.voted && !view.voted[seat]) {
    if (guilty?.answer) return { type: "vote", value: sameAnswerParts(phase.answer, guilty.answer) ? 0 : 1 };
    if (guilty) return { type: "vote", value: phase.answer.agent === guilty.killer ? 0 : 1 };
    const solved = solver.analyze(believed(view, solver)).solved;
    return { type: "vote", value: solved && sameAnswerParts(solved, phase.answer) ? 1 : 0 };
  }

  if (phase.kind === "vote" && view.voted && !view.voted[seat]) return { type: "vote", value: dawnVote(view, solver, rng) };

  if (phase.kind !== "turn" || phase.active !== seat) return null;

  if (guilty) {
    if (phase.step === "share") return guilty.answer ? { type: "pass" } : share(view, solver, rng);
    if (guilty.canStrike && view.round >= 2) {
      const targets = view.players.filter((p, i) => p.alive && i !== seat && i !== guilty.accomplice);
      if (targets.length) return { type: "strike", target: pick(targets, rng).id };
    }
    const unplanted = guilty.forgeries.filter((f) => !f.planted);
    if (guilty.plantsLeft > 0 && unplanted.length && rng() < 0.8) {
      const f = pick(unplanted, rng);
      return { type: "investigate", lead: leadKey(f.forgery.lead), tamper: { how: "plant", clue: f.forgery.clue } };
    }
    if (guilty.answer && rng() < 0.5) {
      // Bury where the evidence against them is likeliest to be.
      const a = guilty.answer;
      const hot: Lead[] = [
        { kind: "body" },
        { kind: "staff", room: a.room },
        { kind: "search", room: a.room },
        { kind: "alibi", agent: guilty.killer },
      ];
      return { type: "investigate", lead: leadKey(pick(hot, rng)), tamper: { how: "bury" } };
    }
    // Otherwise draw like anyone else: it looks normal, and keeps a card from the innocents.
    return investigate(view, solver, rng);
  }

  if (phase.step === "share") return share(view, solver, rng);
  const analysis = solver.analyze(believed(view, solver));
  if (analysis.solved && !view.you.inquestUsed) return { type: "inquest", answer: analysis.solved };
  return investigate(view, solver, rng);
}

/** Testify something the table doesn't know yet, now and then confer, or pass. */
function share(view: PlayerView, solver: Solver, rng: Rng): Action {
  const hand = view.you.hand.map((id) => view.you.known.find((c) => c.id === id)!);
  const pub = publicCards(view);
  const useful = hand.filter((c) => solver.remaining([...pub, c]) < solver.remaining(pub));
  const r = rng();
  if (useful.length && r < 0.8) return { type: "testify", card: mostUseful(solver, useful, pub).id };
  const others = view.players.filter((p, i) => p.alive && i !== view.you.seat);
  if (hand.length && others.length && r < 0.9) return { type: "confer", with: pick(others, rng).id, card: pick(hand, rng).id };
  return { type: "pass" };
}

/**
 * Follow the lead most likely to say something new: not one already found
 * dry, preferably one nobody has looked at (most hold a single card), and
 * about something still in doubt. The body and the rooms come first.
 */
function investigate(view: PlayerView, solver: Solver, rng: Rng): Action {
  const dry = view.you.findings.filter((f) => f.clue === null).map((f) => leadKey(f.lead));
  const looks = new Map<string, number>();
  for (const e of view.log) if (e.t === "investigate") looks.set(leadKey(e.lead), (looks.get(leadKey(e.lead)) ?? 0) + 1);
  const m = solver.analyze(believed(view, solver)).marginals;
  const open = (xs: number[]) => xs.filter((n) => n > 0).length;
  const score = (l: Lead): number => {
    const key = leadKey(l);
    if (dry.includes(key)) return -Infinity;
    // Told there's more where I last looked: go back for it.
    const last = [...view.you.findings].reverse().find((f) => leadKey(f.lead) === key);
    const seen = last?.more ? 0 : (looks.get(key) ?? 0);
    switch (l.kind) {
      case "body":
      case "body2":
        return 4 - seen;
      case "search":
        return m.room[l.room] > 0 && open(m.room) > 1 ? 3 - 2 * seen : -1;
      case "staff":
        return m.room[l.room] > 0 ? 2 - 2 * seen : -1;
      case "alibi":
        return m.agent[l.agent] > 0 && open(m.agent) > 1 && l.agent !== view.you.seat ? 2 - 2 * seen : -1;
    }
  };
  const scored = view.leads.map((l) => ({ l, s: score(l) + rng() * 0.5 }));
  scored.sort((x, y) => y.s - x.s);
  return { type: "investigate", lead: leadKey(scored[0].l) };
}

/** The cards everyone has seen: the public record. */
export function publicCards(view: PlayerView): Clue[] {
  const ids = new Set(view.record.map((r) => r.clue));
  return view.you.known.filter((c) => ids.has(c.id));
}

/**
 * What an innocent goes on: everything they've seen, most trusted first,
 * minus whatever contradicts what they trust more.
 */
export function believed(view: PlayerView, solver: Solver): Clue[] {
  const rank = (c: Clue) => {
    if (handled(view, c.id)) return 4;
    const how = view.you.how[c.id];
    return how?.via === "dealt" ? 0 : how?.via === "record" ? 1 : how?.via === "drew" ? 2 : 3;
  };
  const byTrust = [...view.you.known].sort((a, b) => rank(a) - rank(b));
  return solver.believable([...selfKnowledge(view), ...byTrust]);
}

/**
 * Chain of custody: was this card drawn from a lead that someone else had
 * already followed? Most leads hold one card, so an honest earlier look
 * would have taken it; finding something there anyway smells of a plant.
 */
export function handled(view: PlayerView, id: number): boolean {
  const o = view.origins[id];
  if (!o || o.via !== "lead") return false;
  const key = leadKey(o.lead);
  const looks = view.log.flatMap((e) => (e.t === "investigate" && leadKey(e.lead) === key ? [e.who] : []));
  // The drawer's own (latest) look, and anyone else's before it.
  const mine = looks.lastIndexOf(o.by);
  return looks.slice(0, Math.max(0, mine)).some((who) => who !== o.by);
}

function dawnVote(view: PlayerView, solver: Solver, rng: Rng): number {
  const phase = view.phase as Extract<PlayerView["phase"], { kind: "vote" }>;
  const guilty = view.guilty;
  const counts = (clues: Clue[]) => marginalsGiven(solver, clues, view.accusation, phase.part);
  const best = (score: (v: number) => number, from: number[]) => {
    const top = Math.max(...from.map(score));
    return pick(from.filter((v) => score(v) === top), rng);
  };
  if (guilty) {
    // Push the table toward the likeliest-looking wrong answer.
    const truth = guilty.answer?.[phase.part] ?? (phase.part === "agent" ? guilty.killer : null);
    const wrong = phase.options.filter((v) => v !== truth);
    const c = counts(publicCards(view));
    return best((v) => c[v] ?? 0, wrong.length ? wrong : phase.options);
  }
  // Vote with what you believe; between equals, go with what the record
  // favours, so the innocents don't split their votes.
  // At a real table they'd agree among themselves; bots settle a dead heat
  // the same way every time, so they at least vote together.
  const c = counts(believed(view, solver));
  const p = counts(publicCards(view));
  const score = (v: number) => (c[v] ?? 0) * 1000 + (p[v] ?? 0);
  const top = Math.max(...phase.options.map(score));
  return Math.min(...phase.options.filter((v) => score(v) === top));
}

/** Per value of `part`, how many answers fit these cards and the accusation so far. */
function marginalsGiven(solver: Solver, clues: Clue[], so: Partial<Answer>, part: Part): number[] {
  const sp = solver.space;
  const out = new Array<number>(part === "agent" ? sp.dossier.agents.length : part === "device" ? sp.dossier.devices.length : sp.dossier.rooms.length).fill(0);
  for (const k of sp.answers(solver.candidates(clues))) {
    const a = sp.answerOfKey(k);
    if ((so.agent ?? a.agent) !== a.agent || (so.device ?? a.device) !== a.device || (so.room ?? a.room) !== a.room) continue;
    out[a[part]]++;
  }
  return out;
}

function sameAnswerParts(a: Answer, b: Answer) {
  return a.agent === b.agent && a.device === b.device && a.room === b.room;
}

/** The card that would narrow the public record most. */
function mostUseful(solver: Solver, cards: Clue[], pub: Clue[]): Clue {
  return [...cards].sort((a, b) => solver.remaining([...pub, a]) - solver.remaining([...pub, b]))[0];
}

/** The guilty burn whatever would narrow the public record most. */
const mostDamaging = mostUseful;

function leastUseful(solver: Solver, cards: Clue[], pub: Clue[]): Clue {
  return [...cards].sort((a, b) => solver.remaining([...pub, b]) - solver.remaining([...pub, a]))[0];
}
