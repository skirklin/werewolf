import { randomUUID } from "node:crypto";
import {
  createGame,
  reduce,
  projectView,
  allNightStepsDone,
  allVotesIn,
  validateConfig,
  normalizeRoomCode,
  ROOM_CODE_LENGTH,
  EngineError,
  type GameState,
  type Action,
  type ClientMessage,
  type ServerMessage,
  type PlayerId,
} from "@werewolf/shared";

export interface Client {
  send(msg: ServerMessage): void;
}

// Letters only (no ambiguous I/L/O) so nobody has to hop between the letter and
// number keyboards on a phone to type a code.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
/** How long an in-game room may sit empty before it's reclaimed. */
const EMPTY_ROOM_GRACE_MS = 15 * 60_000;

function randomCode(): string {
  let s = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++)
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

class Room {
  state: GameState;
  private clients = new Map<PlayerId, Client>();
  private tokens = new Map<PlayerId, string>();
  /** When the room last became empty (for sweeping), or null while occupied. */
  emptySince: number | null = null;

  constructor(code: string) {
    this.state = createGame(code, Math.floor(Math.random() * 2 ** 31));
  }

  get code() {
    return this.state.code;
  }

  get empty() {
    return this.clients.size === 0;
  }

  addPlayer(name: string, client: Client): { playerId: PlayerId; token: string } {
    if (this.state.phase !== "lobby") throw new EngineError("Game already in progress.");
    const playerId = randomUUID();
    const token = randomUUID();
    const isHost = this.state.players.length === 0;
    this.state.players.push({
      id: playerId,
      name: name.trim().slice(0, 20) || "Player",
      roleId: null,
      alive: true,
      connected: true,
      isHost,
    });
    this.tokens.set(playerId, token);
    this.clients.set(playerId, client);
    this.emptySince = null;
    this.broadcast();
    return { playerId, token };
  }

  rejoin(playerId: PlayerId, token: string, client: Client): boolean {
    if (this.tokens.get(playerId) !== token) return false;
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return false;
    player.connected = true;
    this.clients.set(playerId, client);
    this.emptySince = null;
    this.broadcast();
    return true;
  }

  disconnect(client: Client) {
    for (const [pid, c] of this.clients) {
      if (c === client) {
        this.clients.delete(pid);
        const player = this.state.players.find((p) => p.id === pid);
        if (player) player.connected = false;
        // Drop players who leave the lobby before the game starts.
        if (this.state.phase === "lobby") {
          this.state.players = this.state.players.filter((p) => p.id !== pid);
          this.tokens.delete(pid);
        }
        // Hand off host if the host left and someone is still connected (any phase).
        if (player?.isHost) this.reassignHostFrom(pid);
        if (this.empty) this.emptySince = Date.now();
        this.broadcast();
        return;
      }
    }
  }

  /** Move host to the first connected player when the current host is gone. */
  private reassignHostFrom(formerHostId: PlayerId) {
    const stillHost = this.state.players.some((p) => p.isHost && this.clients.has(p.id));
    if (stillHost) return;
    const heir =
      this.state.players.find((p) => p.id !== formerHostId && this.clients.has(p.id)) ??
      this.state.players.find((p) => this.clients.has(p.id));
    if (heir) {
      for (const p of this.state.players) p.isHost = p.id === heir.id;
    }
  }

  handle(playerId: PlayerId, msg: ClientMessage) {
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) throw new EngineError("You are not in this room.");

    const hostOnly = () => {
      if (!player.isHost) throw new EngineError("Only the host can do that.");
    };

    switch (msg.type) {
      case "startGame": {
        hostOnly();
        const problems = validateConfig(msg.config, this.state.players.length);
        if (problems.length) throw new EngineError(problems[0].message);
        this.apply({ type: "startGame", config: msg.config });
        break;
      }
      case "startNight":
        hostOnly();
        this.apply({ type: "startNight" });
        break;
      case "nightChoice":
        this.apply({ type: "nightChoice", actorId: playerId, targetId: msg.targetId });
        break;
      case "witchAction":
        this.apply({ type: "witchAction", actorId: playerId, save: msg.save, poisonTargetId: msg.poisonTargetId });
        break;
      case "swapAction":
        this.apply({ type: "swapAction", actorId: playerId, aId: msg.aId, bId: msg.bId });
        break;
      case "detectAction":
        this.apply({ type: "detectAction", actorId: playerId, aId: msg.aId, bId: msg.bId });
        break;
      case "raiseAction":
        this.apply({ type: "raiseAction", actorId: playerId, targetId: msg.targetId });
        break;
      case "endNight":
        hostOnly();
        this.apply({ type: "endNight" });
        break;
      case "startVote":
        hostOnly();
        this.apply({ type: "startVote" });
        break;
      case "castVote":
        this.apply({ type: "castVote", voterId: playerId, targetId: msg.targetId });
        break;
      case "shoot":
        this.apply({ type: "shoot", hunterId: playerId, targetId: msg.targetId });
        break;
      case "skipShot":
        hostOnly(); // recovery when a fallen Hunter has left before shooting
        this.apply({ type: "skipShot" });
        break;
      case "resolveVote":
        hostOnly();
        this.apply({ type: "resolveVote" });
        break;
      case "playAgain": {
        hostOnly();
        this.apply({ type: "playAgain" });
        // Anyone whose device left during the last game is gone from the roster
        // now, so retire their token too.
        for (const pid of this.tokens.keys())
          if (!this.state.players.some((p) => p.id === pid)) this.tokens.delete(pid);
        break;
      }
      case "kick": {
        hostOnly();
        if (this.state.phase !== "lobby") throw new EngineError("Can only kick in the lobby.");
        this.state.players = this.state.players.filter((p) => p.id !== msg.playerId);
        this.clients.delete(msg.playerId);
        this.tokens.delete(msg.playerId);
        this.broadcast();
        break;
      }
      default:
        throw new EngineError("Unsupported action.");
    }
  }

  /** Apply an engine action, then auto-advance any phase that has completed. */
  private apply(action: Action) {
    this.state = reduce(this.state, action);
    // Auto-resolve phases so play flows without manual prompting.
    if (this.state.phase === "night" && this.state.night && allNightStepsDone(this.state)) {
      this.state = reduce(this.state, { type: "endNight" });
    }
    if (this.state.phase === "dayVote" && allVotesIn(this.state)) {
      this.state = reduce(this.state, { type: "resolveVote" });
    }
    this.broadcast();
  }

  private broadcast() {
    for (const [pid, client] of this.clients) {
      try {
        client.send({ type: "view", view: projectView(this.state, pid) });
      } catch {
        // Ignore a single failed send; the socket will be cleaned up on close.
      }
    }
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();

  create(): Room {
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const room = new Room(code);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeRoomCode(code));
  }

  /**
   * Reclaim rooms so they don't leak: empty pre-game lobbies immediately, and
   * any room that has sat empty past the grace period (players who all vanished
   * mid-game get time to reconnect first).
   */
  sweep(now: number = Date.now(), graceMs = EMPTY_ROOM_GRACE_MS) {
    for (const [code, room] of this.rooms) {
      if (!room.empty) continue;
      if (room.state.phase === "lobby") this.rooms.delete(code);
      else if (room.emptySince !== null && now - room.emptySince > graceMs)
        this.rooms.delete(code);
    }
  }
}
