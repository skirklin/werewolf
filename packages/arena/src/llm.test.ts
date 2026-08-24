import { describe, it, expect } from "vitest";
import { MAX_CHAT_TEXT, type PlayerView } from "@werewolf/shared";
import { LlmStrategy, trimToSentence, type LlmOptions } from "./strategies/llm.js";

/**
 * The speech guard, exercised against a stubbed client so none of this costs
 * anything. What it protects against is real: in a 30-game run a wolf published
 * "I'm Bailey, a werewolf. My packmate Alex was voted out Day 1" — the model
 * writing its notes into the dialogue field rather than choosing to confess.
 */
function stubClient(...replies: string[]) {
  let i = 0;
  return {
    messages: {
      create: async () => ({
        content: [{ type: "text", text: replies[Math.min(i++, replies.length - 1)] }],
        usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0 },
      }),
    },
  } as unknown as NonNullable<LlmOptions["client"]>;
}

/** Captures the prompts a strategy sends, so tests can assert on them. */
function recordingClient(sink: string[], reply: string) {
  return {
    messages: {
      create: async (req: { messages: { content: string }[] }) => {
        sink.push(req.messages[0].content);
        return {
          content: [{ type: "text", text: reply }],
          usage: { input_tokens: 5, output_tokens: 2, cache_read_input_tokens: 0 },
        };
      },
    },
  } as unknown as NonNullable<LlmOptions["client"]>;
}

const view = {
  round: 1,
  you: { id: "p0", name: "Alex", roleId: "werewolf", alive: true, isHost: true },
  players: [
    { id: "p0", name: "Alex", alive: true, isHost: true, connected: true, roleId: "werewolf" },
    { id: "p1", name: "Bailey", alive: true, isHost: false, connected: true, roleId: null },
  ],
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
  code: "TEST",
  config: {} as PlayerView["config"],
} as unknown as PlayerView;

describe("what an agent is allowed to say out loud", () => {
  it("passes ordinary speech straight through", async () => {
    const s = new LlmStrategy({ client: stubClient("Bailey has been very quiet today.") });
    expect(await s.speak(view)).toBe("Bailey has been very quiet today.");
    expect(s.leaks).toBe(0);
  });

  it("strips the quotes models like to wrap speech in", async () => {
    const s = new LlmStrategy({ client: stubClient('"I vote Bailey."') });
    expect(await s.speak(view)).toBe("I vote Bailey.");
  });

  it("retries once when the reply reads as notes, and uses the second try", async () => {
    const s = new LlmStrategy({
      client: stubClient("- I'm a werewolf\n- kill Bailey next", "Bailey seems off to me."),
    });
    expect(await s.speak(view)).toBe("Bailey seems off to me.");
    expect(s.leaks).toBe(1);
  });

  it("stays silent rather than publish a confession", async () => {
    const s = new LlmStrategy({
      client: stubClient("My packmate Bailey and I should lie low."),
    });
    expect(await s.speak(view)).toBeNull();
    expect(s.leaks).toBe(1);
    // A silence costs the seat its turn, which is what makes it worth counting
    // separately from a leak the retry rescued.
    expect(s.silences).toBe(1);
  });

  it("does not count a rescued reply as a silence", async () => {
    const s = new LlmStrategy({
      client: stubClient("- notes\n- more notes", "Bailey is dodging questions."),
    });
    expect(await s.speak(view)).toBe("Bailey is dodging questions.");
    expect(s.leaks).toBe(1);
    expect(s.silences).toBe(0);
  });

  it("stays silent when both tries are scratchpad", async () => {
    const s = new LlmStrategy({
      client: stubClient("I need to be careful here. The key is to deflect."),
    });
    expect(await s.speak(view)).toBeNull();
  });

  it("says nothing when the model says nothing", async () => {
    const s = new LlmStrategy({ client: stubClient("   ") });
    expect(await s.speak(view)).toBeNull();
  });

  it("keeps a long speech within what the engine will accept", async () => {
    const s = new LlmStrategy({ client: stubClient("word ".repeat(200)) });
    const said = await s.speak(view);
    expect(said!.length).toBeLessThanOrEqual(MAX_CHAT_TEXT);
  });
});

describe("what a voter is told", () => {
  const voting = (tally: Record<string, number>, remaining: number) =>
    ({
      ...view,
      phase: "dayVote",
      voteTally: tally,
      votesRemaining: remaining,
      players: [
        { id: "p0", name: "Alex", alive: true, isHost: true, connected: true, roleId: "werewolf" },
        { id: "p1", name: "Bailey", alive: true, isHost: false, connected: true, roleId: null },
        { id: "p2", name: "Casey", alive: true, isHost: false, connected: true, roleId: null },
      ],
    }) as unknown as PlayerView;

  it("shows where the vote stands, so a majority can be joined", async () => {
    const asked: string[] = [];
    const s = new LlmStrategy({ client: recordingClient(asked, "2") });
    await s.vote(voting({ p1: 2, p2: 1 }, 1));
    const prompt = asked.join("\n");
    expect(prompt).toContain("Bailey 2");
    expect(prompt).toContain("Casey 1");
    expect(prompt).toContain("1 still to vote");
    // And why it matters: a split vote is a wasted day.
    expect(prompt).toMatch(/tie eliminates nobody/i);
  });

  it("says plainly when nobody has voted yet", async () => {
    const asked: string[] = [];
    const s = new LlmStrategy({ client: recordingClient(asked, "1") });
    await s.vote(voting({}, 3));
    expect(asked.join("\n")).toContain("Nobody has voted yet");
  });
});

describe("trimming an over-long turn", () => {
  it("leaves a short line completely alone", () => {
    expect(trimToSentence("Bailey is lying.", 100)).toBe("Bailey is lying.");
  });

  it("cuts at the last full sentence rather than mid-thought", () => {
    const text = "Bailey is lying. Devon backed them instantly. That is two of them now.";
    expect(trimToSentence(text, 50)).toBe("Bailey is lying. Devon backed them instantly.");
  });

  it("marks a cut when one sentence runs past the limit on its own", () => {
    const trimmed = trimToSentence("word ".repeat(80), 60);
    expect(trimmed.length).toBeLessThanOrEqual(61);
    expect(trimmed.endsWith("…")).toBe(true);
    // Never mid-word: an agent reading a severed word calls it evasion.
    expect(trimmed.slice(0, -1).trimEnd().endsWith("word")).toBe(true);
  });

  it("falls back to a word boundary when no sentence end is close enough", () => {
    // The sentence end sits too early to honour, so it cuts on a word instead —
    // never mid-word, and marked so readers can tell it was cut.
    const text = "Bailey is lying. Devon backed them instantly and loudly.";
    const trimmed = trimToSentence(text, 45);
    expect(trimmed.endsWith("…")).toBe(true);
    expect(trimmed).not.toMatch(/instantl…$/);
  });

  it("does not shrink a line to a fragment to find a boundary", () => {
    // The only sentence end is very early, so honouring it would throw away
    // almost everything; better to keep the text and mark the cut.
    const text = "Yes. " + "a".repeat(200);
    expect(trimToSentence(text, 100).startsWith("Yes. a")).toBe(true);
  });
});
