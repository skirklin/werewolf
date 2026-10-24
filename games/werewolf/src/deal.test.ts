import { describe, it, expect } from "vitest";
import { makeRng } from "@party/core";
import { dealRoles, recommendedConfig, rolePool } from "./setup.js";
import { poolEligibleRoles } from "./roles.js";
import type { Balance, GameConfig, Player } from "./types.js";

/**
 * Reachability: every role the pool offers must actually turn up in deals, at
 * every table size and balance. A role can sit in the pool and still never be
 * dealt if no balanced deck can afford it, which no one would notice for days.
 */
const DEALS = 150;
const MIN_SHARE = 0.03; // dealt in at least 3% of games
/**
 * Roles known and accepted to be undealable, by balance and table size, as
 * "seer at 6". None at present; anything that goes missing fails the test.
 */
const UNREACHABLE: Partial<Record<Balance, string[]>> = {};

const seats = (n: number): Player[] =>
  Array.from({ length: n }, (_, i) => ({ id: `p${i}`, name: `P${i}`, roleId: null, alive: true, connected: true, isHost: false }));

const setup = (balance: Balance, overrides: Record<string, boolean> = {}): GameConfig => ({
  ...recommendedConfig(0),
  selection: { mode: "pool", overrides, balance },
});

/** The share of games, out of DEALS, in which each role is dealt. */
function shares(config: GameConfig, n: number): Record<string, number> {
  const seen: Record<string, number> = {};
  for (let seed = 1; seed <= DEALS; seed++)
    for (const id of new Set(dealRoles(seats(n), config, makeRng(seed * 7919)).map((p) => p.roleId!)))
      seen[id] = (seen[id] ?? 0) + 1 / DEALS;
  return seen;
}

describe("every role can be dealt", () => {
  for (const balance of ["wolves", "even", "village"] as const) {
    it(`${balance}: each role in the automatic pool turns up, at every table size`, () => {
      const missing: string[] = [];
      for (let n = 5; n <= 16; n++) {
        const config = setup(balance);
        const dealt = shares(config, n);
        for (const id of rolePool(config.selection as Extract<GameConfig["selection"], { mode: "pool" }>, n))
          if ((dealt[id] ?? 0) < MIN_SHARE) missing.push(`${id} at ${n}`);
      }
      expect(missing).toEqual(UNREACHABLE[balance] ?? []);
    });
  }

  it("each role switched on by the host turns up at a 7-player table", () => {
    const missing = poolEligibleRoles()
      .filter((role) => (shares(setup("even", { [role.id]: true }), 7)[role.id] ?? 0) < MIN_SHARE)
      .map((role) => role.id);
    expect(missing).toEqual([]);
  });
});
