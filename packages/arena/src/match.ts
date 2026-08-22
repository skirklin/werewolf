import type { FastifyInstance } from "fastify";
import { createApp } from "@werewolf/server";
import {
  recommendedConfig,
  type GameConfig,
  type GameRecord,
  type PlayerId,
} from "@werewolf/shared";
import { ArenaClient } from "./client.js";
import type { Strategy } from "./strategy.js";

export interface MatchOptions {
  /** One strategy per seat. The table size is however many you pass. */
  strategies: Strategy[];
  config?: GameConfig;
  /** How many times round the table everyone gets to talk before the vote. */
  discussionRounds?: number;
  /** Called with narration as the game unfolds. */
  onEvent?: (line: string) => void;
}

export interface Said {
  round: number;
  speaker: string;
  strategy: string;
  text: string;
}

export interface MatchResult {
  /** Anonymous, seat-labelled, and tagged `agent` so it never mixes with real games. */
  record: GameRecord;
  /** Everything said, kept out of the record on purpose — words are not anonymous. */
  transcript: Said[];
}

/** Give up on a single game rather than let a stuck phase hang a whole run. */
const MAX_STEPS = 400;

/**
 * Runs games. One real server, one room per game, one WebSocket per agent —
 * so the isolation between agents is the same isolation that protects human
 * players, enforced by the server rather than by this file being careful.
 */
export class Arena {
  private constructor(
    private readonly app: FastifyInstance,
    private readonly url: string,
    private readonly finished: { record: GameRecord; playerIds: PlayerId[] }[]
  ) {}

  static async open(): Promise<Arena> {
    const finished: { record: GameRecord; playerIds: PlayerId[] }[] = [];
    const app = await createApp({
      serveClient: false,
      dataDir: null, // the arena keeps its own results; nothing to persist here
      onGameFinished: (record, playerIds) => finished.push({ record, playerIds }),
    });
    await app.listen({ port: 0, host: "127.0.0.1" });
    const addr = app.server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    return new Arena(app, `ws://127.0.0.1:${port}/ws`, finished);
  }

  async close() {
    await this.app.close();
  }

  async play(opts: MatchOptions): Promise<MatchResult> {
    const { strategies } = opts;
    const config = opts.config ?? recommendedConfig(strategies.length);
    const rounds = opts.discussionRounds ?? 2;
    const say = opts.onEvent ?? (() => {});
    const transcript: Said[] = [];
    const before = this.finished.length;

    const clients: ArenaClient[] = [];
    try {
      for (const [i] of strategies.entries()) {
        const client = await ArenaClient.connect(this.url);
        const name = seatName(i);
        if (i === 0) await client.createRoom(name);
        else await client.joinRoom(clients[0].code, name);
        clients.push(client);
      }
      await clients[0].waitFor((v) => v.players.length === strategies.length, "a full lobby");

      await this.referee({ clients, strategies, config, rounds, say, transcript });
    } finally {
      for (const c of clients) c.close();
      await Promise.all(strategies.map((s) => s.finish?.()));
    }

    const done = this.finished[before];
    if (!done) throw new Error("The game ended without producing a record.");
    const byId = new Map(clients.map((c, i) => [c.playerId, strategies[i].name]));
    return {
      record: {
        ...done.record,
        mode: "agent",
        seats: done.record.seats.map((seat, i) => ({
          ...seat,
          agent: byId.get(done.playerIds[i]) ?? null,
        })),
      },
      transcript,
    };
  }

  /** Drive the phases. Host plumbing is the referee's job, never a strategy's. */
  private async referee(ctx: {
    clients: ArenaClient[];
    strategies: Strategy[];
    config: GameConfig;
    rounds: number;
    say: (line: string) => void;
    transcript: Said[];
  }) {
    const { clients, strategies, config, rounds, say, transcript } = ctx;
    const host = clients[0];

    /**
     * Bring a seat's view level with the host's before asking its strategy
     * anything. Each client learns about a death on its own socket, so without
     * this the referee can catch a just-killed agent one broadcast behind and
     * ask a dead player to speak — a wasted call, and a line the server will
     * rightly refuse.
     */
    const current = async (client: ArenaClient) => {
      const target = host.view!;
      await client.soft((v) => v.phase === target.phase && v.round === target.round, 2000);
      const view = client.view;
      return view?.you.alive ? view : null;
    };

    for (let step = 0; step < MAX_STEPS; step++) {
      const view = await host.waitFor(() => true, "the first view");
      if (view.phase === "gameOver") {
        say(`Game over — ${view.winner} wins.`);
        return;
      }

      switch (view.phase) {
        case "lobby":
          host.send({ type: "startGame", config });
          await host.waitFor((v) => v.phase !== "lobby", "the deal");
          break;

        case "roleReveal":
          host.send({ type: "startNight" });
          await host.waitFor((v) => v.phase !== "roleReveal", "nightfall");
          break;

        case "night":
          say(`Night ${view.round} falls.`);
          await this.runNight(clients, strategies, host);
          break;

        case "dayDiscussion": {
          say(`Day ${view.round}.`);
          for (let round = 0; round < rounds; round++) {
            for (const client of clients) {
              const me = await current(client);
              if (!me) continue; // dead, or out of step — either way, not speaking
              const seat = clients.indexOf(client);
              const text = await strategies[seat].speak(me);
              if (!text) continue;
              const chatBefore = me.chat.length;
              client.send({ type: "say", text });
              // Only record what the town actually heard: a refused line never
              // entered the game, so it has no business in the transcript.
              if (!(await client.soft((v) => v.chat.length > chatBefore, 2000))) continue;
              transcript.push({
                round: me.round,
                speaker: me.you.name,
                strategy: strategies[seat].name,
                text,
              });
              say(`  ${me.you.name}: ${text}`);
            }
          }
          host.send({ type: "startVote" });
          await host.waitFor((v) => v.phase !== "dayDiscussion", "the vote to open");
          break;
        }

        case "dayVote": {
          for (const client of clients) {
            const me = await current(client);
            if (!me) continue;
            const seat = clients.indexOf(client);
            if (me.myVote !== undefined || me.silencedIds.includes(me.you.id)) continue;
            const target = await strategies[seat].vote(me);
            client.send({ type: "castVote", targetId: target });
            await client.soft((v) => v.myVote !== undefined || v.phase !== "dayVote", 2000);
          }
          await host.waitFor((v) => v.phase !== "dayVote", "the vote to resolve");
          break;
        }

        case "hunterShot": {
          const shooter = clients.find((c) => c.view?.shootPrompt);
          if (shooter) {
            const seat = clients.indexOf(shooter);
            shooter.send({ type: "shoot", targetId: await strategies[seat].shoot(shooter.view!) });
          } else {
            host.send({ type: "skipShot" }); // whoever owed a shot is gone
          }
          await host.waitFor((v) => v.phase !== "hunterShot", "the shot to land");
          break;
        }
      }
    }
    throw new Error("Game did not finish within the step limit.");
  }

  /**
   * Everyone with something to do tonight does it. Roles that wait on others
   * (the Witch needs the wolves first) surface on a later pass, so this keeps
   * sweeping until the server moves the phase on.
   */
  private async runNight(clients: ArenaClient[], strategies: Strategy[], host: ArenaClient) {
    for (let sweep = 0; sweep < 30; sweep++) {
      if (host.view?.phase !== "night") return;
      const pending = clients.filter((c) => c.view?.nightPrompt);
      if (!pending.length) {
        if (!(await host.soft((v) => v.phase !== "night", 200))) continue;
        return;
      }
      await Promise.all(
        pending.map(async (client) => {
          const seat = clients.indexOf(client);
          client.send(await strategies[seat].night(client.view!));
          await client.soft((v) => !v.nightPrompt || v.phase !== "night", 2000);
        })
      );
    }
    // Someone is wedged; the host can always force the night closed.
    host.send({ type: "endNight" });
    await host.waitFor((v) => v.phase !== "night", "the night to end");
  }
}

/**
 * Plain first names, deliberately saying nothing about which strategy sits
 * where: agents address each other by name all game, and a seat labelled "llm"
 * would tell everyone else who the interesting opponents are. Attribution lives
 * in the record instead, keyed by player id.
 */
const SEAT_NAMES = [
  "Alex", "Bailey", "Casey", "Devon", "Ellis", "Frankie", "Glen", "Harper",
  "Indigo", "Jules", "Kai", "Lane", "Marlow", "Nico", "Onyx", "Parker",
  "Quinn", "Reese", "Sage", "Tatum", "Umber", "Vale", "Wren", "Yuki",
];

function seatName(index: number): string {
  return SEAT_NAMES[index] ?? `Player ${index + 1}`;
}
