import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { GameError, type ClientMessage, type ServerMessage } from "@party/core";
import { aggregate, parseGameRecord, werewolfModule, type GameRecord } from "@party/werewolf";
import { deaddropModule } from "@party/deaddrop";
import { RoomManager, type Client } from "./rooms.js";
import { GameStore } from "./store.js";

/** Every game this server can host. */
export const GAMES = [werewolfModule, deaddropModule];

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, "../../client/dist");

export interface AppOptions {
  /** Serve the built client (default true when the dist exists). */
  serveClient?: boolean;
  /**
   * Where to keep finished-game records. Defaults to `WEREWOLF_DATA_DIR`; with
   * neither, records live in memory only and vanish on restart.
   */
  dataDir?: string | null;
  /**
   * Notified as each Werewolf game ends, alongside the store, with the player
   * ids in seat order. The arena uses this to label seats with the strategy
   * that played them.
   */
  onGameFinished?: (record: GameRecord, playerIds: string[]) => void;
}

/** Biggest game record we'll accept from a client, in bytes. */
const MAX_RECORD_BYTES = 64 * 1024;
/** Records one address may submit per hour. Generous for a household, useless for a flood. */
const SUBMIT_LIMIT = 30;
const SUBMIT_WINDOW_MS = 60 * 60_000;

/** Build the Fastify app (not yet listening). Exported so tests can drive it. */
export async function createApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const store = await GameStore.open(
    opts.dataDir === undefined ? process.env.WEREWOLF_DATA_DIR : opts.dataDir
  );
  // Only Werewolf keeps stats so far; the store and the stats API are its.
  const manager = new RoomManager(GAMES, (game, record, playerIds) => {
    if (game.id !== werewolfModule.id || !record) return;
    const stamped = { ...(record as GameRecord), finishedAt: stamp() };
    store.add(stamped);
    opts.onGameFinished?.(stamped, playerIds);
  });
  const sweep = setInterval(() => manager.sweep(), 60_000);
  sweep.unref();

  // trustProxy so `req.ip` is the player's address rather than Caddy's —
  // without it every submission would share a single rate-limit bucket.
  const app = Fastify({ logger: false, bodyLimit: MAX_RECORD_BYTES, trustProxy: true });
  app.addHook("onClose", async () => clearInterval(sweep));

  await app.register(websocket);

  app.get("/api/health", async () => ({ ok: true }));

  app.get("/api/catalog", async () =>
    GAMES.map((g) => ({ id: g.id, name: g.name, minPlayers: g.minPlayers, maxPlayers: g.maxPlayers }))
  );

  // ---- Anonymous Werewolf stats (public: the records hold nobody's name) ----

  /**
   * `?mode=` picks the population: people (the default — arena games would
   * otherwise swamp the real numbers), agent, or all.
   */
  const pick = (mode: string | undefined) => {
    const all = store.all();
    if (mode === "all") return all;
    if (mode === "agent") return all.filter((r) => r.mode === "agent");
    return all.filter((r) => r.mode !== "agent");
  };

  app.get<{ Querystring: { mode?: string } }>("/api/stats", async (req) =>
    aggregate(pick(req.query.mode))
  );

  app.get<{ Querystring: { limit?: string; mode?: string } }>("/api/games", async (req) => {
    const chosen = pick(req.query.mode);
    const limit = Math.min(Math.max(Number(req.query.limit) || 500, 1), 5000);
    return { total: chosen.length, games: chosen.slice(-limit) };
  });

  /**
   * Pass-the-device games run entirely in the browser, so that client posts its
   * own record here. Untrusted by definition: the body is re-validated, the
   * timestamp is ours, and the mode is forced to "local" so a submission can
   * never masquerade as a server-refereed game.
   */
  const submits = new RateLimiter(SUBMIT_LIMIT, SUBMIT_WINDOW_MS);
  app.post("/api/games", async (req, reply) => {
    if (!submits.allow(req.ip)) return reply.code(429).send({ error: "Slow down." });
    const record = parseGameRecord(req.body);
    if (!record) return reply.code(400).send({ error: "Not a game record." });
    store.add({ ...record, mode: "local", finishedAt: stamp() });
    return { ok: true };
  });

  await app.register(async (instance) => {
    instance.get("/ws", { websocket: true }, (socket) => {
      let roomCode: string | null = null;
      let playerId: string | null = null;

      const client: Client = {
        send(msg: ServerMessage) {
          if (socket.readyState === socket.OPEN) socket.send(JSON.stringify(msg));
        },
      };
      const fail = (message: string) => client.send({ type: "error", message });

      socket.on("message", (raw: Buffer) => {
        let msg: ClientMessage;
        try {
          msg = JSON.parse(raw.toString());
        } catch {
          return fail("Malformed message.");
        }
        if (!msg || typeof msg !== "object") return fail("Malformed message.");
        try {
          switch (msg.type) {
            case "createRoom": {
              const room = manager.create(msg.game);
              const { playerId: pid, token } = room.addPlayer(msg.name, client);
              roomCode = room.code;
              playerId = pid;
              client.send({ type: "joined", playerId: pid, token, code: room.code, game: room.game.id });
              break;
            }
            case "joinRoom": {
              const room = manager.get(msg.code);
              if (!room) return fail("No room with that code.");
              const { playerId: pid, token } = room.addPlayer(msg.name, client);
              roomCode = room.code;
              playerId = pid;
              client.send({ type: "joined", playerId: pid, token, code: room.code, game: room.game.id });
              break;
            }
            case "rejoin": {
              const room = manager.get(msg.code);
              if (!room || !room.rejoin(msg.playerId, msg.token, client))
                return fail("Could not rejoin — game may have ended.");
              roomCode = room.code;
              playerId = msg.playerId;
              client.send({
                type: "joined",
                playerId: msg.playerId,
                token: msg.token,
                code: room.code,
                game: room.game.id,
              });
              break;
            }
            default: {
              if (!roomCode || !playerId) return fail("Join a room first.");
              const room = manager.get(roomCode);
              if (!room) return fail("Room no longer exists.");
              room.handle(playerId, msg);
            }
          }
        } catch (err) {
          if (err instanceof GameError) fail(err.message);
          else {
            fail("Something went wrong.");
            console.error(err);
          }
        }
      });

      socket.on("close", () => {
        if (roomCode) manager.get(roomCode)?.disconnect(client);
      });
    });
  });

  app.addHook("onClose", async () => submits.stop());

  const shouldServe = opts.serveClient ?? existsSync(clientDist);
  if (shouldServe && existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    app.setNotFoundHandler((_req, reply) => reply.sendFile("index.html"));
  }

  return app;
}

function stamp(): string {
  return new Date().toISOString();
}

/**
 * Fixed-window limiter, per client address. In-memory and single-process, which
 * matches the one replica this runs as — it exists to stop a bored visitor from
 * flooding the stats, not to survive a determined attacker.
 */
class RateLimiter {
  private hits = new Map<string, { count: number; resetAt: number }>();
  private readonly timer: NodeJS.Timeout;

  constructor(
    private readonly limit: number,
    private readonly windowMs: number
  ) {
    // Sweep expired buckets so a churn of addresses can't grow the map forever.
    this.timer = setInterval(() => {
      const now = Date.now();
      for (const [key, hit] of this.hits) if (hit.resetAt <= now) this.hits.delete(key);
    }, windowMs);
    this.timer.unref();
  }

  allow(key: string): boolean {
    const now = Date.now();
    const hit = this.hits.get(key);
    if (!hit || hit.resetAt <= now) {
      this.hits.set(key, { count: 1, resetAt: now + this.windowMs });
      return true;
    }
    if (hit.count >= this.limit) return false;
    hit.count++;
    return true;
  }

  stop() {
    clearInterval(this.timer);
  }
}
