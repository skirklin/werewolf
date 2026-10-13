import { WebSocket } from "ws";
import type { ClientMessage, RoomInfo, ServerMessage as AnyServerMessage } from "@party/core";
import type { GameConfig, PlayerView, WerewolfAction } from "@party/werewolf";

type ServerMessage = AnyServerMessage<PlayerView>;

/**
 * One agent's connection to the game.
 *
 * This is the whole isolation story: an agent holds one of these and nothing
 * else. What it can see is exactly what a phone sees — the server's redacted
 * `PlayerView` — so an agent cannot read another player's role even if its
 * strategy tries to, because the server never sent it.
 */
export class ArenaClient {
  private latest: PlayerView | null = null;
  private room: RoomInfo | null = null;
  private waiters: (() => void)[] = [];
  /** Server-side complaints (illegal move, wrong phase). Handy when debugging a strategy. */
  readonly errors: string[] = [];
  playerId = "";
  code = "";

  private constructor(private readonly ws: WebSocket) {}

  static connect(url: string): Promise<ArenaClient> {
    const ws = new WebSocket(url);
    const client = new ArenaClient(ws);
    ws.on("message", (raw: Buffer) => client.receive(JSON.parse(raw.toString()) as ServerMessage));
    return new Promise((resolve, reject) => {
      ws.once("open", () => resolve(client));
      ws.once("error", reject);
    });
  }

  private receive(msg: ServerMessage) {
    if (msg.type === "view") this.latest = msg.view;
    else if (msg.type === "room") this.room = msg.room;
    else if (msg.type === "joined") {
      this.playerId = msg.playerId;
      this.code = msg.code;
    } else if (msg.type === "error") this.errors.push(msg.message);
    for (const wake of this.waiters.splice(0)) wake();
  }

  private raw(msg: ClientMessage) {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }

  /** Make a move in the game. */
  send(action: WerewolfAction) {
    this.raw({ type: "act", action });
  }

  /** Deal the game (host only), and wait for this seat's first view of it. */
  async startGame(config: GameConfig): Promise<PlayerView> {
    this.raw({ type: "startGame", config });
    return this.waitFor(() => true, "the deal");
  }

  /** The last view the server sent, or null before the first one arrives. */
  get view(): PlayerView | null {
    return this.latest;
  }

  async createRoom(name: string): Promise<string> {
    this.raw({ type: "createRoom", game: "werewolf", name });
    await this.until(() => (this.playerId ? true : undefined));
    return this.code;
  }

  async joinRoom(code: string, name: string): Promise<void> {
    this.raw({ type: "joinRoom", code, name });
    await this.until(() => (this.playerId ? true : undefined));
  }

  /** Wait until the room has this many players in it. */
  waitForPlayers(n: number): Promise<RoomInfo> {
    return this.until(() => (this.room && this.room.players.length === n ? this.room : undefined), "a full lobby");
  }

  /** Wait for a view that satisfies `pred`. Throws rather than hang forever. */
  waitFor(pred: (view: PlayerView) => boolean, label = "a view"): Promise<PlayerView> {
    return this.until(() => (this.latest && pred(this.latest) ? this.latest : undefined), label);
  }

  /**
   * The soft version: wait a little for something that is merely expected, and
   * report whether it turned up. Used for confirmations where carrying on
   * regardless is better than failing the game.
   */
  async soft(pred: (view: PlayerView) => boolean, ms: number): Promise<boolean> {
    try {
      await this.until(
        () => (this.latest && pred(this.latest) ? true : undefined),
        "a confirmation",
        ms
      );
      return true;
    } catch {
      return false;
    }
  }

  private async until<T>(find: () => T | undefined, label = "a message", ms = 30_000): Promise<T> {
    const deadline = Date.now() + ms;
    for (;;) {
      const hit = find();
      if (hit !== undefined) return hit;
      if (Date.now() > deadline)
        throw new Error(`Timed out waiting for ${label}${lastError(this.errors)}`);
      await new Promise<void>((resolve) => {
        this.waiters.push(resolve);
        setTimeout(resolve, 25);
      });
    }
  }

  close() {
    this.ws.close();
  }
}

function lastError(errors: string[]): string {
  return errors.length ? ` (last server error: ${errors[errors.length - 1]})` : "";
}
