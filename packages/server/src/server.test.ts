import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import type { ClientMessage, ServerMessage } from "@werewolf/shared";
import { createApp } from "./server.js";

let app: FastifyInstance;
let url: string;

beforeAll(async () => {
  app = await createApp({ serveClient: false });
  await app.listen({ port: 0, host: "127.0.0.1" });
  const addr = app.server.address();
  const port = typeof addr === "object" && addr ? addr.port : 0;
  url = `ws://127.0.0.1:${port}/ws`;
});

afterAll(async () => {
  await app.close();
});

/**
 * A promise-based WS test client. Records every message non-destructively so
 * awaiting a "joined" never swallows a "view" the test still needs.
 */
class TestSocket {
  private ws: WebSocket;
  private received: ServerMessage[] = [];
  private notify: (() => void)[] = [];
  ready: Promise<void>;

  constructor(target: string) {
    this.ws = new WebSocket(target);
    this.ready = new Promise((res, rej) => {
      this.ws.on("open", () => res());
      this.ws.on("error", rej);
    });
    this.ws.on("message", (raw) => {
      this.received.push(JSON.parse(raw.toString()) as ServerMessage);
      for (const n of this.notify.splice(0)) n();
    });
  }

  send(msg: ClientMessage) {
    this.ws.send(JSON.stringify(msg));
  }

  private async until<T>(find: () => T | undefined): Promise<T> {
    for (let i = 0; i < 200; i++) {
      const hit = find();
      if (hit !== undefined) return hit;
      await new Promise<void>((res) => {
        this.notify.push(res);
        setTimeout(res, 50);
      });
    }
    throw new Error("Timed out waiting for a message");
  }

  /** The first message of a given type. */
  waitFor<T extends ServerMessage["type"]>(type: T): Promise<Extract<ServerMessage, { type: T }>> {
    return this.until(() => this.received.find((m) => m.type === type) as any);
  }

  /** The latest view that satisfies a predicate. */
  awaitView(pred: (v: import("@werewolf/shared").PlayerView) => boolean) {
    return this.until(() => {
      for (let i = this.received.length - 1; i >= 0; i--) {
        const m = this.received[i];
        if (m.type === "view" && pred(m.view)) return m.view;
      }
      return undefined;
    });
  }

  close() {
    this.ws.close();
  }
}

describe("websocket transport", () => {
  it("create + join + broadcast a shared roster", async () => {
    const host = new TestSocket(url);
    await host.ready;
    host.send({ type: "createRoom", name: "Host" });
    const joined = await host.waitFor("joined");
    expect(joined.code).toHaveLength(4);

    const guest = new TestSocket(url);
    await guest.ready;
    guest.send({ type: "joinRoom", code: joined.code, name: "Guest" });
    await guest.waitFor("joined");

    // Both sides should converge on a 2-player lobby.
    const hostView = await host.awaitView((v) => v.players.length === 2);
    const guestView = await guest.awaitView((v) => v.players.length === 2);
    expect(hostView.you.isHost).toBe(true);
    expect(guestView.you.isHost).toBe(false);

    host.close();
    guest.close();
  });

  it("surfaces an error for an unknown room code", async () => {
    const s = new TestSocket(url);
    await s.ready;
    s.send({ type: "joinRoom", code: "ZZZZ", name: "Nobody" });
    const err = await s.waitFor("error");
    expect(err.message).toMatch(/no room/i);
    s.close();
  });

  it("reconnects with a token and restores the private view", async () => {
    // Seat 3 players, start, then drop and rejoin the host on a new socket.
    const host = new TestSocket(url);
    await host.ready;
    host.send({ type: "createRoom", name: "Host" });
    const hj = await host.waitFor("joined");
    for (const name of ["A", "B"]) {
      const g = new TestSocket(url);
      await g.ready;
      g.send({ type: "joinRoom", code: hj.code, name });
      await g.waitFor("joined");
    }
    host.send({ type: "startGame", config: { selection: { mode: "exact", roleCounts: { werewolf: 1 } }, revealRoleOnDeath: true, seerLearnsExactRole: false, nightSummary: "discreet" } });
    const started = await host.awaitView((v) => v.phase === "roleReveal");
    const myRole = started.you.roleId;

    host.close();
    const back = new TestSocket(url);
    await back.ready;
    back.send({ type: "rejoin", code: hj.code, playerId: hj.playerId, token: hj.token });
    await back.waitFor("joined");
    const restored = await back.awaitView((v) => v.phase === "roleReveal");
    expect(restored.you.roleId).toBe(myRole);
    back.close();
  });
});
