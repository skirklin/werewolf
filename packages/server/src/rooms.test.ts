import { describe, it, expect, beforeEach } from "vitest";
import { ROLES, type ServerMessage, type PlayerView, type GameConfig } from "@werewolf/shared";
import { RoomManager, type Client } from "./rooms.js";

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
  nightSummary: "discreet",
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
    c.playerId = room.addPlayer(`P${i}`, c).playerId;
    // capture token from the joined message the room does NOT send (server does);
    // the room returns creds directly:
    clients.push(c);
  }
  return { room, clients };
}

describe("lobby", () => {
  it("first player is host, code is 4 chars", () => {
    const { room, clients } = seatPlayers(3);
    expect(room.code).toHaveLength(4);
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

    // Vote out the wolf.
    room.handle(host.playerId, { type: "startVote" });
    const livingClients = clients.filter((c) => c.view!.you.alive);
    for (const c of livingClients) {
      room.handle(c.playerId, { type: "castVote", targetId: wolf.playerId });
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
