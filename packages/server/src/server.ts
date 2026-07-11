import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { existsSync } from "node:fs";
import Fastify, { type FastifyInstance } from "fastify";
import websocket from "@fastify/websocket";
import fastifyStatic from "@fastify/static";
import { EngineError, type ClientMessage, type ServerMessage } from "@werewolf/shared";
import { RoomManager, type Client } from "./rooms.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const clientDist = join(__dirname, "../../client/dist");

export interface AppOptions {
  /** Serve the built client (default true when the dist exists). */
  serveClient?: boolean;
}

/** Build the Fastify app (not yet listening). Exported so tests can drive it. */
export async function createApp(opts: AppOptions = {}): Promise<FastifyInstance> {
  const manager = new RoomManager();
  const sweep = setInterval(() => manager.sweep(), 60_000);
  sweep.unref();

  const app = Fastify({ logger: false });
  app.addHook("onClose", async () => clearInterval(sweep));

  await app.register(websocket);

  app.get("/api/health", async () => ({ ok: true }));

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
        try {
          switch (msg.type) {
            case "createRoom": {
              const room = manager.create();
              const { playerId: pid, token } = room.addPlayer(msg.name, client);
              roomCode = room.code;
              playerId = pid;
              client.send({ type: "joined", playerId: pid, token, code: room.code });
              break;
            }
            case "joinRoom": {
              const room = manager.get(msg.code);
              if (!room) return fail("No room with that code.");
              const { playerId: pid, token } = room.addPlayer(msg.name, client);
              roomCode = room.code;
              playerId = pid;
              client.send({ type: "joined", playerId: pid, token, code: room.code });
              break;
            }
            case "rejoin": {
              const room = manager.get(msg.code);
              if (!room || !room.rejoin(msg.playerId, msg.token, client))
                return fail("Could not rejoin — game may have ended.");
              roomCode = room.code;
              playerId = msg.playerId;
              client.send({ type: "joined", playerId: msg.playerId, token: msg.token, code: room.code });
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
          if (err instanceof EngineError) fail(err.message);
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

  const shouldServe = opts.serveClient ?? existsSync(clientDist);
  if (shouldServe && existsSync(clientDist)) {
    await app.register(fastifyStatic, { root: clientDist });
    app.setNotFoundHandler((_req, reply) => reply.sendFile("index.html"));
  }

  return app;
}
