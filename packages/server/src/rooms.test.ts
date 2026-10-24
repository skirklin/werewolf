import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
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
import { RoomManager, displayName, HOST_AWAY_GRACE_MS, type Client, type Room } from "./rooms.js";

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

  it("a disconnect in the lobby keeps the seat (so they can rejoin), and the host keeps the job", () => {
    const { room, clients } = seatPlayers(3, "counter");
    room.disconnect(clients[0]);
    const players = clients[1].room!.players;
    expect(players).toHaveLength(3);
    expect(players.find((p) => p.id === clients[0].playerId)!.connected).toBe(false);
    expect(players.find((p) => p.isHost)!.id).toBe(clients[0].playerId);
    // Their phone wakes back up: same seat, same room, still host.
    expect(room.rejoin(clients[0].playerId, clients[0].token, clients[0])).toBe(true);
    expect(clients[0].room!.players.find((p) => p.id === clients[0].playerId)!.connected).toBe(true);
    expect(clients[0].room!.players.find((p) => p.isHost)!.id).toBe(clients[0].playerId);
  });

  describe("a host who steps away", () => {
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it("keeps the job through a short absence", () => {
      const { room, clients } = seatPlayers(3, "counter");
      room.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
      room.disconnect(clients[0]);
      vi.advanceTimersByTime(HOST_AWAY_GRACE_MS - 1000);
      expect(room.rejoin(clients[0].playerId, clients[0].token, clients[0])).toBe(true);
      vi.advanceTimersByTime(HOST_AWAY_GRACE_MS * 2);
      expect(clients[1].room!.players.find((p) => p.isHost)!.id).toBe(clients[0].playerId);
    });

    it("hands it to someone connected once the grace period runs out", () => {
      const { room, clients } = seatPlayers(3, "counter");
      room.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
      room.disconnect(clients[0]);
      vi.advanceTimersByTime(HOST_AWAY_GRACE_MS + 1);
      const host = clients[1].room!.players.find((p) => p.isHost)!;
      expect(host.id).not.toBe(clients[0].playerId);
      expect(host.connected).toBe(true);
    });

    it("hands it on at once when the host leaves on purpose", () => {
      const { room, clients } = seatPlayers(3, "counter");
      room.handle(clients[0].playerId, { type: "leave" });
      expect(clients[1].room!.players.find((p) => p.isHost)!.id).toBe(clients[1].playerId);
    });
  });

  it("mid-game, joining from the same device takes back that device's seat", () => {
    const room = mgr.create("counter");
    const phones = ["device-aaaaaaaaaaaaaaaa", "device-bbbbbbbbbbbbbbbb"];
    const first = phones.map((d, i) => {
      const c = new FakeClient();
      return { c, ...room.addPlayer(`P${i}`, c, d) };
    });
    room.handle(first[0].playerId, { type: "startGame", config: { target: 3 } });

    // Someone tapped Leave (saved seat gone), then joins again from that phone.
    room.disconnect(first[1].c);
    const again = new FakeClient();
    const back = room.addPlayer("whatever name", again, phones[1]);
    expect(back.playerId).toBe(first[1].playerId);
    expect(again.room!.players.find((p) => p.id === back.playerId)!.connected).toBe(true);
    expect(room.rejoin(back.playerId, first[1].token, new FakeClient())).toBe(false); // old token retired

    // A name is not a key: someone else using that name gets nothing.
    expect(() => room.addPlayer("P1", new FakeClient(), "device-cccccccccccccccc")).toThrow(/already started/);
    expect(() => room.addPlayer("P1", new FakeClient())).toThrow(/already started/);
    // And no device id is ever shown to the table.
    expect(JSON.stringify(again.messages)).not.toContain("device-");
  });

  it("shows a nickname beside the real name, so the table knows who's who", () => {
    const room = mgr.create("werewolf");
    room.addPlayer("Sam", new FakeClient(), "device-aaaaaaaaaaaaaaaa", "Captain Howl");
    room.addPlayer("Ana", new FakeClient(), "device-bbbbbbbbbbbbbbbb");
    room.addPlayer("  Ben ", new FakeClient(), "device-cccccccccccccccc", "  "); // blank nickname
    room.addPlayer("Kai", new FakeClient(), "device-dddddddddddddddd", "kai"); // same as the name
    expect(room.players.map((p) => p.name)).toEqual(["Captain Howl (Sam)", "Ana", "Ben", "Kai"]);
  });

  it("the same device joining a lobby twice keeps one seat", () => {
    const room = mgr.create("counter");
    const a = room.addPlayer("Sam", new FakeClient(), "device-aaaaaaaaaaaaaaaa");
    const b = room.addPlayer("Sam", new FakeClient(), "device-aaaaaaaaaaaaaaaa");
    expect(b.playerId).toBe(a.playerId);
    expect(room.players).toHaveLength(1);
    // Two different people called Sam get told apart.
    room.addPlayer("Sam", new FakeClient(), "device-bbbbbbbbbbbbbbbb");
    expect(room.players.map((p) => p.name)).toEqual(["Sam", "Sam 2"]);
  });

  it("leaving the lobby on purpose frees the seat for good", () => {
    const { room, clients } = seatPlayers(3, "counter");
    room.handle(clients[2].playerId, { type: "leave" });
    expect(clients[0].room!.players).toHaveLength(2);
    expect(room.rejoin(clients[2].playerId, clients[2].token, clients[2])).toBe(false);
  });

  it("drops lobby seats that are still empty when the game starts", () => {
    const { room, clients } = seatPlayers(3, "counter");
    room.disconnect(clients[2]);
    room.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
    expect(clients[0].room!.players.map((p) => p.id)).toEqual([clients[0].playerId, clients[1].playerId]);
    expect(room.rejoin(clients[2].playerId, clients[2].token, clients[2])).toBe(false);
  });

  it("hands off host to a connected player if the host leaves mid-game, and tells the game", () => {
    const { room, clients } = seatPlayers(3, "counter");
    room.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
    room.handle(clients[0].playerId, { type: "leave" });
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
  it("gives empty rooms — lobby or in-game — a grace period before reclaiming them", () => {
    const lobby = mgr.create("counter");
    const lobbyClient = new FakeClient();
    lobby.addPlayer("Solo", lobbyClient);
    lobby.disconnect(lobbyClient); // now an empty lobby

    const { room: started, clients } = seatPlayers(2, "counter");
    started.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
    for (const c of clients) started.disconnect(c); // in-game room now empty

    const now = Date.now();
    mgr.sweep(now, 15 * 60_000);
    expect(mgr.get(lobby.code)).toBeDefined(); // a lobby whose host's phone locked survives
    expect(mgr.get(started.code)).toBeDefined(); // in-game room within grace

    mgr.sweep(now + 16 * 60_000, 15 * 60_000);
    expect(mgr.get(lobby.code)).toBeUndefined(); // reclaimed after grace
    expect(mgr.get(started.code)).toBeUndefined();
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

/** Everyone with no power tonight taps their decoy (the night waits for them). */
function idleAll(room: Room, clients: FakeClient[]) {
  for (const c of clients) {
    const prompt = c.view?.phase === "night" ? c.view.idlePrompt : null;
    if (prompt) ww(room, c, { type: "nightIdle", targetId: prompt.targetIds[0] });
  }
}

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
    const { room, clients } = seatPlayers(7);
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
      /Too many/
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
    idleAll(room, clients);

    // Dawn is announced to everyone; the host moves them on to the day.
    expect(clients[1].view!.announcement).toMatchObject({ kind: "dawn", events: [{ t: "killed", playerId: victimId }] });
    ww(room, host, { type: "proceed" });
    expect(host.view!.phase).toBe("dayDiscussion");
    expect(byId(victimId).view!.you.alive).toBe(false);

    ww(room, host, { type: "startVote" });
    const living = clients.filter((c) => c.view!.you.alive);
    const decoy = living.find((c) => c.playerId !== wolf.playerId)!;
    // One at a time, in the order the day calls them.
    for (let turn = host.view!.voteTurn; turn; turn = host.view!.phase === "dayVote" ? host.view!.voteTurn : null) {
      const c = living.find((x) => x.playerId === turn)!;
      ww(room, c, { type: "castVote", targetId: c.playerId === wolf.playerId ? decoy.playerId : wolf.playerId });
    }

    // The result is announced to everyone first; the host moves them on.
    expect(host.view!.phase).toBe("announce");
    expect(clients[1].view!.announcement).toMatchObject({
      kind: "vote",
      events: [{ t: "votedOut", playerId: wolf.playerId }],
      next: "gameOver",
    });
    expect(finished).toHaveLength(0); // the game isn't over until it's over
    ww(room, host, { type: "proceed" });
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
    idleAll(room, clients);
    expect(clients[0].view!.announcement!.events).toEqual([{ t: "quiet" }]); // a discreet save
    expect(clients.find((c) => c.playerId === victimId)!.view!.you.alive).toBe(true);
  });

  it("a Hunter killed at night takes their pick down too, and it's announced at dawn", () => {
    const { room, clients } = seatPlayers(5);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1, hunter: 1 }) });
    ww(room, clients[0], { type: "startNight" });
    const wolf = clients.find((c) => c.view!.you.roleId === "werewolf")!;
    const hunter = clients.find((c) => c.view!.you.roleId === "hunter")!;
    expect(hunter.view!.nightPrompt!.kind).toBe("mark");
    const pick = hunter.view!.nightPrompt!.targetIds.find((id) => id !== wolf.playerId)!;
    ww(room, hunter, { type: "nightChoice", targetId: pick });
    ww(room, wolf, { type: "nightChoice", targetId: hunter.playerId });
    idleAll(room, clients);
    expect(clients[0].view!.announcement!.events).toEqual([
      { t: "killed", playerId: hunter.playerId },
      { t: "shot", shooterId: hunter.playerId, playerId: pick },
    ]);
    expect(clients.find((c) => c.playerId === pick)!.view!.you.alive).toBe(false);
  });

  it("shows presence and host changes inside the game view", () => {
    const { room, clients } = seatPlayers(4);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1 }) });
    room.handle(clients[0].playerId, { type: "leave" });
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

describe("foul play in a room", () => {
  it("plays a bot game through to the verdict", () => {
    const { room, clients } = seatPlayers<DropView>(5, "foulplay");
    expect(() => room.handle(clients[0].playerId, { type: "startGame", config: { accomplice: "maybe" } })).toThrow(
      GameError
    );
    room.handle(clients[0].playerId, { type: "startGame", config: {} });
    const views = clients.map((c) => c.view!);
    expect(views.filter((v) => v.you.role === "killer")).toHaveLength(1);
    // Innocents get no hint of the truth.
    for (const v of views.filter((v) => v.you.role === "innocent")) {
      expect(v.guilty).toBeNull();
      expect(v.reveal).toBeNull();
    }

    const solver = new Solver(views[0].dossier);
    const rng = makeRng(3);
    for (let step = 0; step < 2000 && !clients[0].view!.reveal; step++) {
      const mover = clients.find((c) => botMove(c.view!, solver, rng));
      expect(mover).toBeDefined();
      act(room, mover!, botMove(mover!.view!, solver, rng));
    }
    const end = clients[0].view!;
    expect(end.phase.kind).toBe("over");
    expect(clients[0].room!.over).toBe(true);
    expect(finished).toEqual([{ game: "foulplay", record: null, ids: clients.map((c) => c.playerId) }]);
  }, 30_000);
});

describe("restoring saved rooms", () => {
  it("brings a room back with its seats, disconnected until they rejoin", () => {
    const { room, clients } = seatPlayers(2, "counter");
    room.handle(clients[0].playerId, { type: "startGame", config: { target: 3 } });
    act(room, clients[0], { type: "add" });
    const next = new RoomManager([counter]);
    expect(next.restore([room.snapshot()])).toEqual({ restored: 1, skipped: 0 });
    const back = next.get(room.code)!;
    expect(back.players.every((p) => !p.connected)).toBe(true);
    expect(back.empty).toBe(true);
    const phone = new FakeClient();
    expect(back.rejoin(clients[1].playerId, clients[1].token, phone)).toBe(true);
    expect((phone.view as unknown as { count: number }).count).toBe(1);
  });

  it("skips rooms it can't run instead of failing to start", () => {
    const { room } = seatPlayers(2, "counter");
    const snap = room.snapshot();
    const next = new RoomManager([{ ...counter, stateVersion: 2 }]);
    const warn = console.warn;
    console.warn = () => {};
    try {
      expect(next.restore([snap, { ...snap, game: "nope" }, null as never])).toEqual({ restored: 0, skipped: 3 });
    } finally {
      console.warn = warn;
    }
  });
});

describe("display names", () => {
  it("caps each part separately and never shows an empty name", () => {
    expect(displayName("A".repeat(30), "B".repeat(30))).toBe(`${"B".repeat(20)} (${"A".repeat(20)})`);
    expect(displayName("", "")).toBe("Player");
    expect(displayName(undefined, "Wolfie")).toBe("Wolfie (Player)");
  });
});
