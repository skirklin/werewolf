import type { ComponentType } from "react";
import type { RoomInfo } from "@party/core";

/** What a game's in-play screen is handed by the online shell. */
export interface TableProps<View, Action> {
  view: View;
  room: RoomInfo;
  /** This device's player id. */
  you: string;
  isHost: boolean;
  act: (action: Action) => void;
  /** Host only: back to the lobby, same room and roster, once the game is over. */
  playAgain: () => void;
  onExit: () => void;
}

export interface LobbySettingsProps<Config> {
  config: Config;
  players: number;
  onChange: (config: Config) => void;
}

/** A game's home screen. `sub` is the rest of the path (`/werewolf/stats` → "stats"). */
export interface HomeProps {
  sub: string;
  navigate: (sub: string) => void;
  onBack: () => void;
}

/**
 * Everything the browser app needs to offer a game. The rules live in the
 * game's own package; this is only how it looks and what the lobby asks.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface ClientGame<Config = any, View = any, Action = any> {
  id: string;
  name: string;
  emoji: string;
  tagline: string;
  /** Still being worked out: the picker flags it so nobody expects polish. */
  beta?: boolean;
  Home: ComponentType<HomeProps>;
  /** Starting config for a lobby; `last` is the previous game's, if any. */
  initialConfig(players: number, last: unknown): Config;
  /** Why the host can't start yet, or [] when they can. */
  configProblems(config: Config, players: number): string[];
  LobbySettings?: ComponentType<LobbySettingsProps<Config>>;
  /** Shown to everyone in the lobby, e.g. a change log. */
  LobbyNotes?: ComponentType;
  Table: ComponentType<TableProps<View, Action>>;
}
