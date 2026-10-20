import { describe, it, expect } from "vitest";
import type { GameState, Player, GameConfig } from "./types.js";
import { createGame, reduce } from "./engine.js";
import { passDeviceTurn, nightAckKey, type Turn } from "./passdevice.js";

const exact = (roleCounts: Record<string, number>): GameConfig => ({
  selection: { mode: "exact", roleCounts },
  revealRoleOnDeath: true,
  nightSummary: "discreet", peacefulFirstNight: false,
});

/** A game dealt with explicit roles, advanced to the first night. */
function nightGame(roles: string[]): GameState {
  const players: Player[] = roles.map((roleId, i) => ({
    id: `p${i}`, name: `P${i}`, roleId, alive: true, connected: true, isHost: i === 0,
  }));
  const base: GameState = { ...createGame("T", 1), phase: "roleReveal", players, config: exact({}) };
  return reduce(base, { type: "startNight" });
}

function seatIds(turn: Turn): string {
  return "seatId" in turn ? turn.seatId : `(${turn.kind})`;
}

describe("passDeviceTurn", () => {
  const empty = new Set<string>();

  it("prompts every living player at night — actors act, others pass", () => {
    // p0 wolf, p1 seer, p2 doctor, p3 villager, p4 villager
    const s = nightGame(["werewolf", "seer", "doctor", "villager", "villager"]);
    const acks = new Set<string>();
    const kinds: string[] = [];
    // Walk the whole night in seat order, acking each seat as we go.
    for (let guard = 0; guard < 20; guard++) {
      const turn = passDeviceTurn(s, empty, acks);
      if (turn.kind === "public") break;
      kinds.push(`${seatIds(turn)}:${turn.kind}`);
      acks.add(nightAckKey(s.round, seatIds(turn)));
    }
    expect(kinds).toEqual([
      "p0:night", // wolf
      "p1:night", // seer
      "p2:night", // doctor
      "p3:nightPass", // villager
      "p4:nightPass", // villager
    ]);
    // Everyone acked -> public (night ready to resolve).
    expect(passDeviceTurn(s, empty, acks).kind).toBe("public");
  });

  it("skips dead players at night", () => {
    let s = nightGame(["werewolf", "seer", "villager", "villager"]);
    // Kill p2 by hand to simulate a prior death.
    s = { ...s, players: s.players.map((p) => (p.id === "p2" ? { ...p, alive: false } : p)) };
    const acks = new Set<string>();
    const seats: string[] = [];
    for (let g = 0; g < 20; g++) {
      const turn = passDeviceTurn(s, empty, acks);
      if (turn.kind === "public") break;
      seats.push(seatIds(turn));
      acks.add(nightAckKey(s.round, seatIds(turn)));
    }
    expect(seats).not.toContain("p2"); // dead player never prompted
  });

  it("an actor who has already chosen is not prompted to act again", () => {
    const s = nightGame(["werewolf", "villager", "villager"]);
    // Record the wolf's choice directly in the night step.
    const withChoice: GameState = {
      ...s,
      night: {
        acked: [],
        idleDone: [],
        steps: s.night!.steps.map((st) =>
          st.kind === "kill"
            ? { ...st, subs: { p0: { t: "target", target: "p1" } }, done: true }
            : st
        ),
      },
    };
    // p0 not yet acked but has chosen -> gets a pass screen, not another action.
    expect(passDeviceTurn(withChoice, empty, new Set()).kind).toBe("nightPass");
  });

  it("during the day vote, prompts each living player who hasn't voted", () => {
    let s = nightGame(["werewolf", "villager", "villager", "villager"]);
    // Fast-forward: wolf kills p1, resolve to day, start vote.
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" });
    s = reduce(s, { type: "startVote" });
    const first = passDeviceTurn(s, empty, empty);
    expect(first.kind).toBe("vote");
    // After p0 votes, the next living non-voter is prompted.
    const voted = reduce(s, { type: "castVote", voterId: (first as any).seatId, targetId: "p2" });
    const second = passDeviceTurn(voted, empty, empty);
    expect(second.kind).toBe("vote");
    expect((second as any).seatId).not.toBe((first as any).seatId);
  });

  it("is public during discussion, and when there is no game", () => {
    let s = nightGame(["werewolf", "villager", "villager"]);
    s = reduce(s, { type: "nightChoice", actorId: "p0", targetId: "p1" });
    s = reduce(s, { type: "endNight" }); // -> dayDiscussion
    expect(passDeviceTurn(s, empty, empty).kind).toBe("public");
    expect(passDeviceTurn(null, empty, empty).kind).toBe("public");
  });
});
