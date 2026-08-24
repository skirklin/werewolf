import { describe, it, expect } from "vitest";
import type { PlayerView } from "@werewolf/shared";
import { LlmStrategy, type LlmOptions } from "./strategies/llm.js";

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
    expect(said!.length).toBeLessThanOrEqual(300);
  });
});
