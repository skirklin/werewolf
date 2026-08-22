import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { ROLES, type ClientMessage, type PlayerId, type PlayerView } from "@werewolf/shared";
import { Arena } from "./match.js";
import { RandomStrategy } from "./strategies/random.js";
import { makeStrategy, parseLineup } from "./lineup.js";
import { report } from "./report.js";
import type { Strategy } from "./strategy.js";

/** Wraps a strategy and keeps every view it was handed, for later inspection. */
class Spy implements Strategy {
  readonly seen: PlayerView[] = [];
  constructor(
    private readonly inner: Strategy,
    readonly name = inner.name
  ) {}
  private watch(view: PlayerView) {
    this.seen.push(view);
    return view;
  }
  night(v: PlayerView): Promise<ClientMessage> {
    return this.inner.night(this.watch(v));
  }
  speak(v: PlayerView): Promise<string | null> {
    return this.inner.speak(this.watch(v));
  }
  vote(v: PlayerView): Promise<PlayerId | null> {
    return this.inner.vote(this.watch(v));
  }
  shoot(v: PlayerView): Promise<PlayerId> {
    return this.inner.shoot(this.watch(v));
  }
}

/** Says its own distinctive line every time it is asked, exercising the chat path. */
class Talker extends RandomStrategy {
  constructor(readonly line: string) {
    super(Math.random, "talker");
  }
  override async speak(): Promise<string | null> {
    return this.line;
  }
}

let arena: Arena;
beforeAll(async () => {
  arena = await Arena.open();
}, 30_000);
afterAll(async () => {
  await arena.close();
});

describe("a match", () => {
  it("plays to a finish and files a seat-labelled record", async () => {
    const strategies = [
      ...Array.from({ length: 3 }, () => new RandomStrategy(Math.random, "alpha")),
      ...Array.from({ length: 2 }, () => new RandomStrategy(Math.random, "beta")),
    ];
    const { record } = await arena.play({ strategies, discussionRounds: 1 });

    expect(record.mode).toBe("agent"); // never mixed in with people's games
    expect(record.playerCount).toBe(5);
    expect(["village", "werewolf", "solo"]).toContain(record.winner);
    expect(record.seats).toHaveLength(5);
    expect(record.seats.map((s) => s.agent).sort()).toEqual(
      ["alpha", "alpha", "alpha", "beta", "beta"]
    );
    // Exactly one side won, and every seat's flag agrees with the outcome.
    for (const seat of record.seats) {
      if (record.winner !== "solo")
        expect(seat.won).toBe(ROLES[seat.final].team === record.winner);
    }
  }, 60_000);

  it("never shows an agent a role it has no business seeing", async () => {
    const spies = Array.from(
      { length: 6 },
      () => new Spy(new RandomStrategy(Math.random, "spy"))
    );
    await arena.play({ strategies: spies, discussionRounds: 1 });

    let checked = 0;
    for (const spy of spies) {
      for (const view of spy.seen) {
        // Views handed to a strategy are always mid-game, so the only roles that
        // may be filled in are this seat's own and (for a wolf) its packmates'.
        expect(view.phase).not.toBe("gameOver");
        for (const player of view.players) {
          if (player.roleId === null) continue;
          checked++;
          const allowed = player.id === view.you.id || view.packmates.includes(player.id);
          expect(allowed).toBe(true);
        }
        // A villager is never told who the wolves are.
        if (view.you.roleId && ROLES[view.you.roleId].team !== "werewolf")
          expect(view.packmates).toEqual([]);
      }
    }
    expect(checked).toBeGreaterThan(0); // the assertion above actually ran
  }, 60_000);

  it("carries talk to the other seats and counts it in the record", async () => {
    // Every seat talks: any one of them can be eaten on the first night, so a
    // single designated speaker would make this test flaky about a quarter of
    // the time. At a table of five, at least three survive to speak on day one.
    const talkers = Array.from({ length: 5 }, (_, i) => new Talker(`seat ${i} has a bad feeling`));
    const spies = talkers.map((t) => new Spy(t, "talker"));
    const { record, transcript } = await arena.play({ strategies: spies, discussionRounds: 1 });

    expect(transcript.length).toBeGreaterThan(0);
    const spokenLines = new Set(transcript.map((t) => t.text));

    // Somebody heard a line they did not say themselves — chat really is public.
    const heardElsewhere = spies.some((spy, i) =>
      spy.seen.some((v) =>
        v.chat.some((m) => spokenLines.has(m.text) && m.text !== talkers[i].line)
      )
    );
    expect(heardElsewhere).toBe(true);

    // And the record counts the speech without keeping the words.
    expect(record.seats.filter((s) => s.said > 0).length).toBeGreaterThan(0);
    for (const line of spokenLines) expect(JSON.stringify(record)).not.toContain(line);
  }, 60_000);
});

describe("lineups", () => {
  it("expands counts into one seat each", () => {
    expect(parseLineup("random:2,heuristic:1")).toEqual(["random", "random", "heuristic"]);
    expect(parseLineup("random")).toEqual(["random"]);
    expect(parseLineup(" random:2 , llm@claude-sonnet-5:1 ")).toEqual([
      "random",
      "random",
      "llm@claude-sonnet-5",
    ]);
  });

  it("rejects nonsense rather than quietly seating the wrong table", () => {
    expect(() => parseLineup("random:0")).toThrow();
    expect(() => parseLineup("random:abc")).toThrow();
    expect(() => makeStrategy("psychic")).toThrow(/Unknown strategy/);
  });

  it("builds the scripted strategies without touching the network", () => {
    expect(makeStrategy("random").name).toBe("random");
    expect(makeStrategy("heuristic").name).toBe("heuristic");
  });
});

describe("the results table", () => {
  it("says so plainly when there is nothing to report", () => {
    expect(report([])).toBe("No games completed.");
  });
});
