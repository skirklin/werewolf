import { randomUUID } from "node:crypto";
import {
  GameError,
  normalizeRoomCode,
  ROOM_CODE_LENGTH,
  type AnyGameModule,
  type ClientMessage,
  type RosterEntry,
  type RoomInfo,
  type ServerMessage,
} from "@party/core";

export interface Client {
  send(msg: ServerMessage): void;
}

/**
 * Notified as each game ends, with the game's own record (if it keeps one).
 * `playerIds` is in seat order, so a caller that already knows who sat where
 * (the arena) can attribute seats without the record carrying an identity.
 */
export type GameFinishedHook = (game: AnyGameModule, record: unknown, playerIds: string[]) => void;

// Letters only (no ambiguous I/L/O) so nobody has to hop between the letter and
// number keyboards on a phone to type a code.
const CODE_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ";
/**
 * How long a room may sit empty before it's reclaimed — lobby or game alike.
 * Generous on purpose: phones lock, tabs get backgrounded, and everyone at a
 * table can drop at once. A code should keep working through all of that.
 */
const EMPTY_ROOM_GRACE_MS = 2 * 60 * 60_000;
const MAX_NAME = 20;

function randomCode(): string {
  let s = "";
  for (let i = 0; i < ROOM_CODE_LENGTH; i++)
    s += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  return s;
}

/**
 * One room: a roster, a host, and at most one game at a time. Everything here
 * is the same for every game; the game itself is the module's business.
 */
export class Room {
  readonly players: RosterEntry[] = [];
  /** The game in progress (or just finished), or null in the lobby. */
  state: unknown = null;
  /** The last config a game was started with, offered back for a rematch. */
  private lastConfig: unknown = null;
  /** Seat order of the current game. */
  private seatIds: string[] = [];
  private clients = new Map<string, Client>();
  private tokens = new Map<string, string>();
  /** When the room last became empty (for sweeping), or null while occupied. */
  emptySince: number | null = null;

  constructor(
    readonly code: string,
    readonly game: AnyGameModule,
    private readonly onFinish?: GameFinishedHook
  ) {}

  get empty() {
    return this.clients.size === 0;
  }

  get inLobby() {
    return this.state === null;
  }

  addPlayer(name: string, client: Client): { playerId: string; token: string } {
    if (!this.inLobby) return this.reclaimSeat(name, client);
    const clean = String(name ?? "").trim().slice(0, MAX_NAME) || "Player";
    // A dropped player coming back under the same name gets their seat back.
    const ghost = this.players.find((p) => p.name.toLowerCase() === clean.toLowerCase() && !this.clients.has(p.id));
    if (ghost) return this.claim(ghost, client);
    if (this.players.length >= this.game.maxPlayers) throw new GameError("This room is full.");
    const playerId = randomUUID();
    const token = randomUUID();
    this.players.push({
      id: playerId,
      // Names are how a lost device finds its seat again, so keep them unique.
      name: this.uniqueName(clean),
      isHost: this.players.length === 0,
      connected: true,
    });
    this.tokens.set(playerId, token);
    this.clients.set(playerId, client);
    this.emptySince = null;
    this.broadcast();
    return { playerId, token };
  }

  /**
   * Mid-game, "joining" with the name you played under takes your seat back.
   * The fallback for a device that lost its saved seat (cleared storage, a
   * different browser, someone tapped Leave): only a seat with nobody
   * connected to it can be claimed, so a player at the table can't be bumped.
   */
  private reclaimSeat(name: string, client: Client): { playerId: string; token: string } {
    const wanted = String(name ?? "").trim().slice(0, MAX_NAME).toLowerCase();
    const seat = this.players.find((p) => p.name.toLowerCase() === wanted && this.seatIds.includes(p.id));
    if (!seat)
      throw new GameError("This game has already started. To get back into your seat, join with the exact name you played under.");
    if (this.clients.has(seat.id)) throw new GameError(`${seat.name} is already connected to this game.`);
    return this.claim(seat, client);
  }

  /** Hand an empty seat to a new device, retiring the old device's token. */
  private claim(seat: RosterEntry, client: Client): { playerId: string; token: string } {
    const token = randomUUID();
    this.tokens.set(seat.id, token);
    seat.connected = true;
    this.clients.set(seat.id, client);
    this.emptySince = null;
    this.rosterChanged();
    return { playerId: seat.id, token };
  }

  /** "Sam", or "Sam 2" if there's already a Sam. */
  private uniqueName(name: string): string {
    const taken = new Set(this.players.map((p) => p.name.toLowerCase()));
    if (!taken.has(name.toLowerCase())) return name;
    for (let n = 2; ; n++) {
      const candidate = `${name.slice(0, MAX_NAME - String(n).length - 1)} ${n}`;
      if (!taken.has(candidate.toLowerCase())) return candidate;
    }
  }

  rejoin(playerId: string, token: string, client: Client): boolean {
    if (!token || this.tokens.get(playerId) !== token) return false;
    const player = this.players.find((p) => p.id === playerId);
    if (!player) return false;
    player.connected = true;
    this.clients.set(playerId, client);
    this.emptySince = null;
    this.rosterChanged();
    return true;
  }

  disconnect(client: Client) {
    for (const [pid, c] of this.clients) {
      if (c !== client) continue;
      this.clients.delete(pid);
      const player = this.players.find((p) => p.id === pid);
      // Keep their seat, lobby or game: a locked phone or a flaky connection
      // shouldn't cost anyone their place (or the room its code). A lobby
      // seat still empty when the game starts is dropped then.
      if (player) player.connected = false;
      // Hand off host if the host left and someone is still connected (any phase).
      if (player?.isHost) this.reassignHostFrom(pid);
      if (this.empty) this.emptySince = Date.now();
      this.rosterChanged();
      return;
    }
  }

  handle(playerId: string, msg: ClientMessage) {
    const player = this.players.find((p) => p.id === playerId);
    if (!player) throw new GameError("You are not in this room.");
    const hostOnly = () => {
      if (!player.isHost) throw new GameError("Only the host can do that.");
    };

    switch (msg.type) {
      case "leave": {
        const client = this.clients.get(playerId);
        // Mid-game the seat stays (the game still counts it); it's just empty.
        if (client) this.disconnect(client);
        if (this.inLobby) {
          this.remove(playerId);
          this.broadcast();
        }
        return;
      }
      case "kick": {
        hostOnly();
        if (!this.inLobby) throw new GameError("Can only kick in the lobby.");
        if (msg.playerId === playerId) throw new GameError("You can't kick yourself.");
        this.remove(msg.playerId);
        this.clients.delete(msg.playerId);
        this.broadcast();
        return;
      }
      case "startGame": {
        hostOnly();
        if (!this.inLobby) throw new GameError("Game already started.");
        // Anyone whose device is gone when the host deals sits this one out
        // (they'd only stall the game). They can join the next one.
        for (const p of [...this.players]) if (!this.clients.has(p.id)) this.remove(p.id);
        const n = this.players.length;
        if (n < this.game.minPlayers)
          throw new GameError(`Need at least ${this.game.minPlayers} players to start.`);
        const config = this.game.parseConfig(msg.config, n);
        this.seatIds = this.players.map((p) => p.id);
        this.lastConfig = config;
        this.setState(
          this.game.start(this.players.map((p) => ({ ...p })), config, {
            seed: Math.floor(Math.random() * 2 ** 31),
            code: this.code,
          })
        );
        return;
      }
      case "playAgain": {
        hostOnly();
        if (this.inLobby || !this.game.isOver(this.state)) throw new GameError("The game isn't over yet.");
        // Back to the lobby with the same room. Anyone whose device left during
        // the last game is dropped now, as they would have been from a lobby.
        for (const p of [...this.players]) if (!p.connected) this.remove(p.id);
        this.state = null;
        this.seatIds = [];
        this.broadcast();
        return;
      }
      case "act": {
        if (this.inLobby) throw new GameError("The game hasn't started.");
        if (!this.seatIds.includes(playerId)) throw new GameError("You're not playing in this game.");
        this.setState(this.game.act(this.state, playerId, msg.action, { isHost: player.isHost }));
        return;
      }
      default:
        throw new GameError("Unsupported message.");
    }
  }

  info(): RoomInfo {
    return {
      code: this.code,
      game: this.game.id,
      phase: this.inLobby ? "lobby" : "playing",
      over: !this.inLobby && this.game.isOver(this.state),
      players: this.players.map((p) => ({ ...p })),
      config: this.lastConfig,
    };
  }

  /** Move to a new game state, filing a record exactly once as a game ends. */
  private setState(next: unknown) {
    const wasOver = this.state !== null && this.game.isOver(this.state);
    this.state = next;
    if (!wasOver && this.game.isOver(next)) {
      // Bookkeeping must never break a game, so a failure here is swallowed.
      try {
        const record = this.game.record?.(next) ?? null;
        this.onFinish?.(this.game, record, [...this.seatIds]);
      } catch (err) {
        console.error("Could not record a finished game:", err);
      }
    }
    this.broadcast();
  }

  private remove(playerId: string) {
    const i = this.players.findIndex((p) => p.id === playerId);
    if (i < 0) return;
    const [gone] = this.players.splice(i, 1);
    this.tokens.delete(playerId);
    if (gone.isHost) this.reassignHostFrom(playerId);
  }

  /** Move host to the first connected player when the current host is gone. */
  private reassignHostFrom(formerHostId: string) {
    const stillHost = this.players.some((p) => p.isHost && p.id !== formerHostId && this.clients.has(p.id));
    if (stillHost) return;
    // Prefer someone still connected. A host who merely dropped keeps the job
    // if nobody else is around; one who left the roster can't.
    const formerStillHere = this.players.some((p) => p.id === formerHostId);
    const heir =
      this.players.find((p) => p.id !== formerHostId && this.clients.has(p.id)) ??
      (formerStillHere ? undefined : this.players[0]);
    if (heir) for (const p of this.players) p.isHost = p.id === heir.id;
  }

  /** Presence or host changed: tell the game (if it cares), then everyone. */
  private rosterChanged() {
    if (!this.inLobby && this.game.roster) this.state = this.game.roster(this.state, this.info().players);
    this.broadcast();
  }

  private broadcast() {
    const room = this.info();
    for (const [pid, client] of this.clients) {
      try {
        client.send({ type: "room", room });
        if (!this.inLobby && this.seatIds.includes(pid))
          client.send({ type: "view", view: this.game.view(this.state, pid) });
      } catch {
        // Ignore a single failed send; the socket will be cleaned up on close.
      }
    }
  }
}

export class RoomManager {
  private rooms = new Map<string, Room>();
  private readonly games: Map<string, AnyGameModule>;

  /** @param onFinish called once per finished game, with the ids in seat order. */
  constructor(games: readonly AnyGameModule[], private readonly onFinish?: GameFinishedHook) {
    this.games = new Map(games.map((g) => [g.id, g]));
  }

  create(gameId: string): Room {
    const game = this.games.get(gameId);
    if (!game) throw new GameError("No such game.");
    let code = randomCode();
    while (this.rooms.has(code)) code = randomCode();
    const room = new Room(code, game, this.onFinish);
    this.rooms.set(code, room);
    return room;
  }

  get(code: string): Room | undefined {
    return this.rooms.get(normalizeRoomCode(String(code ?? "")));
  }

  /**
   * Reclaim rooms so they don't leak: any room — lobby or mid-game — that has
   * sat with nobody connected past the grace period. Until then, everyone who
   * held a seat can reconnect and carry on.
   */
  sweep(now: number = Date.now(), graceMs = EMPTY_ROOM_GRACE_MS) {
    for (const [code, room] of this.rooms) {
      if (!room.empty) continue;
      if (room.emptySince !== null && now - room.emptySince > graceMs) this.rooms.delete(code);
    }
  }
}
