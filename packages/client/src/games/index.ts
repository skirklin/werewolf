import type { ClientGame } from "../shell/game.js";
import { werewolf } from "./werewolf/index.js";

/** Every game this app can show, in the order the picker lists them. */
export const GAMES: ClientGame[] = [werewolf];

export function gameById(id: string): ClientGame | undefined {
  return GAMES.find((g) => g.id === id);
}
