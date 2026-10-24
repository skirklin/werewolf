import { describe, it, expect } from "vitest";
import { rolePool, werewolfRange } from "@party/werewolf";
import { tableConfig, describeTable } from "./table.js";

describe("the table", () => {
  it("defaults to the shipped pool", () => {
    const config = tableConfig({ peaceful: true }, 7);
    expect(config.selection).toMatchObject({ mode: "pool", overrides: {} });
    expect(werewolfRange(config.selection, 7).min).toBe(2);
  });

  it("says so when a table can only deal one deck", () => {
    // A pool of nothing but Villagers can't vary. (95 agent games were once
    // played before anyone noticed every one dealt the same roles.)
    expect(describeTable(tableConfig({ roles: "villager" }, 7), 7)).toContain("every game deals the same roles");
  });

  it("varies the specials once the pool outgrows the table", () => {
    const config = tableConfig(
      { roles: "villager,seer,doctor,hunter,witch,detective,tanner,drunk,troublemaker", peaceful: true },
      7
    );
    expect(describeTable(config, 7)).toContain("vary game to game");
  });

  it("takes a custom pool and balance", () => {
    const config = tableConfig({ roles: "villager, seer, hunter", balance: "wolves" }, 9);
    expect(rolePool(config.selection as Extract<typeof config.selection, { mode: "pool" }>, 9)).toEqual(["seer", "hunter"]);
    expect(config.selection).toMatchObject({ balance: "wolves" });
  });

  it("carries the first-night rule through", () => {
    expect(tableConfig({ peaceful: true }, 7).peacefulFirstNight).toBe(true);
    expect(tableConfig({}, 7).peacefulFirstNight).toBe(false);
  });

  it("refuses a bad table before a run spends anything", () => {
    expect(() => tableConfig({ roles: "villager,wizard" }, 7)).toThrow(/Unknown role/i);
    expect(() => tableConfig({ roles: "villager", balance: "maybe" }, 7)).toThrow(/balance/i);
  });
});
