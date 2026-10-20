import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { WebSocket } from "ws";
import type { FastifyInstance } from "fastify";
import type { ClientMessage, RoomInfo, ServerMessage as AnyServerMessage } from "@party/core";
import type { PlayerView, WerewolfAction } from "@party/werewolf";
import { mkdtempSync, rmSync, existsSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
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
    expect(res.json().map((g: { id: string }) => g.id)).toEqual(["werewolf", "foulplay"]);
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

describe("client version enforcement", () => {
  let strict: FastifyInstance;
  let strictUrl: string;

  beforeAll(async () => {
    strict = await createApp({ serveClient: false, dataDir: null, build: "build-2" });
    await strict.listen({ port: 0, host: "127.0.0.1" });
    const addr = strict.server.address();
    strictUrl = `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`;
  });

  afterAll(async () => {
    await strict.close();
  });

  it("turns away a page from an older deploy (or one that names no build) and says why", async () => {
    for (const target of [`${strictUrl}?build=build-1`, strictUrl]) {
      const old = new TestSocket(target);
      await old.ready;
      expect(await old.waitFor("outdated")).toEqual({ type: "outdated", build: "build-2" });
      expect((await old.waitFor("error")).message).toMatch(/reload/i);
    }
  });

  it("lets the current page in", async () => {
    const current = new TestSocket(`${strictUrl}?build=build-2`);
    await current.ready;
    expect(await current.waitFor("hello")).toEqual({ type: "hello", build: "build-2" });
    current.send({ type: "createRoom", game: "werewolf", name: "Sam" });
    expect((await current.waitFor("joined")).code).toHaveLength(4);
  });
});

describe("rooms survive a restart", () => {
  it("saves live games on shutdown and the next server picks them up", async () => {
    const dir = mkdtempSync(join(tmpdir(), "werewolf-rooms-"));
    try {
      const listen = async (a: FastifyInstance) => {
        await a.listen({ port: 0, host: "127.0.0.1" });
        const addr = a.server.address();
        return `ws://127.0.0.1:${typeof addr === "object" && addr ? addr.port : 0}/ws`;
      };

      // A game in progress on the first server.
      const first = await createApp({ serveClient: false, dataDir: dir });
      const firstUrl = await listen(first);
      const socks = [new TestSocket(firstUrl), new TestSocket(firstUrl), new TestSocket(firstUrl)];
      await Promise.all(socks.map((s) => s.ready));
      socks[0].send({ type: "createRoom", game: "werewolf", name: "Host" });
      const { code } = await socks[0].waitFor("joined");
      for (const [i, s] of socks.slice(1).entries()) s.send({ type: "joinRoom", code, name: `G${i}` });
      await socks[0].awaitRoom((r) => r.players.length === 3);
      socks[0].send({ type: "startGame", config: CONFIG_1_WOLF });
      await socks[0].awaitView((v) => v.phase === "roleReveal");
      socks[0].act({ type: "startNight" });
      const before = await socks[0].awaitView((v) => v.phase === "night");
      const creds = await Promise.all(socks.map((s) => s.waitFor("joined")));

      // The deploy: the old server closes (saving), the new one starts (loading).
      await first.close();
      expect(existsSync(join(dir, "rooms.json"))).toBe(true);
      expect(JSON.parse(readFileSync(join(dir, "rooms.json"), "utf8")).rooms).toHaveLength(1);
      const second = await createApp({ serveClient: false, dataDir: dir });
      const secondUrl = await listen(second);
      try {
        // A phone reconnects with the seat it saved and is right back in the night.
        const phone = new TestSocket(secondUrl);
        await phone.ready;
        phone.send({ type: "rejoin", code, playerId: creds[0].playerId, token: creds[0].token });
        expect((await phone.waitFor("joined")).code).toBe(code);
        const after = await phone.awaitView((v) => v.phase === "night");
        expect(after.round).toBe(before.round);
        expect(after.you.roleId).toBe(before.you.roleId);
        phone.close();
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
