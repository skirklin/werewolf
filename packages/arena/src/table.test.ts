import { describe, it, expect } from "vitest";
import { previewComposition } from "@party/werewolf";
import { tableConfig, describeTable } from "./table.js";

describe("the table", () => {
  it("defaults to the classic pool, which at seven seats is one fixed deck", () => {
    const config = tableConfig({ peaceful: true }, 7);
    expect(config.selection).toMatchObject({ mode: "pool", pool: ["villager", "seer", "doctor"] });
    const comp = previewComposition(config, 7);
    expect(comp).toEqual({ werewolves: 2, villageSpecials: 2, villagers: 3 });
    // Worth saying out loud: this pool cannot vary, and 95 agent games were
    // played before anyone noticed every one dealt the same roles.
    expect(describeTable(config, 7)).toContain("every game deals the same roles");
  });

  it("varies the specials once the pool outgrows the table", () => {
    const config = tableConfig(
      { roles: "villager,seer,doctor,hunter,witch,detective,tanner,drunk,troublemaker", peaceful: true },
      7
    );
    expect(describeTable(config, 7)).toContain("vary game to game");
  });

  it("takes a custom pool and ratio", () => {
    const config = tableConfig({ roles: "villager, seer, hunter", ratio: "0.34" }, 9);
    expect(config.selection).toMatchObject({
      mode: "pool",
      pool: ["villager", "seer", "hunter"],
      werewolfRatio: 0.34,
    });
    expect(previewComposition(config, 9).werewolves).toBe(3);
  });

  it("carries the first-night rule through", () => {
    expect(tableConfig({ peaceful: true }, 7).peacefulFirstNight).toBe(true);
    expect(tableConfig({}, 7).peacefulFirstNight).toBe(false);
  });

  it("refuses a bad table before a run spends anything", () => {
    expect(() => tableConfig({ roles: "villager,wizard" }, 7)).toThrow(/Unknown role/i);
    expect(() => tableConfig({ roles: "villager", ratio: "0" }, 7)).toThrow(/ratio/i);
    // A pool with no village side is unplayable, and validateConfig says so.
    expect(() => tableConfig({ roles: "tanner" }, 7)).toThrow(/Unplayable table/);
  });
});
