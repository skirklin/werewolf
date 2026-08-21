import { describe, it, expect, beforeEach } from "vitest";
import { ROLES, type ServerMessage, type PlayerView, type GameConfig, type GameRecord } from "@werewolf/shared";
import { RoomManager, type Client, type Room } from "./rooms.js";

/** A fake client that records the latest view and every message it received. */
class FakeClient implements Client {
  messages: ServerMessage[] = [];
  playerId = "";
  token = "";
  send(msg: ServerMessage) {
    this.messages.push(msg);
    if (msg.type === "joined") {
      this.playerId = msg.playerId;
      this.token = msg.token;
    }
  }
  get view(): PlayerView | undefined {
    for (let i = this.messages.length - 1; i >= 0; i--) {
      const m = this.messages[i];
      if (m.type === "view") return m.view;
    }
    return undefined;
  }
}

const exact = (roleCounts: Record<string, number>): GameConfig => ({
  selection: { mode: "exact", roleCounts },
  revealRoleOnDeath: true,
  nightSummary: "discreet", peacefulFirstNight: false,
});

let mgr: RoomManager;
beforeEach(() => {
  mgr = new RoomManager();
});

/** Add N players to a fresh room; returns the room and its clients. */
function seatPlayers(count: number) {
  const room = mgr.create();
  const clients: FakeClient[] = [];
  for (let i = 0; i < count; i++) {
    const c = new FakeClient();
    // The room returns creds directly; the server is what wraps them in a
    // "joined" message, so copy them onto the fake client by hand.
    const creds = room.addPlayer(`P${i}`, c);
    c.playerId = creds.playerId;
    c.token = creds.token;
    clients.push(c);
  }
  return { room, clients };
}

describe("lobby", () => {
  it("first player is host, code is 4 letters (no keyboard switching)", () => {
    const { room, clients } = seatPlayers(3);
    expect(room.code).toMatch(/^[A-Z]{4}$/);
    expect(clients[0].view!.players[0].isHost).toBe(true);
    expect(clients[0].view!.players.filter((p) => p.isHost)).toHaveLength(1);
  });

  it("broadcasts an updated roster to everyone as players join", () => {
    const { clients } = seatPlayers(3);
    for (const c of clients) expect(c.view!.players).toHaveLength(3);
  });

  it("rejects joining a game in progress", () => {
    const { room, clients } = seatPlayers(4);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1 }) });
    const late = new FakeClient();
    expect(() => room.addPlayer("Late", late)).toThrow();
  });

  it("non-host cannot start the game", () => {
    const { room, clients } = seatPlayers(4);
    expect(() =>
      room.handle(clients[1].playerId, { type: "startGame", config: exact({ werewolf: 1 }) })
    ).toThrow(/host/i);
  });

  it("host can kick a player in the lobby", () => {
    const { room, clients } = seatPlayers(4);
    room.handle(clients[0].playerId, { type: "kick", playerId: clients[3].playerId });
    expect(clients[0].view!.players).toHaveLength(3);
  });

  it("a disconnect in the lobby drops the player and reassigns host", () => {
    const { room, clients } = seatPlayers(3);
    room.disconnect(clients[0]);
    expect(clients[1].view!.players).toHaveLength(2);
    expect(clients[1].view!.players.some((p) => p.isHost)).toBe(true);
  });

  it("hands off host to a connected player if the host leaves mid-game", () => {
    const { room, clients } = seatPlayers(4);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1 }) });
    room.disconnect(clients[0]); // host drops mid-game
    const stillHere = clients.find((c) => c.playerId !== clients[0].playerId)!;
    const host = stillHere.view!.players.find((p) => p.isHost)!;
    expect(host.id).not.toBe(clients[0].playerId);
    expect(stillHere.view!.players.find((p) => p.id === host.id)!.connected).toBe(true);
  });
});

describe("room reclamation", () => {
  it("sweeps empty lobbies immediately but gives in-game rooms a grace period", () => {
    const lobby = mgr.create();
    const lobbyClient = new FakeClient();
    lobby.addPlayer("Solo", lobbyClient);
    lobby.disconnect(lobbyClient); // now an empty lobby

    const started = mgr.create();
    const players = [new FakeClient(), new FakeClient(), new FakeClient()];
    players.forEach((c, i) => (c.playerId = started.addPlayer(`P${i}`, c).playerId));
    started.handle(players[0].playerId, { type: "startGame", config: exact({ werewolf: 1 }) });
    for (const c of players) started.disconnect(c); // in-game room now empty

    const now = Date.now();
    mgr.sweep(now, 15 * 60_000);
    expect(mgr.get(lobby.code)).toBeUndefined(); // empty lobby reclaimed now
    expect(mgr.get(started.code)).toBeDefined(); // in-game room within grace

    mgr.sweep(now + 16 * 60_000, 15 * 60_000);
    expect(mgr.get(started.code)).toBeUndefined(); // reclaimed after grace
  });
});

describe("redaction over the wire", () => {
  it("a villager never receives another player's role", () => {
    const { room, clients } = seatPlayers(4);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1, seer: 1 }) });
    // Find a villager's client.
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
});

/** Drive a room to a decisive finish, returning the final view of any client. */
describe("a full game", () => {
  it("plays night → day → vote → win with auto-advance", () => {
    const { room, clients } = seatPlayers(4);
    const byId = (id: string) => clients.find((c) => c.playerId === id)!;
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1 }) });

    // Host starts the night.
    const host = clients[0];
    room.handle(host.playerId, { type: "startNight" });
    expect(clients[0].view!.phase).toBe("night");

    // The wolf kills a villager.
    const wolf = clients.find((c) => c.view!.you.roleId === "werewolf")!;
    const wolfView = wolf.view!;
    const victimId = wolfView.nightPrompt!.targetIds[0];
    room.handle(wolf.playerId, { type: "nightChoice", targetId: victimId });

    // Night auto-resolves to day; the victim is dead.
    expect(host.view!.phase).toBe("dayDiscussion");
    expect(byId(victimId).view!.you.alive).toBe(false);

    // Vote out the wolf. The wolf can't vote itself, so it votes elsewhere.
    room.handle(host.playerId, { type: "startVote" });
    const livingClients = clients.filter((c) => c.view!.you.alive);
    const decoy = livingClients.find((c) => c.playerId !== wolf.playerId)!;
    for (const c of livingClients) {
      const target = c.playerId === wolf.playerId ? decoy.playerId : wolf.playerId;
      room.handle(c.playerId, { type: "castVote", targetId: target });
    }
    // With all votes in it auto-resolves.
    expect(host.view!.phase).toBe("gameOver");
    expect(host.view!.winner).toBe("village");
    // Everyone's role is revealed at the end.
    expect(host.view!.players.every((p) => p.roleId !== null)).toBe(true);
  });

  it("doctor protection is honored end-to-end", () => {
    const { room, clients } = seatPlayers(5);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1, doctor: 1 }) });
    room.handle(clients[0].playerId, { type: "startNight" });

    const wolf = clients.find((c) => c.view!.you.roleId === "werewolf")!;
    const doctor = clients.find((c) => c.view!.you.roleId === "doctor")!;
    const victimId = wolf.view!.nightPrompt!.targetIds[0];

    room.handle(doctor.playerId, { type: "nightChoice", targetId: victimId }); // save the target
    room.handle(wolf.playerId, { type: "nightChoice", targetId: victimId }); // attack same target

    expect(clients[0].view!.phase).toBe("dayDiscussion");
    const victim = clients.find((c) => c.playerId === victimId)!;
    expect(victim.view!.you.alive).toBe(true);
  });
});

describe("hunter over the room layer", () => {
  it("auto-advances into hunterShot and resolves the shot", () => {
    const { room, clients } = seatPlayers(5);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1, hunter: 1 }) });
    room.handle(clients[0].playerId, { type: "startNight" });

    const wolf = clients.find((c) => c.view!.you.roleId === "werewolf")!;
    const hunter = clients.find((c) => c.view!.you.roleId === "hunter")!;
    // Wolf eats the hunter; the room auto-resolves the night into hunterShot.
    room.handle(wolf.playerId, { type: "nightChoice", targetId: hunter.playerId });

    expect(clients[0].view!.phase).toBe("hunterShot");
    expect(hunter.view!.shootPrompt).not.toBeNull();

    // The fallen hunter takes a villager (not the wolf, so the game continues).
    const victim = hunter.view!.shootPrompt!.targetIds.find((id) => id !== wolf.playerId)!;
    room.handle(hunter.playerId, { type: "shoot", targetId: victim });
    expect(clients[0].view!.phase).toBe("dayDiscussion");
    expect(clients.find((c) => c.playerId === victim)!.view!.you.alive).toBe(false);
  });
});

describe("reconnect", () => {
  it("restores a player's private view with a valid token", () => {
    const room = mgr.create();
    const c1 = new FakeClient();
    const creds = room.addPlayer("Sam", c1);
    room.addPlayer("Kim", new FakeClient());
    room.addPlayer("Lee", new FakeClient());
    room.handle(creds.playerId, { type: "startGame", config: exact({ werewolf: 1 }) });
    const roleBefore = c1.view!.you.roleId;

    // New device reconnects as Sam.
    const c2 = new FakeClient();
    const ok = room.rejoin(creds.playerId, creds.token, c2);
    expect(ok).toBe(true);
    expect(c2.view!.you.roleId).toBe(roleBefore);

    // Wrong token is refused.
    expect(room.rejoin(creds.playerId, "nope", new FakeClient())).toBe(false);
  });
});

// Sanity: role registry stays consistent with the emoji/team the UI expects.
describe("role registry", () => {
  it("every role has a team and emoji", () => {
    for (const role of Object.values(ROLES)) {
      expect(role.emoji.length).toBeGreaterThan(0);
      expect(["village", "werewolf", "solo"]).toContain(role.team);
    }
  });
});

describe("rematch", () => {
  /** Seat a table, start a game, then jump straight to its end. */
  function finished(count: number) {
    const { room, clients } = seatPlayers(count);
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1 }) });
    room.state = { ...room.state, phase: "gameOver", winner: "village" };
    return { room, clients };
  }

  it("restarts in place, so nobody re-enters the code", () => {
    const { room, clients } = finished(4);
    const code = room.code;
    room.handle(clients[0].playerId, { type: "playAgain" });
    expect(room.code).toBe(code);
    for (const c of clients) {
      expect(c.view!.phase).toBe("lobby");
      expect(c.view!.code).toBe(code);
      expect(c.view!.players).toHaveLength(4);
      expect(c.view!.you.roleId).toBeNull();
      expect(c.view!.you.alive).toBe(true);
    }
  });

  it("only the host can call one", () => {
    const { room, clients } = finished(4);
    expect(() => room.handle(clients[1].playerId, { type: "playAgain" })).toThrow(/host/i);
  });

  it("drops anyone who left before it, and retires their token", () => {
    const { room, clients } = finished(4);
    const gone = clients[3];
    room.disconnect(gone);
    room.handle(clients[0].playerId, { type: "playAgain" });
    expect(room.state.players).toHaveLength(3);
    expect(room.rejoin(gone.playerId, gone.token, gone)).toBe(false);
  });

  it("still lets a mid-game dropout rejoin if they beat the rematch back", () => {
    const { room, clients } = finished(4);
    const away = clients[3];
    room.disconnect(away);
    expect(room.rejoin(away.playerId, away.token, away)).toBe(true);
    room.handle(clients[0].playerId, { type: "playAgain" });
    expect(room.state.players).toHaveLength(4);
  });
});

describe("recording finished games", () => {
  /** Seat a table on a manager that captures the records it files. */
  function recordingTable(count: number) {
    const records: GameRecord[] = [];
    const manager = new RoomManager((r) => records.push(r));
    const room = manager.create();
    const clients: FakeClient[] = [];
    for (let i = 0; i < count; i++) {
      const c = new FakeClient();
      const creds = room.addPlayer(`P${i}`, c);
      c.playerId = creds.playerId;
      c.token = creds.token;
      clients.push(c);
    }
    return { room, clients, records };
  }

  /** Play a 4-player game out to a village win: the wolf eats, then is lynched. */
  function playToVillageWin(room: Room, clients: FakeClient[]) {
    room.handle(clients[0].playerId, { type: "startGame", config: exact({ werewolf: 1 }) });
    room.handle(clients[0].playerId, { type: "startNight" });
    const wolf = clients.find((c) => c.view!.you.roleId === "werewolf")!;
    const victim = clients.find((c) => c !== wolf)!;
    room.handle(wolf.playerId, { type: "nightChoice", targetId: victim.playerId });

    room.handle(clients[0].playerId, { type: "startVote" });
    const villagers = clients.filter((c) => c !== wolf && c !== victim);
    room.handle(wolf.playerId, { type: "castVote", targetId: villagers[0].playerId });
    for (const v of villagers) room.handle(v.playerId, { type: "castVote", targetId: wolf.playerId });
    return { wolf, victim };
  }

  it("files exactly one anonymous record as the game ends", () => {
    const { room, clients, records } = recordingTable(4);
    playToVillageWin(room, clients);

    expect(room.state.phase).toBe("gameOver");
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ mode: "online", winner: "village", playerCount: 4 });
    expect(records[0].seats.filter((s) => s.dealt === "werewolf")).toHaveLength(1);
  });

  it("keeps players' names and ids out of what it files", () => {
    const { room, clients, records } = recordingTable(4);
    playToVillageWin(room, clients);
    const json = JSON.stringify(records[0]);
    for (const c of clients) expect(json).not.toContain(c.playerId);
    for (let i = 0; i < clients.length; i++) expect(json).not.toContain(`P${i}`);
    expect(json).not.toContain(room.code);
  });

  it("files a second record for a rematch, and none for the restart itself", () => {
    const { room, clients, records } = recordingTable(4);
    playToVillageWin(room, clients);
    room.handle(clients[0].playerId, { type: "playAgain" });
    expect(room.state.phase).toBe("lobby");
    expect(records).toHaveLength(1); // restarting is not a game

    playToVillageWin(room, clients);
    expect(records).toHaveLength(2);
  });
});
