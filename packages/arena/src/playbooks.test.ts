import { describe, it, expect } from "vitest";
import { ROLES } from "@werewolf/shared";
import { PLAYBOOKS, adviceFor, getPlaybook, SPECIALIST, BASELINE } from "./playbooks.js";
import { makeStrategy, parseLineup } from "./lineup.js";
import { LlmStrategy, type LlmOptions } from "./strategies/llm.js";
import { analyzeSpeech } from "./speech.js";
import type { GameRecord, PlayerView } from "@werewolf/shared";

/** A stand-in API client, so none of these tests cost anything. */
function stubClient(reply: string) {
  return {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: reply }],
        usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0 },
      }),
    },
  } as unknown as NonNullable<LlmOptions["client"]>;
}

describe("playbooks", () => {
  it("gives a seat the advice for the role it was actually dealt", () => {
    const seer = adviceFor(SPECIALIST, "seer", "village");
    expect(seer).toContain("vision");
    const doctor = adviceFor(SPECIALIST, "doctor", "village");
    expect(doctor).toContain("Never claim early");
    expect(doctor).not.toContain("vision"); // no cross-contamination between roles
  });

  it("tells wolves that bluffing is on the table — the point of the variant", () => {
    const wolf = adviceFor(SPECIALIST, "werewolf", "werewolf");
    expect(wolf).toMatch(/claiming Seer/i);
    // The control deliberately doesn't, which is what makes the comparison mean
    // something: it's the difference being tested.
    expect(adviceFor(BASELINE, "werewolf", "werewolf")).not.toMatch(/claiming Seer/i);
  });

  it("falls back to team advice for a role it has nothing specific to say about", () => {
    const advice = adviceFor(SPECIALIST, "auraSeer", "village");
    expect(advice).toContain(SPECIALIST.village!);
  });

  it("covers every role a game can actually deal", () => {
    // Not a hard requirement — team fallback handles the rest — but a missing
    // entry for a common role is usually an oversight, so make it visible.
    const covered = Object.keys(SPECIALIST.byRole ?? {});
    for (const id of ["werewolf", "seer", "doctor", "villager", "hunter", "tanner"])
      expect(covered).toContain(id);
    // And nothing here names a role that doesn't exist.
    for (const id of covered) expect(ROLES[id]).toBeDefined();
  });

  it("refuses a playbook nobody defined", () => {
    expect(() => getPlaybook("wishful")).toThrow(/Unknown playbook/);
    expect(Object.keys(PLAYBOOKS)).toContain("baseline");
  });
});

describe("lineup specs with playbooks", () => {
  it("reads kind, playbook and model out of one spec", () => {
    const s = makeStrategy("llm+specialist@claude-sonnet-5") as LlmStrategy;
    expect(s.playbook.name).toBe("specialist");
    expect(s.modelId).toBe("claude-sonnet-5");
    expect(s.name).toBe("llm:specialist@claude-sonnet-5");
  });

  it("falls back to the run's defaults when the spec omits them", () => {
    const s = makeStrategy("llm", "claude-haiku-4-5", "decisive") as LlmStrategy;
    expect(s.playbook.name).toBe("decisive");
    const plain = makeStrategy("llm") as LlmStrategy;
    expect(plain.playbook.name).toBe("baseline");
  });

  it("still parses seat counts alongside the new syntax", () => {
    expect(parseLineup("llm+specialist:2,llm+baseline:1")).toEqual([
      "llm+specialist",
      "llm+specialist",
      "llm+baseline",
    ]);
  });

  it("rejects an unknown playbook before a run spends anything", () => {
    expect(() => makeStrategy("llm+telepathy")).toThrow(/Unknown playbook/);
  });
});

describe("assigning playbooks by team", () => {
  /** A seat only ever consults its own role, which it legitimately knows. */
  const seat = (roleId: string) =>
    ({
      round: 1,
      you: { id: "p0", name: "Alex", roleId, alive: true, isHost: true },
      players: [{ id: "p0", name: "Alex", alive: true, isHost: true, connected: true, roleId }],
      packmates: [],
      chat: [],
      log: [],
      myInspects: [],
      myDetections: [],
      silencedIds: [],
      voteTally: {},
      votesRemaining: 0,
      nightPrompt: null,
      shootPrompt: null,
      phase: "dayDiscussion",
      winner: null,
      soloWinnerId: null,
      code: "T",
      config: {},
    }) as unknown as PlayerView;

  const build = (roleId: string) => {
    const s = new LlmStrategy({
      client: stubClient("Bailey seems off."),
      playbook: (team) => getPlaybook(team === "werewolf" ? "specialist" : "baseline"),
    });
    return { s, view: seat(roleId) };
  };

  it("resolves from the seat's own role once it is dealt", async () => {
    const wolf = build("werewolf");
    await wolf.s.speak(wolf.view);
    expect(wolf.s.playbook.name).toBe("specialist");

    const town = build("seer");
    await town.s.speak(town.view);
    expect(town.s.playbook.name).toBe("baseline");
  });

  it("labels the seat by what it actually played, so results split by side", async () => {
    const wolf = build("werewolf");
    await wolf.s.speak(wolf.view);
    // The record labels seats from this name, which is how a mirrored
    // tournament ends up comparing A-as-wolves with B-as-wolves.
    expect(wolf.s.name).toBe("llm:specialist");
  });

  it("settles on one playbook and never changes mid-game", async () => {
    const { s, view } = build("werewolf");
    await s.speak(view);
    const first = s.playbook.name;
    // Even handed a view claiming another role, the seat keeps what it resolved.
    await s.speak(seat("seer"));
    expect(s.playbook.name).toBe(first);
  });

  it("settles a seat that dies before it ever acts", () => {
    // The bug this guards: a plain villager eaten on night one never speaks and
    // never has a night action, so it used to reach the results table unresolved
    // and be counted as the control. Nine seats in a 30-game run were misfiled.
    const s = new LlmStrategy({
      client: stubClient("unused"),
      playbook: (team) => getPlaybook(team === "werewolf" ? "specialist" : "decisive"),
    });
    s.observe(seat("villager"));
    expect(s.playbook.name).toBe("decisive");
    expect(s.name).toBe("llm:decisive");
  });

  it("reports the control before anything has been dealt", () => {
    const s = new LlmStrategy({
      client: stubClient("hi"),
      playbook: () => getPlaybook("decisive"),
    });
    expect(s.playbook.name).toBe("baseline"); // nothing resolved yet
  });
});

describe("scoring what was said", () => {
  const record = (seats: { dealt: string; agent: string }[]): GameRecord => ({
    v: 2,
    finishedAt: "",
    mode: "agent",
    playerCount: seats.length,
    rounds: 2,
    winner: "village",
    soloWinnerRole: null,
    config: {
      selectionMode: "pool",
      revealRoleOnDeath: false,
      nightSummary: "discreet",
      peacefulFirstNight: false,
    },
    seats: seats.map((s) => ({
      dealt: s.dealt,
      final: s.dealt,
      disguise: null,
      survived: true,
      won: true,
      agent: s.agent,
      said: 1,
    })),
    events: [],
  });

  it("counts a wolf's role claim as a bluff, and a villager's as a claim", () => {
    // Alex is seat 0, Bailey seat 1 — seat names are assigned by index.
    const stats = analyzeSpeech([
      {
        record: record([
          { dealt: "werewolf", agent: "wolfy" },
          { dealt: "seer", agent: "towny" },
        ]),
        transcript: [
          { round: 1, speaker: "Alex", strategy: "wolfy", text: "I'm the Seer and I checked Bailey." },
          { round: 1, speaker: "Bailey", strategy: "towny", text: "I checked Alex, he is a wolf." },
          { round: 1, speaker: "Alex", strategy: "wolfy", text: "Let's all stay calm today." },
        ],
      },
    ]);
    expect(stats.get("wolfy")).toMatchObject({ lines: 2, wolfLines: 2, claims: 1, bluffs: 1 });
    // A real Seer claiming is not a bluff, however loudly it is said.
    expect(stats.get("towny")).toMatchObject({ lines: 1, wolfLines: 0, claims: 1, bluffs: 0 });
  });

  it("spots an accusation without needing the word 'wolf'", () => {
    const stats = analyzeSpeech([
      {
        record: record([{ dealt: "villager", agent: "v" }]),
        transcript: [{ round: 1, speaker: "Alex", strategy: "v", text: "I suspect Bailey." }],
      },
    ]);
    expect(stats.get("v")!.accusations).toBe(1);
  });

  it("ignores talk it cannot attribute to a seat", () => {
    const stats = analyzeSpeech([
      {
        record: record([{ dealt: "villager", agent: "v" }]),
        transcript: [{ round: 1, speaker: "Nobody", strategy: "v", text: "I'm the Seer." }],
      },
    ]);
    expect(stats.get("v")).toBeUndefined();
  });
});
