import { randomUUID } from "node:crypto";
import {
  createGame,
  reduce,
  projectView,
  allNightStepsDone,
  allVotesIn,
  validateConfig,
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

const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // no ambiguous chars

function randomCode(): string {
  let s = "";
  for (let i = 0; i < 4; i++)
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

class Room {
  state: GameState;
  private clients = new Map<PlayerId, Client>();
  private tokens = new Map<PlayerId, string>();

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
    this.broadcast();
    return { playerId, token };
  }

  rejoin(playerId: PlayerId, token: string, client: Client): boolean {
    if (this.tokens.get(playerId) !== token) return false;
    const player = this.state.players.find((p) => p.id === playerId);
    if (!player) return false;
    player.connected = true;
    this.clients.set(playerId, client);
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
          if (player?.isHost && this.state.players.length > 0)
            this.state.players[0].isHost = true;
        }
        this.broadcast();
        return;
      }
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
      case "resolveVote":
        hostOnly();
        this.apply({ type: "resolveVote" });
        break;
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
    return this.rooms.get(code.toUpperCase());
  }

  /** Remove empty, pre-game rooms so codes don't leak. */
  sweep() {
    for (const [code, room] of this.rooms) {
      if (room.empty && room.state.phase === "lobby") this.rooms.delete(code);
    }
  }
}
