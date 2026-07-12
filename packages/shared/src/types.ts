/** Core domain types for the Werewolf game engine. */

export type PlayerId = string;

export type Team = "village" | "werewolf" | "solo";

/**
 * The kind of night action a role performs. The engine has explicit
 * resolution logic for each kind, so adding a role that reuses an existing
 * kind is data-only; a genuinely new mechanic is the one place you touch
 * engine code (see resolveNight).
 */
export type NightActionKind = "kill" | "protect" | "inspect";

export interface NightAbility {
  kind: NightActionKind;
  /** Presentation/resolution order. Lower goes first. */
  order: number;
  /** Members act together and know each other (werewolves). */
  group?: boolean;
  /** May the actor target themselves? */
  canTargetSelf?: boolean;
  /**
   * For `inspect` roles: how much the vision reveals.
   *  - "exactRole": the target's precise role (classic Seer).
   *  - "isWerewolf": only werewolf-or-not (Aura Seer).
   *  - "fabricated": a fake, meaningless result (the deluded Drunk).
   */
  reveal?: "exactRole" | "isWerewolf" | "fabricated";
}

export interface RoleDef {
  id: string;
  name: string;
  team: Team;
  /** One-line description shown on the role-reveal screen. */
  blurb: string;
  /** Emoji used as the role's avatar in the UI. */
  emoji: string;
  night?: NightAbility;
  /** On death (night or lynch), this player takes someone down with them. */
  onDeathShoot?: boolean;
  /** A solo role that wins immediately if the town lynches them (Tanner). */
  winsIfLynched?: boolean;
  /** Shown to this player as a different role — they never learn the truth (Drunk). */
  disguiseAs?: string;
}

export type Phase =
  | "lobby"
  | "roleReveal"
  | "night"
  | "hunterShot"
  | "dayDiscussion"
  | "dayVote"
  | "gameOver";

export interface Player {
  id: PlayerId;
  name: string;
  /** Null until roles are dealt. */
  roleId: string | null;
  alive: boolean;
  /** True while a device is connected as this player (multi-device). */
  connected: boolean;
  /** True for the player who controls the room (starts game, advances phases). */
  isHost: boolean;
}

/**
 * How roles are chosen for a game. Two modes:
 *  - exact: enumerate how many of each special role; villagers fill the rest
 *    so the deck always matches the player count.
 *  - pool: list the roles you're willing to include (the pool may hold more
 *    roles than players). The werewolf count is derived from a team ratio so
 *    it always scales with the table — never "1 wolf for 7 players".
 */
export type RoleSelection =
  | { mode: "exact"; roleCounts: Record<string, number> }
  | { mode: "pool"; pool: string[]; werewolfRatio: number };

export interface GameConfig {
  selection: RoleSelection;
  /** Reveal a lynched/killed player's role to everyone. */
  revealRoleOnDeath: boolean;
  /**
   * How much the public night recap gives away.
   *  - "discreet" (default): a protected kill is reported as a quiet night, so
   *    it never reveals that a doctor exists or clears the saved player.
   *  - "detailed": announces who the wolves struck and that they were saved.
   */
  nightSummary: "discreet" | "detailed";
}

/** One night-action slot: a role acting on a given night. */
export interface NightStep {
  roleId: string;
  kind: NightActionKind;
  order: number;
  group: boolean;
  /** Living players who take this step. */
  actorIds: PlayerId[];
  /** actorId -> chosen target. Group steps resolve by plurality. */
  choices: Record<PlayerId, PlayerId>;
  /** Set once all actors have chosen. */
  done: boolean;
}

export interface InspectResult {
  round: number;
  seerId: PlayerId;
  targetId: PlayerId;
  /** Exact roleId, or "werewolf"/"not-werewolf" depending on config. */
  reveal: string;
}

export interface NightState {
  steps: NightStep[];
}

export type LogEntry =
  | { type: "gameStart"; round: number }
  | { type: "night"; round: number }
  | { type: "death"; round: number; playerId: PlayerId; cause: "wolves" }
  | { type: "saved"; round: number; playerId: PlayerId }
  | { type: "noDeath"; round: number; cause: "wolves" | "lynch" }
  | { type: "lynch"; round: number; playerId: PlayerId }
  | { type: "hunterShot"; round: number; playerId: PlayerId }
  | { type: "voteTie"; round: number }
  | { type: "gameOver"; round: number; winner: Team };

export interface GameState {
  phase: Phase;
  code: string;
  players: Player[];
  config: GameConfig;
  round: number;
  night: NightState | null;
  /** Every seer inspection made this game (each seer sees only their own). */
  inspects: InspectResult[];
  /** voterId -> targetId, or null for an explicit skip. */
  votes: Record<PlayerId, PlayerId | null>;
  /** Hunters who have died and owe a dying shot, resolved front-first. */
  pendingShots: PlayerId[];
  /** Where to continue once all pending shots resolve. */
  afterReckoning: "day" | "night" | null;
  log: LogEntry[];
  seed: number;
  winner: Team | null;
  /** The specific player who won a solo victory (e.g. a lynched Tanner). */
  soloWinnerId: PlayerId | null;
}
