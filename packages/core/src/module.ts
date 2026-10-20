/**
 * The contract between the platform and a game.
 *
 * The platform owns everything about a room that isn't the game: the roster,
 * who's host, who's connected, reconnection, the lobby, and dealing another
 * game afterwards. A game only has to say how to start, how a move changes the
 * state, and what each seat is allowed to see. Each of those is a pure
 * function, so the same module can run on the server for multi-device play
 * and in a browser or a test without one.
 */

export interface Seat {
  id: string;
  name: string;
}

export interface RosterEntry extends Seat {
  isHost: boolean;
  connected: boolean;
}

export interface StartContext {
  /** Fresh for every game, so a rematch deals something new. */
  seed: number;
  /** The room's code, for games that show it. */
  code: string;
}

export interface ActContext {
  /** Whether the acting seat is the room's host (for host-only moves). */
  isHost: boolean;
}

export interface GameModule<Config = unknown, State = unknown, View = unknown> {
  /** Stable id, used on the wire and in URLs. */
  id: string;
  name: string;
  minPlayers: number;
  maxPlayers: number;
  /**
   * Check a config that arrived from a client, for this many players. Return
   * it typed, or throw a GameError saying what's wrong.
   */
  parseConfig(raw: unknown, players: number): Config;
  /** Deal a game for these seats, in this order. */
  start(seats: readonly RosterEntry[], config: Config, ctx: StartContext): State;
  /**
   * Apply one seat's move. `action` came off the wire, so a module must not
   * trust its shape; throw a GameError for anything illegal.
   */
  act(state: State, seatId: string, action: unknown, ctx: ActContext): State;
  /** Everything one seat may see, and nothing it may not. */
  view(state: State, seatId: string): View;
  isOver(state: State): boolean;
  /** Told when presence or the host changes mid-game, for games that show it. */
  roster?(state: State, roster: readonly RosterEntry[]): State;
  /** An anonymous record of a finished game, for games that keep stats. */
  record?(state: State): unknown;
  /**
   * The shape of this game's state, for rooms saved across a server restart.
   * A deploy reloads the previous server's rooms only when this matches, so
   * bump it whenever the state changes in a way older saves can't satisfy
   * (a new required field, a renamed one). Absent counts as 0.
   */
  stateVersion?: number;
}

/** A module with its types erased, as the platform holds it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type AnyGameModule = GameModule<any, any, any>;

/**
 * A move the rules don't allow. Its message is shown to the player, so it
 * should read as plain advice ("It isn't your turn."). Anything else thrown
 * is treated as a bug.
 */
export class GameError extends Error {}
