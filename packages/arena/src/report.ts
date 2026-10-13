import { aggregate, type GameRecord, type Stats } from "@party/werewolf";

/**
 * Turn a run's records into something readable in a terminal. The numbers all
 * come from the same `aggregate` the website uses, so the arena and the house
 * numbers can never disagree about what a win rate means.
 */
export function report(records: readonly GameRecord[]): string {
  const stats = aggregate(records);
  if (stats.games === 0) return "No games completed.";

  const lines: string[] = [];
  lines.push(`${stats.games} games · ${round(stats.avgPlayers, 1)} players · ${round(stats.avgRounds, 1)} rounds avg`);
  lines.push("");

  lines.push("Who won");
  for (const team of stats.teams) {
    lines.push(`  ${pad(team.team, 12)} ${bar(team.rate)} ${pct(team.rate)}  (${team.wins})`);
  }

  if (stats.strategies.length) {
    lines.push("");
    lines.push("By strategy");
    lines.push(
      `  ${pad("strategy", 20)} ${padLeft("seats", 6)} ${padLeft("win", 6)} ${padLeft("village", 8)} ${padLeft("wolf", 6)} ${padLeft("survive", 8)} ${padLeft("said", 6)}`
    );
    for (const s of stats.strategies) {
      lines.push(
        `  ${pad(s.name, 20)} ${padLeft(String(s.seats), 6)} ${padLeft(pct(s.winRate), 6)} ` +
          `${padLeft(s.asVillage ? pct(s.villageWinRate) : "–", 8)} ` +
          `${padLeft(s.asWerewolf ? pct(s.werewolfWinRate) : "–", 6)} ` +
          `${padLeft(pct(s.survivalRate), 8)} ${padLeft(round(s.saidPerSeat, 1), 6)}`
      );
    }
    lines.push("  (village/wolf columns are win rates on each side; a strategy that never");
    lines.push("   drew that side shows –. Compare against the random control.)");
  }

  lines.push("");
  lines.push("By role");
  for (const role of stats.roles) {
    lines.push(
      `  ${pad(role.roleId, 14)} dealt ${padLeft(String(role.dealt), 4)}  won ${padLeft(pct(role.winRate), 5)}  survived ${padLeft(pct(role.survivalRate), 5)}`
    );
  }

  const days = stats.days.lynched + stats.days.tied;
  if (days) {
    lines.push("");
    lines.push(
      `Days: ${stats.days.lynched} ended in a lynch, ${stats.days.tied} in deadlock ` +
        `(${pct(stats.days.tied / days)} of days wasted)`
    );
    if (stats.days.lynched)
      lines.push(
        `Lynch accuracy: ${stats.days.wolvesLynched}/${stats.days.lynched} hit a wolf ` +
          `(${pct(stats.days.wolvesLynched / stats.days.lynched)}) — chance alone is about ` +
          `the wolf share of the table`
      );
  }

  const deaths = Object.entries(stats.deaths);
  if (deaths.length) {
    lines.push("");
    lines.push("How they went");
    for (const [cause, count] of deaths) lines.push(`  ${pad(cause, 22)} ${count}`);
  }
  return lines.join("\n");
}

/** A tiny sanity note: with this few games, treat the numbers as vibes. */
export function confidenceNote(stats: Stats): string {
  if (stats.games >= 100) return "";
  return `\nOnly ${stats.games} games — swings of ±${Math.round(
    100 / Math.sqrt(Math.max(stats.games, 1))
  )}pp are ordinary noise here. Run more before believing a difference.`;
}

const pct = (n: number) => `${Math.round(n * 100)}%`;
const round = (n: number, places: number) => (Math.round(n * 10 ** places) / 10 ** places).toString();
const pad = (s: string, n: number) => s.padEnd(n);
const padLeft = (s: string, n: number) => s.padStart(n);

function bar(rate: number, width = 20): string {
  const filled = Math.round(rate * width);
  return `[${"█".repeat(filled)}${"·".repeat(width - filled)}]`;
}
