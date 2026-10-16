import { describe, it, expect, beforeEach } from "vitest";
import { GameError, type GameModule, type RoomInfo, type ServerMessage } from "@party/core";
import {
  ROLES,
  werewolfModule,
  type PlayerView,
  type GameConfig,
  type GameRecord,
  type WerewolfAction,
} from "@party/werewolf";
import { foulplayModule, botMove, Solver, makeRng, type PlayerView as DropView } from "@party/foulplay";
import { RoomManager, type Client, type Room } from "./rooms.js";

/** A fake client that records every message it received. */
class FakeClient<V = PlayerView> implements Client {
  messages: ServerMessage[] = [];
  playerId = "";
  token = "";
  send(msg: ServerMessage) {
    this.messages.push(msg);
  }
  private latest<T extends ServerMessage["type"]>(type: T) {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.type === type) return m as Extract<ServerMessage, { type: T }>;
    }
    return undefined;
  }
  get view(): V | undefined {
    return this.latest("view")?.view as V | undefined;
  }
  get room(): RoomInfo | undefined {
    return this.latest("room")?.room;
  }
}

/**
 * The smallest possible game: players take turns adding to a counter, and it
 * ends at 3. Enough to show the room knows nothing about any real game.
 */
interface CounterState {
  seats: string[];
  count: number;
  turn: number;
  roster: string[];
}
const counter: GameModule<{ target: number }, CounterState, { count: number; yourTurn: boolean }> = {
  id: "counter",
  name: "Counter",
  minPlayers: 2,
  maxPlayers: 3,
  parseConfig(raw) {
    const target = (raw as { target?: unknown })?.target;
    if (target !== 3) throw new GameError("Count to three.");
    return { target };
  },
  start: (seats) => ({ seats: seats.map((s) => s.id), count: 0, turn: 0, roster: [] }),
  act(state, seat, action) {
    if (state.seats[state.turn] !== seat) throw new GameError("Not your turn.");
    if ((action as { type?: string })?.type !== "add") throw new GameError("Unsupported action.");
    return { ...state, count: state.count + 1, turn: (state.turn + 1) % state.seats.length };
  },
  view: (state, seat) => ({ count: state.count, yourTurn: state.seats[state.turn] === seat }),
  isOver: (state) => state.count >= 3,
  roster: (state, roster) => ({ ...state, roster: roster.filter((r) => r.connected).map((r) => r.id) }),
  record: (state) => ({ count: state.count }),
};

const exact = (roleCounts: Record<string, number>): GameConfig => ({
  selection: { mode: "exact", roleCounts },
  revealRoleOnDeath: true,
  nightSummary: "discreet",
  peacefulFirstNight: false,
});

let mgr: RoomManager;
let finished: { game: string; record: unknown; ids: string[] }[];
beforeEach(() => {
  finished = [];
  mgr = new RoomManager([counter, werewolfModule, foulplayModule], (game, record, ids) =>
    finished.push({ game: game.id, record, ids })
  );
});

/** Add N players to a fresh room; returns the room and its clients. */
function seatPlayers<V = PlayerView>(count: number, game = "werewolf") {
  const room = mgr.create(game);
  const clients: FakeClient<V>[] = [];
  for (let i = 0; i < count; i++) {
    const c = new FakeClient<V>();
    // The room returns creds directly; the server is what wraps them in a
    // "joined" message, so copy them onto the fake client by hand.
    const creds = room.addPlayer(`P${i}`, c);
    c.playerId = creds.playerId;
    c.token = creds.token;
    clients.push(c);
  }
  return { room, clients };
}

const act = (room: Room, c: FakeClient<unknown>, action: unknown) =>
  room.handle(c.playerId, { type: "act", action });
const ww = (room: Room, c: FakeClient<unknown>, action: WerewolfAction) => act(room, c, action);

describe("rooms", () => {
  it("only opens rooms for games it knows", () => {
    expect(() => mgr.create("chess")).toThrow(GameError);
  });

  it("first player is host, code is 4 letters (no keyboard switching)", () => {
    const { room, clients } = seatPlayers(3, "counter");
    expect(room.code).toMatch(/^[A-Z]{4}$/);
    expect(clients[0].room!.players[0].isHost).toBe(true);
    expect(clients[0].room!.players.filter((p) => p.isHost)).toHaveLength(1);
    expect(clients[0].room!.game).toBe("counter");
  });

  it("broadcasts an updated roster to everyone as players join", () => {
    const { clients } = seatPlayers(3, "counter");
    for (const c of clients) expect(c.room!.players).toHaveLength(3);
  });

  it("turns players away once the game's table is full", () => {
    const { room } = seatPlayers(3, "counter");
    expect(() => room.addPlayer("Fourth", new FakeClient())).toThrow(/full/);
  });

  it("checks the player count and the config before starting", () => {
    const { room, clients } = seatPlayers(1, "counter");
    expect(() => room.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } })).toThrow(
      /at least 2/
    );
    room.addPlayer("Two", new FakeClient());
    expect(() => room.handle(clients[0].playerId, { type: "startGame", config: { target: 9 } })).toThrow(
      /three/
    );
    expect(room.inLobby).toBe(true);
  });

  it("rejects joining a game in progress", () => {
    const { room, clients } = seatPlayers(2, "counter");
    room.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
    expect(() => room.addPlayer("Late", new FakeClient())).toThrow();
  });

  it("non-host cannot start the game", () => {
    const { room, clients } = seatPlayers(2, "counter");
    expect(() => room.handle(clients[1].playerId, { type: "startGame", config: { target: 3 } })).toThrow(/host/i);
  });

  it("host can kick a player in the lobby, but not themselves", () => {
    const { room, clients } = seatPlayers(3, "counter");
    room.handle(clients[0].playerId, { type: "kick", playerId: clients[2].playerId });
    expect(clients[0].room!.players).toHaveLength(2);
    expect(() => room.handle(clients[0].playerId, { type: "kick", playerId: clients[0].playerId })).toThrow();
    expect(room.rejoin(clients[2].playerId, clients[2].token, clients[2])).toBe(false);
  });

  it("a disconnect in the lobby drops the player and reassigns host", () => {
    const { room, clients } = seatPlayers(3, "counter");
    room.disconnect(clients[0]);
    expect(clients[1].room!.players).toHaveLength(2);
    expect(clients[1].room!.players.some((p) => p.isHost)).toBe(true);
  });

  it("hands off host to a connected player if the host leaves mid-game, and tells the game", () => {
    const { room, clients } = seatPlayers(3, "counter");
    room.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
    room.disconnect(clients[0]);
    const host = clients[1].room!.players.find((p) => p.isHost)!;
    expect(host.id).not.toBe(clients[0].playerId);
    expect(host.connected).toBe(true);
    expect((room.state as CounterState).roster).not.toContain(clients[0].playerId);
  });

  it("sends each seated player their own view, and only once the game starts", () => {
    const { room, clients } = seatPlayers(2, "counter");
    expect(clients[0].view).toBeUndefined();
    room.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
    expect(clients[0].view).toEqual({ count: 0, yourTurn: true });
    expect(clients[1].view).toEqual({ count: 0, yourTurn: false });
    expect(clients[0].room!.phase).toBe("playing");
  });

  it("passes moves to the game and its refusals back to the player", () => {
    const { room, clients } = seatPlayers(2, "counter");
    expect(() => act(room, clients[0], { type: "add" })).toThrow(/hasn't started/);
    room.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
    expect(() => act(room, clients[1], { type: "add" })).toThrow(/Not your turn/);
    act(room, clients[0], { type: "add" });
    expect(clients[1].view).toEqual({ count: 1, yourTurn: true });
  });
});

describe("room reclamation", () => {
  it("sweeps empty lobbies immediately but gives in-game rooms a grace period", () => {
    const lobby = mgr.create("counter");
    const lobbyClient = new FakeClient();
    lobby.addPlayer("Solo", lobbyClient);
    lobby.disconnect(lobbyClient); // now an empty lobby

    const { room: started, clients } = seatPlayers(2, "counter");
    started.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
    for (const c of clients) started.disconnect(c); // in-game room now empty

    const now = Date.now();
    mgr.sweep(now, 15 * 60_000);
    expect(mgr.get(lobby.code)).toBeUndefined(); // empty lobby reclaimed now
    expect(mgr.get(started.code)).toBeDefined(); // in-game room within grace

    mgr.sweep(now + 16 * 60_000, 15 * 60_000);
    expect(mgr.get(started.code)).toBeUndefined(); // reclaimed after grace
  });
});

describe("reconnect", () => {
  it("restores a player's view with a valid token, and refuses a wrong one", () => {
    const { room, clients } = seatPlayers(2, "counter");
    room.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
    const c2 = new FakeClient();
    expect(room.rejoin(clients[0].playerId, clients[0].token, c2)).toBe(true);
    expect(c2.view).toEqual({ count: 0, yourTurn: true });
    expect(room.rejoin(clients[0].playerId, "nope", new FakeClient())).toBe(false);
  });
});

describe("rematch", () => {
  function finishedCounter(count: number) {
    const { room, clients } = seatPlayers(count, "counter");
    room.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
    for (let i = 0; i < 3; i++) act(room, clients[i % count], { type: "add" });
    return { room, clients };
  }

  it("files exactly one record as the game ends, with ids in seat order", () => {
    const { clients } = finishedCounter(2);
    expect(finished).toEqual([{ game: "counter", record: { count: 3 }, ids: clients.map((c) => c.playerId) }]);
    expect(clients[0].room!.over).toBe(true);
  });

  it("returns to the lobby in place, keeping the code and offering the last config", () => {
    const { room, clients } = finishedCounter(2);
    const code = room.code;
    room.handle(clients[0].playerId, { type: "playAgain" });
    expect(room.code).toBe(code);
    for (const c of clients) {
      expect(c.room).toMatchObject({ phase: "lobby", over: false, config: { target: 3 } });
      expect(c.room!.players).toHaveLength(2);
    }
    expect(finished).toHaveLength(1); // restarting is not a game
  });

  it("only the host can call one, and only once the game is over", () => {
    const { room, clients } = seatPlayers(2, "counter");
    room.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
    expect(() => room.handle(clients[0].playerId, { type: "playAgain" })).toThrow(/isn't over/);
    for (let i = 0; i < 3; i++) act(room, clients[i % 2], { type: "add" });
    expect(() => room.handle(clients[1].playerId, { type: "playAgain" })).toThrow(/host/i);
  });

  it("drops anyone who left before it, and retires their token", () => {
    const { room, clients } = finishedCounter(3);
    const gone = clients[2];
    room.disconnect(gone);
    room.handle(clients[0].playerId, { type: "playAgain" });
    expect(room.players).toHaveLength(2);
    expect(room.rejoin(gone.playerId, gone.token, gone)).toBe(false);
  });

  it("still lets a mid-game dropout rejoin if they beat the rematch back", () => {
    const { room, clients } = finishedCounter(3);
    const away = clients[2];
    room.disconnect(away);
    expect(room.rejoin(away.playerId, away.token, away)).toBe(true);
    room.handle(clients[0].playerId, { type: "playAgain" });
    expect(room.players).toHaveLength(3);
  });
});

describe("werewolf in a room", () => {
  it("a villager never receives another player's role", () => {
    const { room, clients } = seatPlayers(4);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1, seer: 1 }) });
    const villager = clients.find((c) => c.view!.you.roleId === "villager")!;
    const others = villager.view!.players.filter((p) => p.id !== villager.view!.you.id);
    expect(others.every((p) => p.roleId === null)).toBe(true);
    expect(villager.view!.packmates).toEqual([]);
  });

  it("werewolves see each other but the seer sees only their own visions", () => {
    const { room, clients } = seatPlayers(6);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 2, seer: 1 }) });
    const wolves = clients.filter((c) => c.view!.you.roleId === "werewolf");
    expect(wolves.length).toBe(2);
    for (const w of wolves) expect(w.view!.packmates.length).toBe(1);
    const seer = clients.find((c) => c.view!.you.roleId === "seer")!;
    expect(seer.view!.packmates).toEqual([]);
  });

  it("refuses a setup the engine wouldn't accept", () => {
    const { room, clients } = seatPlayers(4);
    expect(() => room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 2 }) })).toThrow(
      /Too many werewolves/
    );
    expect(() => room.handle(clients[0].playerId, { type: "startGame", config: "nonsense" })).toThrow(GameError);
  });

  it("keeps host-only moves for the host", () => {
    const { room, clients } = seatPlayers(4);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1 }) });
    expect(() => ww(room, clients[1], { type: "startNight" })).toThrow(/host/i);
  });

  it("plays night → day → vote → win with auto-advance", () => {
    const { room, clients } = seatPlayers(4);
    const byId = (id: string) => clients.find((c) => c.playerId === id)!;
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1 }) });

    const host = clients[0];
    ww(room, host, { type: "startNight" });
    expect(host.view!.phase).toBe("night");

    const wolf = clients.find((c) => c.view!.you.roleId === "werewolf")!;
    const victimId = wolf.view!.nightPrompt!.targetIds[0];
    ww(room, wolf, { type: "nightChoice", targetId: victimId });

    expect(host.view!.phase).toBe("dayDiscussion");
    expect(byId(victimId).view!.you.alive).toBe(false);

    ww(room, host, { type: "startVote" });
    const living = clients.filter((c) => c.view!.you.alive);
    const decoy = living.find((c) => c.playerId !== wolf.playerId)!;
    for (const c of living)
      ww(room, c, { type: "castVote", targetId: c.playerId === wolf.playerId ? decoy.playerId : wolf.playerId });

    expect(host.view!.phase).toBe("gameOver");
    expect(host.view!.winner).toBe("village");
    expect(host.view!.players.every((p) => p.roleId !== null)).toBe(true);

    // One anonymous record, with nobody's name, id or the room code in it.
    expect(finished).toHaveLength(1);
    const record = finished[0].record as GameRecord;
    expect(record).toMatchObject({ mode: "online", winner: "village", playerCount: 4 });
    const json = JSON.stringify(record);
    for (const c of clients) expect(json).not.toContain(c.playerId);
    expect(json).not.toContain(room.code);
  });

  it("doctor protection is honored end-to-end", () => {
    const { room, clients } = seatPlayers(5);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1, doctor: 1 }) });
    ww(room, clients[0], { type: "startNight" });
    const wolf = clients.find((c) => c.view!.you.roleId === "werewolf")!;
    const doctor = clients.find((c) => c.view!.you.roleId === "doctor")!;
    const victimId = wolf.view!.nightPrompt!.targetIds[0];
    ww(room, doctor, { type: "nightChoice", targetId: victimId });
    ww(room, wolf, { type: "nightChoice", targetId: victimId });
    expect(clients[0].view!.phase).toBe("dayDiscussion");
    expect(clients.find((c) => c.playerId === victimId)!.view!.you.alive).toBe(true);
  });

  it("auto-advances into hunterShot and resolves the shot", () => {
    const { room, clients } = seatPlayers(5);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1, hunter: 1 }) });
    ww(room, clients[0], { type: "startNight" });
    const wolf = clients.find((c) => c.view!.you.roleId === "werewolf")!;
    const hunter = clients.find((c) => c.view!.you.roleId === "hunter")!;
    ww(room, wolf, { type: "nightChoice", targetId: hunter.playerId });
    expect(clients[0].view!.phase).toBe("hunterShot");
    const victim = hunter.view!.shootPrompt!.targetIds.find((id) => id !== wolf.playerId)!;
    ww(room, hunter, { type: "shoot", targetId: victim });
    expect(clients[0].view!.phase).toBe("dayDiscussion");
    expect(clients.find((c) => c.playerId === victim)!.view!.you.alive).toBe(false);
  });

  it("shows presence and host changes inside the game view", () => {
    const { room, clients } = seatPlayers(4);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1 }) });
    room.disconnect(clients[0]);
    const view = clients[1].view!;
    expect(view.players.find((p) => p.id === clients[0].playerId)!.connected).toBe(false);
    expect(view.players.find((p) => p.isHost)!.id).not.toBe(clients[0].playerId);
  });

  it("every role has a team and emoji", () => {
    for (const role of Object.values(ROLES)) {
      expect(role.emoji.length).toBeGreaterThan(0);
      expect(["village", "werewolf", "solo"]).toContain(role.team);
    }
  });
});

describe("dead drop in a room", () => {
  it("plays a bot game to a correct accusation", () => {
    const { room, clients } = seatPlayers<DropView>(3, "foulplay");
    expect(() => room.handle(clients[0].playerId, { type: "startGame", config: { mode: "chaos" } })).toThrow(
      GameError
    );
    room.handle(clients[0].playerId, { type: "startGame", config: { mode: "competitive" } });
    const view = clients[0].view!;
    expect(view.answer).toBeNull();
    expect(JSON.stringify(view)).not.toContain("schedule");

    const solver = new Solver(view.dossier);
    const rng = makeRng(3);
    for (let step = 0; step < 2000 && !clients[0].view!.answer; step++) {
      const mover = clients.find((c) => botMove(c.view!, solver, rng));
      expect(mover).toBeDefined();
      act(room, mover!, botMove(mover!.view!, solver, rng));
    }
    const end = clients[0].view!;
    expect(end.phase).toMatchObject({ kind: "over", reason: "solved" });
    expect(clients[0].room!.over).toBe(true);
    expect(finished).toEqual([{ game: "foulplay", record: null, ids: clients.map((c) => c.playerId) }]);
  }, 30_000);
});
