/** Core domain types for the Werewolf game engine. */

export type PlayerId = string;

export type Team = "village" | "werewolf" | "solo";

/**
 * The kind of night action a role performs. The engine has explicit
 * resolution logic for each kind, so adding a role that reuses an existing
 * kind is data-only; a genuinely new mechanic is the one place you touch
 * engine code (see endNight).
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
  | "convert"
  | "mark" // the Hunter: who goes down with them if they die before the next night
  | "block"; // the Poisoner: whose power fails the following night

/**
 * What a single actor submitted for their night step. Most roles pick one
 * target; the Witch, Troublemaker and Detective submit richer shapes.
 */
export type NightSubmission =
  | { t: "target"; target: PlayerId } // every one-pick kind
  | { t: "witch"; heal: boolean; poison: PlayerId | null }
  | { t: "skip" } // an optional power held back for another night (Troublemaker, Infector)
  | { t: "swap"; a: PlayerId; b: PlayerId }
  | { t: "detect"; a: PlayerId; b: PlayerId }
  | { t: "raise"; target: PlayerId | null }; // Medium: a dead player, or skip

export interface NightAbility {
  kind: NightActionKind;
  /** Presentation/resolution order. Lower goes first. */
  order: number;
  /** A one-time power: once spent (GameState.used), the role sleeps through the night. */
  once?: boolean;
  /** Can't pick the same player two nights running (the Doctor, the Gossip, the Poisoner). */
  noRepeat?: boolean;
  /** May be held for a later night ("Not tonight"). */
  optional?: boolean;
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
  /**
   * Balance points: how much this role helps the village (positive) or the
   * wolves (negative), on the Ultimate Werewolf scale where a Villager is +1
   * and a Werewolf −6. The dealer aims a deck's total at the chosen balance.
   */
  weight: number;
  /** One-line description shown on the role-reveal screen. */
  blurb: string;
  /** Emoji used as the role's avatar in the UI. */
  emoji: string;
  night?: NightAbility;
  /**
   * The table size from which this role is in the pool by default (the host
   * can still force it on or off). Some roles swing a small game too hard: an
   * Infector's bite at 7 players can end it overnight.
   */
  autoFrom: number;
  /** On death (night or vote), this player takes someone down with them. */
  onDeathShoot?: boolean;
  /** The first time the town votes this player out, they're revealed and spared (Prince). */
  sparedOnFirstVote?: boolean;
  /** Bitten by the wolves, this player turns into a Werewolf instead of dying (the Cursed). */
  turnsWhenBitten?: boolean;
  /** Becomes this role once nobody alive holds it (the Apprentice Seer takes over as Seer). */
  succeeds?: string;
  /**
   * At a tie with the wolves, whether this living player could still break it
   * (the Witch's unused poison, a Gossip's silence...). While anyone can, the
   * game plays on.
   */
  canBreakTie?: (state: GameState, playerId: PlayerId) => boolean;
  /** Wins alongside whoever wins, as long as they're alive at the end (Poisoner). */
  winsBySurviving?: boolean;
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
  | "dayDiscussion"
  | "dayVote"
  | "announce" // what just happened (dawn, or a vote's result), before play moves on
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
 *  - pool: the roles that may be dealt — each role on by default once the
 *    table reaches its size (RoleDef.autoFrom), unless the host forces it on
 *    or off. The dealer picks the wolf count (from a band that scales with
 *    the table) and the specials together, by balance points.
 */
export type RoleSelection =
  | { mode: "exact"; roleCounts: Record<string, number> }
  | {
      mode: "pool";
      /** The host's picks: true = always in the pool, false = never. Unlisted roles are automatic. */
      overrides: Record<string, boolean>;
      /**
       * Which side the deal should favor; the dealer picks wolves and specials
       * so the deck's balance points land near this target. Absent means "even".
       */
      balance?: Balance;
    };

/** Which side a pool deal leans toward. */
export type Balance = "wolves" | "even" | "village";

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
  /**
   * The in-app town square. Off suits a table playing in person, where people
   * just talk out loud. Absent means on.
   */
  chat?: boolean;
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
  /**
   * Actors who have dismissed their private night result (Seer, Detective…).
   * The night waits for them, so a result never vanishes before it's read.
   */
  acked: PlayerId[];
  /**
   * Living players with no power tonight who have tapped through their decoy
   * prompt. Everyone gets something to tap at night, and the night waits for
   * all of it, so a phone being busy never marks its owner as a power role.
   */
  idleDone: PlayerId[];
}

/** One public thing that happened, as read out on an announcement. */
export type AnnouncementEvent =
  | { t: "killed"; playerId: PlayerId } // by the wolves
  | { t: "poisoned"; playerId: PlayerId }
  | { t: "saved"; playerId: PlayerId } // only shown when the setup announces saves
  | { t: "quiet" } // the wolves took nobody
  | { t: "raised"; playerId: PlayerId }
  | { t: "votedOut"; playerId: PlayerId }
  | { t: "tie" }
  | { t: "noVotes" }
  | { t: "shot"; shooterId: PlayerId; playerId: PlayerId } // a dying Hunter's shot
  | { t: "spared"; playerId: PlayerId; roleId: string } // voted out, but revealed and spared (Prince)
  | { t: "died"; playerId: PlayerId }; // died in the night of no attack (the Infector, passing on the curse)

/**
 * What just happened, shown to everyone before play moves on: the dawn after
 * a night, or the result of a day's vote. The outcome is already applied; the
 * host continues to `next`.
 */
export interface Announcement {
  kind: "dawn" | "vote";
  round: number;
  events: AnnouncementEvent[];
  next: "day" | "night" | "gameOver";
  /** Who has won, when this ends the game. */
  winner: Team | null;
  soloWinnerId: PlayerId | null;
}

/**
 * Something that changed for one player overnight, told to them alone at
 * dawn. Everyone else gets "nothing changed for you", so a longer screen
 * gives nobody away.
 */
export interface Notice {
  /** Your role changed (a swap, or an infection): what you are now. */
  roleId?: string;
  infected?: boolean;
  raised?: boolean;
  /** Your pack changed (someone joined or left it). */
  packChanged?: boolean;
  /** You've taken over a role whose last holder is gone (Apprentice Seer → Seer). */
  promoted?: boolean;
}

/** How each voter voted in one day's ballot (null = abstained). Public. */
export interface VoteRecord {
  round: number;
  votes: Record<PlayerId, PlayerId | null>;
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
  | { type: "spared"; round: number; playerId: PlayerId }
  | { type: "died"; round: number; playerId: PlayerId }
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
  /** Players getting the cold shoulder today: no talking, no vote (set by the Gossip). */
  silenced: PlayerId[];
  /** What's being announced (phase "announce"), else null. */
  announcement: Announcement | null;
  /** Private dawn notices, per player: kept through the day, cleared at nightfall. */
  notices: Record<PlayerId, Notice>;
  /** Per-Hunter: who they'll take down with them if they die (chosen each night). */
  hunterMark: Record<PlayerId, PlayerId>;
  /**
   * Players who've read their role card and said so (phase "roleReveal"). The
   * night falls once everyone has.
   */
  ready: PlayerId[];
  /** How many times the host has redealt this game (see redeal). */
  redeals: number;
  /**
   * Players whose power fails tonight (picked by the Poisoner last night).
   * They still act — nothing happens, and info comes back fake — so they
   * never find out.
   */
  drugged: PlayerId[];
  /**
   * Per-player: their one-time power is spent (the Medium's raise, the
   * Troublemaker's swap, the Infector's bite, the Prince's reprieve). Travels
   * with the role on a swap.
   */
  used: Record<PlayerId, boolean>;
  /** Per-Drunk: the role they've been dealt to secretly impersonate. */
  drunkDisguise: Record<PlayerId, string>;
  /**
   * Per-Drunk posing as a Werewolf: the pack they imagine, picked at random
   * from the table (so it says nothing about the real one, which never sees
   * them). Travels with the role on a swap.
   */
  drunkPack: Record<PlayerId, PlayerId[]>;
  /**
   * Per-actor: who they picked last night, for powers that can't pick the same
   * player two nights running (the Doctor's shield, the Gossip's rumor).
   */
  lastTarget: Record<PlayerId, PlayerId>;
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
  /**
   * Today's voting order: everyone eligible, one at a time, starting from a
   * seat that moves round the table each day. Later voters see earlier votes.
   */
  voteOrder: PlayerId[];
  /** Every resolved day ballot, oldest first. Votes are open, not secret. */
  voteHistory: VoteRecord[];
  /** Per-Witch remaining potions (heal/poison), each usable once all game. */
  witchPotions: Record<PlayerId, { heal: boolean; poison: boolean }>;
  log: LogEntry[];
  seed: number;
  winner: Team | null;
  /** The specific player who won a solo victory (e.g. a lynched Tanner). */
  soloWinnerId: PlayerId | null;
}
