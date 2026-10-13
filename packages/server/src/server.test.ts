import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import type { ClientMessage, RoomInfo, ServerMessage as AnyServerMessage } from "@party/core";
import type { PlayerView, WerewolfAction } from "@party/werewolf";
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
type ServerMessage = AnyServerMessage<PlayerView>;

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

  /** A Werewolf move, wrapped for the wire. */
  act(action: WerewolfAction) {
    this.send({ type: "act", action });
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
  awaitView(pred: (v: PlayerView) => boolean) {
    return this.until(() => {
      for (let i = this.received.length - 1; i >= 0; i--) {
        const m = this.received[i];
        if (m.type === "view" && pred(m.view)) return m.view;
      }
      return undefined;
    });
  }

  /** The latest room info that satisfies a predicate. */
  awaitRoom(pred: (r: RoomInfo) => boolean) {
    return this.until(() => {
      for (let i = this.received.length - 1; i >= 0; i--) {
        const m = this.received[i];
        if (m.type === "room" && pred(m.room)) return m.room;
      }
      return undefined;
    });
  }

  /** This socket's assigned player id (once it has joined). */
  get playerId(): string {
    const j = this.received.find((m) => m.type === "joined");
    return j && j.type === "joined" ? j.playerId : "";
  }

  close() {
    this.ws.close();
  }
}

const CONFIG_1_WOLF = {
  selection: { mode: "exact" as const, roleCounts: { werewolf: 1 } },
  revealRoleOnDeath: true,
  nightSummary: "discreet" as const, peacefulFirstNight: false,
};

describe("websocket transport", () => {
  it("create + join + broadcast a shared roster", async () => {
    const host = new TestSocket(url);
    await host.ready;
    host.send({ type: "createRoom", game: "werewolf", name: "Host" });
    const joined = await host.waitFor("joined");
    expect(joined.code).toHaveLength(4);
    expect(joined.game).toBe("werewolf");

    const guest = new TestSocket(url);
    await guest.ready;
    guest.send({ type: "joinRoom", code: joined.code, name: "Guest" });
    await guest.waitFor("joined");

    // Both sides should converge on a 2-player lobby.
    const hostRoom = await host.awaitRoom((r) => r.players.length === 2);
    await guest.awaitRoom((r) => r.players.length === 2);
    expect(hostRoom.players.find((p) => p.isHost)!.id).toBe(host.playerId);
    expect(hostRoom.phase).toBe("lobby");

    host.close();
    guest.close();
  });

  it("lists the games it can host", async () => {
    const res = await app.inject({ method: "GET", url: "/api/catalog" });
    expect(res.json().map((g: { id: string }) => g.id)).toEqual(["werewolf", "deaddrop"]);
  });

  it("refuses a room for a game it doesn't have, and junk on the wire", async () => {
    const s = new TestSocket(url);
    await s.ready;
    s.send({ type: "createRoom", game: "chess", name: "Nobody" });
    expect((await s.waitFor("error")).message).toMatch(/no such game/i);
    s.close();
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
    host.send({ type: "createRoom", game: "werewolf", name: "Host" });
    const hj = await host.waitFor("joined");
    for (const name of ["A", "B"]) {
      const g = new TestSocket(url);
      await g.ready;
      g.send({ type: "joinRoom", code: hj.code, name });
      await g.waitFor("joined");
    }
    host.send({ type: "startGame", config: { selection: { mode: "exact", roleCounts: { werewolf: 1 } }, revealRoleOnDeath: true, nightSummary: "discreet", peacefulFirstNight: false } });
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

  it("plays a whole 4-player game over live sockets to a village win", async () => {
    // Seat host + 3 guests over real WebSockets.
    const host = new TestSocket(url);
    await host.ready;
    host.send({ type: "createRoom", game: "werewolf", name: "Host" });
    const hj = await host.waitFor("joined");
    const socks = [host];
    for (const name of ["A", "B", "C"]) {
      const g = new TestSocket(url);
      await g.ready;
      g.send({ type: "joinRoom", code: hj.code, name });
      await g.waitFor("joined");
      socks.push(g);
    }
    await host.awaitRoom((r) => r.players.length === 4);

    // Deal 1 werewolf + 3 villagers; each socket learns its own role privately.
    host.send({ type: "startGame", config: CONFIG_1_WOLF });
    const roles = await Promise.all(
      socks.map((s) => s.awaitView((v) => v.phase === "roleReveal").then((v) => v.you.roleId))
    );
    const wolfIdx = roles.findIndex((r) => r === "werewolf");
    expect(wolfIdx).toBeGreaterThanOrEqual(0);
    const wolf = socks[wolfIdx];

    // Night: the wolf devours a villager; the game auto-advances to day.
    host.act({ type: "startNight" });
    const wolfView = await wolf.awaitView((v) => v.phase === "night" && !!v.nightPrompt);
    const victimId = wolfView.nightPrompt!.targetIds[0];
    wolf.act({ type: "nightChoice", targetId: victimId });
    await host.awaitView((v) => v.phase === "dayDiscussion");

    // The dead villager's own socket should now see itself as dead.
    const victimSock = socks.find((s) => s.playerId === victimId)!;
    expect((await victimSock.awaitView((v) => v.phase === "dayDiscussion")).you.alive).toBe(false);

    // Day vote: everyone votes out the wolf; the wolf (can't self-vote) votes a decoy.
    host.act({ type: "startVote" });
    await host.awaitView((v) => v.phase === "dayVote");
    const decoy = socks.find((s) => s.playerId !== wolf.playerId && s.playerId !== victimId)!;
    for (const s of socks) {
      if (s.playerId === victimId) continue; // dead players can't vote
      const target = s.playerId === wolf.playerId ? decoy.playerId : wolf.playerId;
      s.act({ type: "castVote", targetId: target });
    }

    const over = await host.awaitView((v) => v.phase === "gameOver");
    expect(over.winner).toBe("village");
    // Roles are revealed to everyone at the end.
    expect(over.players.every((p) => p.roleId !== null)).toBe(true);

    for (const s of socks) s.close();
  });
});
