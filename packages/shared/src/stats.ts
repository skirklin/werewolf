import type { Team } from "./types.js";
import { ROLES } from "./roles.js";
import type { GameMode, GameRecord } from "./record.js";

/**
 * Aggregates over the anonymous game records. Pure, so the server can serve
 * them and tests can check them without any storage in the picture.
 */

export interface TeamStats {
  team: Team;
  wins: number;
  /** Share of all recorded games, 0–1. */
  rate: number;
}

export interface RoleStats {
  roleId: string;
  /** Seats dealt this role, across all games. */
  dealt: number;
  /** Games in which the role was dealt to at least one seat. */
  games: number;
  /** Seats dealt this role whose side went on to win. */
  wins: number;
  /** Seats dealt this role that were still alive at the end. */
  survived: number;
  winRate: number;
  survivalRate: number;
}

/** How one strategy fared, across every seat it played. */
export interface StrategyStats {
  name: string;
  /** Seats this strategy played. */
  seats: number;
  wins: number;
  survived: number;
  winRate: number;
  survivalRate: number;
  /** Seats played on each side, so a lopsided draw is visible. */
  asVillage: number;
  asWerewolf: number;
  /** Win rate on each side — where strategies actually differ. */
  villageWinRate: number;
  werewolfWinRate: number;
  /** Messages spoken per seat. */
  saidPerSeat: number;
}

export interface Stats {
  games: number;
  byMode: Record<GameMode, number>;
  teams: TeamStats[];
  roles: RoleStats[];
  /** Only populated for arena games, where seats carry a strategy label. */
  strategies: StrategyStats[];
  /** Games by table size, e.g. `{ "6": 12 }`. */
  byPlayerCount: Record<string, number>;
  avgPlayers: number;
  avgRounds: number;
  /** How players left the game: eaten, lynched, shot, poisoned. */
  deaths: Record<string, number>;
  /** Nights a doctor/witch save actually cancelled a kill. */
  saves: number;
  /** Dead players dragged back by a Medium. */
  raises: number;
  /** How many games ran with each optional house rule switched on. */
  options: {
    peacefulFirstNight: number;
    revealRoleOnDeath: number;
    detailedSummary: number;
  };
}

const TEAMS: Team[] = ["village", "werewolf", "solo"];

/** Which log entry types count as someone dying, and what to call each cause. */
const DEATH_EVENTS: Record<string, string> = {
  death: "eaten by wolves",
  lynch: "voted out",
  hunterShot: "hunter's dying shot",
  poisoned: "poisoned",
};

/** A blank per-strategy tally, so every counter starts defined. */
function newStrategy() {
  return {
    seats: 0,
    wins: 0,
    survived: 0,
    asVillage: 0,
    asWerewolf: 0,
    villageWins: 0,
    werewolfWins: 0,
    said: 0,
  };
}

export function aggregate(records: readonly GameRecord[]): Stats {
  const byMode: Record<GameMode, number> = { online: 0, local: 0, agent: 0 };
  const strategies = new Map<string, ReturnType<typeof newStrategy>>();
  const teamWins = new Map<Team, number>(TEAMS.map((t) => [t, 0]));
  const byPlayerCount: Record<string, number> = {};
  const deaths: Record<string, number> = {};
  const roles = new Map<string, { dealt: number; games: number; wins: number; survived: number }>();
  const options = { peacefulFirstNight: 0, revealRoleOnDeath: 0, detailedSummary: 0 };
  let players = 0;
  let rounds = 0;
  let saves = 0;
  let raises = 0;

  for (const rec of records) {
    byMode[rec.mode]++;
    teamWins.set(rec.winner, (teamWins.get(rec.winner) ?? 0) + 1);
    byPlayerCount[rec.playerCount] = (byPlayerCount[rec.playerCount] ?? 0) + 1;
    players += rec.playerCount;
    rounds += rec.rounds;
    if (rec.config.peacefulFirstNight) options.peacefulFirstNight++;
    if (rec.config.revealRoleOnDeath) options.revealRoleOnDeath++;
    if (rec.config.nightSummary === "detailed") options.detailedSummary++;

    // A role is credited for the seat it was DEALT to, even if a Troublemaker
    // swapped that seat into something else before the end.
    const seenThisGame = new Set<string>();
    for (const seat of rec.seats) {
      const entry = roles.get(seat.dealt) ?? { dealt: 0, games: 0, wins: 0, survived: 0 };
      entry.dealt++;
      if (seat.won) entry.wins++;
      if (seat.survived) entry.survived++;
      if (!seenThisGame.has(seat.dealt)) {
        entry.games++;
        seenThisGame.add(seat.dealt);
      }
      roles.set(seat.dealt, entry);

      if (!seat.agent) continue;
      const strat = strategies.get(seat.agent) ?? newStrategy();
      strat.seats++;
      strat.said += seat.said;
      if (seat.won) strat.wins++;
      if (seat.survived) strat.survived++;
      // Sides are judged by the role actually held at the end, which is the
      // side the seat was playing for when the game was scored.
      const wolfSide = ROLES[seat.final]?.team === "werewolf";
      if (wolfSide) {
        strat.asWerewolf++;
        if (seat.won) strat.werewolfWins++;
      } else {
        strat.asVillage++;
        if (seat.won) strat.villageWins++;
      }
      strategies.set(seat.agent, strat);
    }

    for (const event of rec.events) {
      const cause = DEATH_EVENTS[event.type];
      if (cause) deaths[cause] = (deaths[cause] ?? 0) + 1;
      if (event.type === "saved") saves++;
      if (event.type === "raised") raises++;
    }
  }

  const games = records.length;
  return {
    games,
    byMode,
    teams: TEAMS.map((team) => {
      const wins = teamWins.get(team) ?? 0;
      return { team, wins, rate: ratio(wins, games) };
    }),
    roles: [...roles.entries()]
      .map(([roleId, r]) => ({
        roleId,
        ...r,
        winRate: ratio(r.wins, r.dealt),
        survivalRate: ratio(r.survived, r.dealt),
      }))
      .sort((a, b) => b.dealt - a.dealt || a.roleId.localeCompare(b.roleId)),
    strategies: [...strategies.entries()]
      .map(([name, s]) => ({
        name,
        seats: s.seats,
        wins: s.wins,
        survived: s.survived,
        winRate: ratio(s.wins, s.seats),
        survivalRate: ratio(s.survived, s.seats),
        asVillage: s.asVillage,
        asWerewolf: s.asWerewolf,
        villageWinRate: ratio(s.villageWins, s.asVillage),
        werewolfWinRate: ratio(s.werewolfWins, s.asWerewolf),
        saidPerSeat: ratio(s.said, s.seats),
      }))
      .sort((a, b) => b.winRate - a.winRate || a.name.localeCompare(b.name)),
    byPlayerCount,
    avgPlayers: ratio(players, games),
    avgRounds: ratio(rounds, games),
    deaths,
    saves,
    raises,
    options,
  };
}

function ratio(part: number, whole: number): number {
  return whole === 0 ? 0 : part / whole;
}
