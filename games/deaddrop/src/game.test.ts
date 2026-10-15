import { describe, it, expect } from "vitest";
import { generateScenario } from "./generate.js";
import {
  createGame,
  discardCount,
  offerable,
  pointsOf,
  projectView,
  reduce,
  whoMustAct,
  GameError,
  type GameState,
} from "./game.js";
import { allSubjects, isAbout } from "./clues.js";
import { simulateGame } from "./simulate.js";
import type { Answer, Subject } from "./types.js";

const scenario = generateScenario({ seed: 11, players: 3 });
const seats = [
  { id: "a", name: "Ann" },
  { id: "b", name: "Ben" },
  { id: "c", name: "Cy" },
];
const ids = ["a", "b", "c"];

/** Two subjects the asker can put to the table, preferring ones both others can offer on. */
function pair(state: GameState, asker: number): [Subject, Subject] {
  const subs = allSubjects(state.scenario.dossier);
  const others = [0, 1, 2].filter((i) => i !== asker);
  let fallback: [Subject, Subject] = [subs[0], subs[1]];
  for (let i = 0; i < subs.length; i++)
    for (let j = i + 1; j < subs.length; j++) {
      const asked = reduce(state, ids[asker], { type: "ask", subjects: [subs[i], subs[j]] });
      if (asked.phase.kind !== "offers") continue;
      const counts = others.map((o) => offerable(asked, o).length);
      if (counts.every((n) => n > 0)) return [subs[i], subs[j]];
      if (counts.some((n) => n > 0)) fallback = [subs[i], subs[j]];
    }
  return fallback;
}

/** Ann asks; Ben offers his first matching card, Cy offers nothing. */
function benOffers(g: GameState): { g: GameState; offer: number[]; subjects: [Subject, Subject] } {
  const subjects = pair(g, 0);
  g = reduce(g, "a", { type: "ask", subjects });
  const offer = offerable(g, 1).slice(0, 1);
  if (g.pending[1] === null) g = reduce(g, "b", { type: "offer", clueIds: offer });
  if (g.pending[2] === null) g = reduce(g, "c", { type: "offer", clueIds: [] });
  return { g, offer, subjects };
}

/** Cards from Ann's hand worth at least `points`, biggest first. */
function enough(g: GameState, points: number): number[] {
  const hand = [...g.players[0].hand].sort((x, y) => scenario.clues[y].points - scenario.clues[x].points);
  const out: number[] = [];
  for (const id of hand) {
    if (pointsOf(g, out) >= points) break;
    out.push(id);
  }
  return out;
}

/** Everyone passes their turn: ask, nobody offers. */
function passTurn(g: GameState): GameState {
  const active = (g.phase as { active: number }).active;
  g = reduce(g, ids[active], { type: "ask", subjects: pair(g, active) });
  for (const i of whoMustAct(g)) g = reduce(g, ids[i], { type: "offer", clueIds: [] });
  if (g.phase.kind === "choose") g = reduce(g, ids[active], { type: "accept", deals: [] });
  return g;
}

const wrongAnswer = (a: Answer): Answer => ({ ...a, device: (a.device + 1) % scenario.dossier.devices.length });

describe("dealing", () => {
  it("gives everyone a hand, puts the rest in the deck, and everyone knows the public clues", () => {
    const g = createGame(scenario, seats, { mode: "competitive" });
    g.players.forEach((p, i) => {
      expect(p.hand).toEqual(scenario.hands[i]);
      expect(p.known).toEqual([...scenario.publicClues, ...scenario.hands[i]]);
    });
    expect(g.deck).toEqual(scenario.deck);
  });

  it("prices clues 1 to 3, in even thirds", () => {
    const counts = [1, 2, 3].map((p) => scenario.clues.filter((c) => c.points === p).length);
    for (const n of counts) expect(n).toBeGreaterThan(0);
    expect(Math.max(...counts) - Math.min(...counts)).toBeLessThanOrEqual(1);
  });

  it("refuses moves it doesn't know, or none at all", () => {
    const g = createGame(scenario, seats, { mode: "competitive" });
    expect(() => reduce(g, "a", { type: "give" } as never)).toThrow(/Unsupported/);
    expect(() => reduce(g, "a", null as never)).toThrow(/Unsupported/);
  });

  it("refuses to seat the wrong number of players", () => {
    expect(() => createGame(scenario, seats.slice(0, 2), { mode: "coop" })).toThrow(GameError);
  });
});

describe("asking the table", () => {
  it("takes two different, real subjects, on your own turn", () => {
    const g = createGame(scenario, seats, { mode: "competitive" });
    const [x, y] = pair(g, 0);
    expect(() => reduce(g, "b", { type: "ask", subjects: [x, y] })).toThrow(/your turn/);
    expect(() => reduce(g, "a", { type: "ask", subjects: [x, x] })).toThrow(/different/);
    expect(() => reduce(g, "a", { type: "ask", subjects: [x, { kind: "room", id: 99 }] })).toThrow(/Unknown/);
    expect(() => reduce(g, "a", { type: "ask", subjects: [x] as never })).toThrow(/two subjects/);
    expect(() => reduce(g, "a", { type: "ask", subjects: [x, null] as never })).toThrow(/Unknown/);
  });

  it("lets everyone else offer at once, only cards in hand on the subjects, and only once", () => {
    let g = createGame(scenario, seats, { mode: "competitive" });
    const subjects = pair(g, 0);
    g = reduce(g, "a", { type: "ask", subjects });
    expect(whoMustAct(g).sort()).toEqual([1, 2]);

    const benCan = projectView(g, "b").canOffer!;
    for (const id of benCan) {
      expect(g.players[1].hand).toContain(id);
      expect(subjects.some((s) => isAbout(scenario.clues[id], s))).toBe(true);
    }
    for (const id of scenario.publicClues) expect(benCan).not.toContain(id); // nobody holds those
    const off = g.players[1].hand.find((id) => !benCan.includes(id));
    if (off !== undefined) expect(() => reduce(g, "b", { type: "offer", clueIds: [off] })).toThrow(GameError);
    expect(() => reduce(g, "a", { type: "offer", clueIds: [] })).toThrow(/own ask/);

    g = reduce(g, "b", { type: "offer", clueIds: benCan });
    expect(() => reduce(g, "b", { type: "offer", clueIds: [] })).toThrow(/already/);
    // Cy sees that Ben has offered, never what.
    const cy = projectView(g, "c");
    expect(cy.moved).toEqual([true, true, false]);
    expect(cy.yours).toBeNull();
  });

  it("shows the asker only each offer's size, then swaps the cards on the ones taken", () => {
    const { g: offered, offer, subjects } = benOffers(createGame(scenario, seats, { mode: "competitive" }));
    let g = offered;
    expect(g.phase.kind).toBe("choose");
    expect(g.log.at(-1)).toEqual({
      t: "offers",
      offers: [
        { who: "b", cards: 1, points: pointsOf(g, offer) },
        { who: "c", cards: 0, points: 0 },
      ],
    });
    const view = projectView(g, "a");
    expect(view.choices).toEqual([{ from: "b", cards: 1, points: pointsOf(g, offer) }]);
    expect(view.you.known.map((c) => c.id)).not.toContain(offer[0]); // unseen until taken

    expect(() => reduce(g, "a", { type: "accept", deals: [{ from: "b", payback: [] }] })).toThrow(/at least/);
    expect(() =>
      reduce(g, "a", { type: "accept", deals: [{ from: "b", payback: [g.players[1].hand[0]] }] })
    ).toThrow(/your hand/);

    const pay = enough(g, pointsOf(g, offer));
    g = reduce(g, "a", { type: "accept", deals: [{ from: "b", payback: pay }] });
    // The offered card moved to Ann, the payback to Ben; both remember what they saw.
    expect(g.players[0].hand).toContain(offer[0]);
    expect(g.players[1].hand).not.toContain(offer[0]);
    expect(g.players[1].known).toContain(offer[0]);
    for (const id of pay) {
      expect(g.players[1].hand).toContain(id);
      expect(g.players[0].hand).not.toContain(id);
      expect(g.players[0].known).toContain(id);
    }
    expect(g.players[0].sources[offer[0]]).toMatchObject({ via: "offer", from: "b", subjects, turn: 0 });
    expect(g.log.at(-1)).toMatchObject({ t: "deal", asker: "a", with: "b", gotCards: 1, paidPoints: pointsOf(g, pay) });
    expect(g.phase).toEqual({ kind: "turn", active: 1 });
  });

  it("won't let one card pay back two offers", () => {
    let g = createGame(scenario, seats, { mode: "competitive" });
    g = reduce(g, "a", { type: "ask", subjects: pair(g, 0) });
    if (!offerable(g, 1).length || !offerable(g, 2).length) return; // this deal can't set it up
    g = reduce(g, "b", { type: "offer", clueIds: offerable(g, 1).slice(0, 1) });
    g = reduce(g, "c", { type: "offer", clueIds: offerable(g, 2).slice(0, 1) });
    const big = [...g.players[0].hand].sort((x, y) => scenario.clues[y].points - scenario.clues[x].points)[0];
    expect(() =>
      reduce(g, "a", { type: "accept", deals: [{ from: "b", payback: [big] }, { from: "c", payback: [big] }] })
    ).toThrow(/each card once/);
  });

  it("lets the asker turn every offer down", () => {
    let { g } = benOffers(createGame(scenario, seats, { mode: "competitive" }));
    if (g.phase.kind !== "choose") return; // nobody happened to offer
    g = reduce(g, "a", { type: "accept", deals: [] });
    expect(g.log.at(-1)).toEqual({ t: "noDeal", asker: "a" });
    expect(g.phase).toEqual({ kind: "turn", active: 1 });
  });

  it("moves straight on when nobody can offer anything", () => {
    let g = createGame(scenario, seats, { mode: "competitive" });
    g = { ...g, players: g.players.map((p, i) => (i === 0 ? p : { ...p, hand: [] })) };
    g = reduce(g, "a", { type: "ask", subjects: pair(g, 0) });
    expect(g.phase).toEqual({ kind: "turn", active: 1 });
  });
});

describe("rounds", () => {
  it("ends each round with everyone discarding half, then drawing replacements", () => {
    let g = createGame(scenario, seats, { mode: "competitive" });
    for (let t = 0; t < 3; t++) g = passTurn(g);
    expect(g.phase).toEqual({ kind: "discard", next: 0 });
    expect(whoMustAct(g)).toEqual([0, 1, 2]);
    const sizes = g.players.map((p) => p.hand.length);
    const need = discardCount(g, 1);
    expect(need).toBe(Math.floor(sizes[1] / 2));
    expect(projectView(g, "b").mustDiscard).toBe(need);

    expect(() => reduce(g, "b", { type: "discard", clueIds: g.players[1].hand.slice(0, need + 1) })).toThrow(/exactly/);
    expect(() => reduce(g, "b", { type: "discard", clueIds: [g.players[0].hand[0]] })).toThrow(/your hand/);

    const deckBefore = g.deck.length;
    const gone = g.players.map((p, i) => p.hand.slice(0, discardCount(g, i)));
    for (const i of [0, 1, 2]) g = reduce(g, ids[i], { type: "discard", clueIds: gone[i] });

    expect(g.round).toBe(2);
    expect(g.phase).toEqual({ kind: "turn", active: 0 });
    g.players.forEach((p, i) => {
      expect(p.hand.length).toBe(sizes[i]); // refilled
      for (const id of gone[i]) {
        expect(p.hand).not.toContain(id);
        expect(p.known).toContain(id); // discarding doesn't erase the notebook
      }
      const drawn = p.hand.filter((id) => p.sources[id]?.via === "draw");
      expect(drawn.length).toBe(gone[i].length);
    });
    // Discards went under the deck, so nothing leaves the game.
    expect(g.deck.length).toBe(deckBefore);
    for (const id of gone.flat()) expect(g.deck).toContain(id);
    expect(g.log.at(-1)).toMatchObject({ t: "round", round: 1, deckLeft: deckBefore });
  });

  it("skips seats that are out when counting the round", () => {
    let g = createGame(scenario, seats, { mode: "competitive" });
    g = reduce(g, "a", { type: "accuse", answer: wrongAnswer(scenario.secret.answer) });
    g = passTurn(g); // Ben
    g = passTurn(g); // Cy
    expect(g.phase.kind).toBe("discard");
    for (const i of [0, 1, 2]) g = reduce(g, ids[i], { type: "discard", clueIds: g.players[i].hand.slice(0, discardCount(g, i)) });
    expect(g.phase).toEqual({ kind: "turn", active: 1 }); // Ann is out, so Ben starts
    g = passTurn(g);
    g = passTurn(g);
    expect(g.phase.kind).toBe("discard"); // a round is now two turns
  });
});

describe("accusations", () => {
  it("wins on a correct accusation", () => {
    const g = reduce(createGame(scenario, seats, { mode: "competitive" }), "a", {
      type: "accuse",
      answer: scenario.secret.answer,
    });
    expect(g.phase).toEqual({ kind: "over", winners: ["a"], reason: "solved" });
  });

  it("puts a wrong accuser out, but they still offer", () => {
    let g = createGame(scenario, seats, { mode: "competitive" });
    g = reduce(g, "a", { type: "accuse", answer: wrongAnswer(scenario.secret.answer) });
    expect(g.players[0].out).toBe(true);
    g = reduce(g, "b", { type: "ask", subjects: pair(g, 1) });
    if (offerable(g, 0).length) expect(whoMustAct(g)).toContain(0);
    expect(() => reduce(g, "b", { type: "accuse", answer: scenario.secret.answer })).toThrow(GameError);
  });

  it("ends with no winner when everyone has accused wrongly", () => {
    let g = createGame(scenario, seats, { mode: "competitive" });
    for (const id of ids) g = reduce(g, id, { type: "accuse", answer: wrongAnswer(scenario.secret.answer) });
    expect(g.phase).toEqual({ kind: "over", winners: [], reason: "allOut" });
  });

  it("loses the co-op game on one wrong accusation, or when time runs out", () => {
    const wrong = reduce(createGame(scenario, seats, { mode: "coop" }), "a", {
      type: "accuse",
      answer: wrongAnswer(scenario.secret.answer),
    });
    expect(wrong.phase).toMatchObject({ kind: "over", reason: "wrongAccusation" });
    const g = passTurn(createGame(scenario, seats, { mode: "coop", turnLimit: 1 }));
    expect(g.phase).toMatchObject({ kind: "over", reason: "outOfTime", winners: [] });
  });

  it("rejects an accusation that names nothing real", () => {
    const g = createGame(scenario, seats, { mode: "competitive" });
    expect(() => reduce(g, "a", { type: "accuse", answer: { agent: 99, device: 0, room: 0 } })).toThrow(
      GameError
    );
  });
});

describe("views", () => {
  it("shows each player only their own cards and notes, and the answer only at the end", () => {
    const g = createGame(scenario, seats, { mode: "competitive" });
    const v = projectView(g, "b");
    expect(v.you.known.map((c) => c.id)).toEqual(g.players[1].known);
    expect(v.you.hand).toEqual(g.players[1].hand);
    expect(v.players.map((p) => p.handSize)).toEqual(g.players.map((p) => p.hand.length));
    expect(v.deckLeft).toBe(g.deck.length);
    expect(v.answer).toBeNull();
    const json = JSON.stringify(v);
    expect(json).not.toContain("schedule");
    expect(json).not.toContain('"deck"');
    const over = reduce(g, "a", { type: "accuse", answer: scenario.secret.answer });
    expect(projectView(over, "b").answer).toEqual(scenario.secret.answer);
  });
});

describe("bot games", () => {
  it("play to a correct finish in both modes", () => {
    for (const mode of ["competitive", "coop"] as const) {
      const r = simulateGame(5, 3, mode, 1000);
      expect(r.reason).toBe("solved");
    }
  }, 30_000);
});
