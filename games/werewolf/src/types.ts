/** Core domain types for the Werewolf game engine. */

export type PlayerId = string;

export type Team = "village" | "werewolf" | "solo";

/**
 * The kind of night action a role performs. The engine has explicit
 * resolution logic for each kind, so adding a role that reuses an existing
 * kind is data-only; a genuinely new mechanic is the one place you touch
 * engine code (see resolveNight).
 */
export type NightActionKind =
  | "kill"
  | "protect"
  | "inspect"
  | "witch"
  | "swap"
  | "silence"
  | "detect"
  | "raise"
  | "convert";

/**
 * What a single actor submitted for their night step. Most roles pick one
 * target; the Witch, Troublemaker and Detective submit richer shapes.
 */
export type NightSubmission =
  | { t: "target"; target: PlayerId } // kill / protect / inspect / silence
  | { t: "witch"; save: boolean; poison: PlayerId | null }
  | { t: "swap"; a: PlayerId; b: PlayerId }
  | { t: "detect"; a: PlayerId; b: PlayerId }
  | { t: "raise"; target: PlayerId | null }; // Medium: a dead player, or skip

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
   */
  reveal?: "exactRole" | "isWerewolf";
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
  /** On death (night or vote), this player takes someone down with them. */
  onDeathShoot?: boolean;
  /** A solo role that wins immediately if the town votes to eliminate them (Tanner). */
  winsIfLynched?: boolean;
  /** This role can be secretly impersonated by the Drunk (its power does nothing). */
  drunkMimicable?: boolean;
  /**
   * Whether this role counts as a werewolf for win math (parity / village win)
   * and the Aura Seer's read. Defaults to `team === "werewolf"`. A Henchman is
   * on the werewolf team (wins with them, knows them) but sets this false — the
   * village still wins once the real wolves are gone.
   */
  countsAsWolf?: boolean;
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
  /**
   * Skip the wolves' hunt on night 1, so nobody dies before the town has said
   * a word. The pack still learns who they are on the role card.
   */
  peacefulFirstNight: boolean;
}

/** One night-action slot: a role acting on a given night. */
export interface NightStep {
  roleId: string;
  kind: NightActionKind;
  order: number;
  group: boolean;
  /** Living players who take this step. */
  actorIds: PlayerId[];
  /** actorId -> their submission. Group steps (wolves) resolve by plurality. */
  subs: Record<PlayerId, NightSubmission>;
  /** Set once all actors have submitted. */
  done: boolean;
}

export interface InspectResult {
  round: number;
  seerId: PlayerId;
  targetId: PlayerId;
  /** Exact roleId, or "werewolf"/"not-werewolf" depending on config. */
  reveal: string;
}

/** A Detective reading: whether two players share a team. */
export interface DetectionResult {
  round: number;
  detectiveId: PlayerId;
  aId: PlayerId;
  bId: PlayerId;
  sameTeam: boolean;
}

export interface NightState {
  steps: NightStep[];
}

/** One thing somebody said during a day. Public: the whole town hears it. */
export interface ChatMessage {
  round: number;
  playerId: PlayerId;
  text: string;
}

export type LogEntry =
  | { type: "gameStart"; round: number }
  | { type: "night"; round: number }
  | { type: "death"; round: number; playerId: PlayerId; cause: "wolves" }
  | { type: "saved"; round: number; playerId: PlayerId }
  | { type: "noDeath"; round: number; cause: "wolves" | "lynch" }
  | { type: "lynch"; round: number; playerId: PlayerId }
  | { type: "hunterShot"; round: number; playerId: PlayerId }
  | { type: "poisoned"; round: number; playerId: PlayerId }
  | { type: "raised"; round: number; playerId: PlayerId }
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
  /** Every detective reading (each detective sees only their own). */
  detections: DetectionResult[];
  /** Players who may not vote in the upcoming day (set by the Silencer). */
  silenced: PlayerId[];
  /** Per-Medium: whether their one-time raise has been spent. */
  mediumUsed: Record<PlayerId, boolean>;
  /** Per-Infector: whether their one-time conversion has been spent. */
  convertUsed: Record<PlayerId, boolean>;
  /** Per-Drunk: the role they've been dealt to secretly impersonate. */
  drunkDisguise: Record<PlayerId, string>;
  /** Per-protector: who they shielded last night (can't be shielded again). */
  lastProtect: Record<PlayerId, PlayerId>;
  /**
   * The role dealt to each seat at game start, by index into `players`. Roles
   * move around mid-game (swaps, conversions), so this is the only surviving
   * record of the original deal — used for post-game stats.
   */
  dealtRoles: string[];
  /** Everything said out loud this game, oldest first. */
  chat: ChatMessage[];
  /** voterId -> targetId, or null for an explicit skip. */
  votes: Record<PlayerId, PlayerId | null>;
  /** Per-Witch remaining potions (heal/poison), each usable once all game. */
  witchPotions: Record<PlayerId, { heal: boolean; poison: boolean }>;
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
