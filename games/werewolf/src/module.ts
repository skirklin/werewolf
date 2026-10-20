import { GameError, type GameModule, type RosterEntry } from "@party/core";
import type { GameConfig, GameState, Player } from "./types.js";
import type { PlayerView } from "./views.js";
import type { WerewolfAction } from "./protocol.js";
import { createGame, reduce, nightReadyToEnd, allVotesIn, type Action } from "./engine.js";
import { validateConfig } from "./setup.js";
import { projectView } from "./views.js";
import { toGameRecord, type GameRecord } from "./record.js";

/**
 * Werewolf as a platform game. The engine predates the platform and still
 * carries its own lobby (pass-the-device uses it); online, the platform runs
 * the lobby and this adapter starts the engine straight at the deal.
 */
export const werewolfModule: GameModule<GameConfig, GameState, PlayerView> & {
  record(state: GameState): GameRecord | null;
} = {
  id: "werewolf",
  name: "Werewolf",
  minPlayers: 3,
  maxPlayers: 30,

  parseConfig(raw, players) {
    let problems;
    try {
      problems = validateConfig(raw as GameConfig, players);
    } catch {
      // A malformed config, or a role this server doesn't know.
      throw new GameError("That game setup isn't one this server understands.");
    }
    if (problems.length) throw new GameError(problems[0].message);
    return raw as GameConfig;
  },

  start(seats, config, { seed, code }) {
    const players: Player[] = seats.map((s) => ({
      id: s.id,
      name: s.name,
      roleId: null,
      alive: true,
      connected: s.connected,
      isHost: s.isHost,
    }));
    return reduce({ ...createGame(code, seed), players }, { type: "startGame", config });
  },

  act(state, seatId, raw, { isHost }) {
    const action = toEngineAction(seatId, raw as WerewolfAction, isHost);
    let next = reduce(state, action);
    // Auto-resolve phases so play flows without manual prompting.
    // The night waits for every actor to act AND to dismiss any private result,
    // so a Seer's vision can't be swept away by dawn before it's been read.
    if (next.phase === "night" && next.night && nightReadyToEnd(next))
      next = reduce(next, { type: "endNight" });
    if (next.phase === "dayVote" && allVotesIn(next)) next = reduce(next, { type: "resolveVote" });
    return next;
  },

  view: (state, seatId) => projectView(state, seatId),

  isOver: (state) => state.phase === "gameOver",

  roster(state, roster: readonly RosterEntry[]) {
    const byId = new Map(roster.map((r) => [r.id, r]));
    return {
      ...state,
      players: state.players.map((p) => {
        const r = byId.get(p.id);
        return r ? { ...p, connected: r.connected, isHost: r.isHost } : p;
      }),
    };
  },

  record: (state) => toGameRecord(state, "online"),
};

/** Translate a move off the wire into an engine action, checking who may make it. */
function toEngineAction(actorId: string, msg: WerewolfAction, isHost: boolean): Action {
  const hostOnly = () => {
    if (!isHost) throw new GameError("Only the host can do that.");
  };
  switch (msg?.type) {
    case "startNight":
      hostOnly();
      return { type: "startNight" };
    case "nightChoice":
      return { type: "nightChoice", actorId, targetId: msg.targetId };
    case "witchAction":
      // Missing means "no": a client that leaves a potion out isn't asking for it.
      return { type: "witchAction", actorId, healTargetId: msg.healTargetId ?? null, poisonTargetId: msg.poisonTargetId ?? null };
    case "swapAction":
      return { type: "swapAction", actorId, aId: msg.aId, bId: msg.bId };
    case "detectAction":
      return { type: "detectAction", actorId, aId: msg.aId, bId: msg.bId };
    case "raiseAction":
      return { type: "raiseAction", actorId, targetId: msg.targetId ?? null };
    case "nightAck":
      return { type: "nightAck", actorId };
    case "endNight":
      hostOnly();
      return { type: "endNight" };
    case "startVote":
      hostOnly();
      return { type: "startVote" };
    case "castVote":
      return { type: "castVote", voterId: actorId, targetId: msg.targetId };
    case "resolveVote":
      hostOnly();
      return { type: "resolveVote" };
    case "say":
      return { type: "say", speakerId: actorId, text: msg.text };
    case "shoot":
      return { type: "shoot", hunterId: actorId, targetId: msg.targetId };
    case "skipShot":
      hostOnly(); // recovery when a fallen Hunter has left before shooting
      return { type: "skipShot" };
    default:
      throw new GameError("Unsupported action.");
  }
}
