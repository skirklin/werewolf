import { useEffect, useMemo, useRef, useState } from "react";
import {
  createGame,
  reduce,
  projectView,
  getRole,
  passDeviceTurn,
  nightAckKey,
  allNightStepsDone,
  allVotesIn,
  living,
  type GameState,
  type GameConfig,
  type Player,
  type PlayerView,
  type Turn,
} from "@werewolf/shared";
import { reportGame } from "./report.js";

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export interface LocalGame {
  state: GameState | null;
  turn: Turn;
  /** Redacted view for the seat currently holding the device (or a public one). */
  view: PlayerView | null;
  start: (names: string[], config: GameConfig) => void;
  submitNight: (targetId: string) => void;
  submitWitch: (save: boolean, poisonTargetId: string | null) => void;
  submitSwap: (aId: string, bId: string) => void;
  submitDetect: (aId: string, bId: string) => void;
  submitRaise: (targetId: string | null) => void;
  passNight: () => void;
  submitShoot: (targetId: string) => void;
  callVote: () => void;
  submitVote: (targetId: string | null) => void;
  reset: () => void;
}

export function useLocalGame(): LocalGame {
  const [state, setState] = useState<GameState | null>(null);
  const [acks, setAcks] = useState<Set<string>>(new Set());

  // File this game's anonymous record the moment it ends. Keyed on the state
  // object itself, so a re-run of the effect can't report the same game twice.
  const reported = useRef<GameState | null>(null);
  useEffect(() => {
    if (state?.phase === "gameOver" && reported.current !== state) {
      reported.current = state;
      reportGame(state);
    }
  }, [state]);

  // Role reveal is folded into the first night, so there is no separate reveal
  // pass — an empty `revealed` set keeps the sequencer in its night branch.
  const turn = useMemo<Turn>(() => passDeviceTurn(state, new Set(), acks), [state, acks]);

  const view = useMemo<PlayerView | null>(() => {
    if (!state) return null;
    const seatId = "seatId" in turn ? turn.seatId : state.players[0]?.id;
    return seatId ? projectView(state, seatId) : null;
  }, [state, turn]);

  const start = (names: string[], config: GameConfig) => {
    const players: Player[] = names.map((name, i) => ({
      id: `s${i}`,
      name: name.trim() || `Player ${i + 1}`,
      roleId: null,
      alive: true,
      connected: true,
      isHost: i === 0,
    }));
    const base = { ...createGame("LOCAL", randomSeed()), phase: "lobby" as const, players };
    // Deal roles, then go straight into the first night (single pass around).
    const dealt = reduce(base, { type: "startGame", config });
    setAcks(new Set());
    setState(reduce(dealt, { type: "startNight" }));
  };

  /** Mark a living player's night turn done; end the night once all have gone. */
  const advanceNight = (s: GameState, seatId: string): GameState => {
    const key = nightAckKey(s.round, seatId);
    const nextAcks = new Set(acks).add(key);
    setAcks(nextAcks);
    const allDone =
      living(s).every((p) => nextAcks.has(nightAckKey(s.round, p.id))) && allNightStepsDone(s);
    return allDone ? reduce(s, { type: "endNight" }) : s;
  };

  const submitNight = (targetId: string) => {
    if (!state || turn.kind !== "night") return;
    const acted = reduce(state, { type: "nightChoice", actorId: turn.seatId, targetId });
    setState(advanceNight(acted, turn.seatId));
  };

  const submitWitch = (save: boolean, poisonTargetId: string | null) => {
    if (!state || turn.kind !== "night") return;
    const acted = reduce(state, { type: "witchAction", actorId: turn.seatId, save, poisonTargetId });
    setState(advanceNight(acted, turn.seatId));
  };

  const submitSwap = (aId: string, bId: string) => {
    if (!state || turn.kind !== "night") return;
    const acted = reduce(state, { type: "swapAction", actorId: turn.seatId, aId, bId });
    setState(advanceNight(acted, turn.seatId));
  };

  const submitDetect = (aId: string, bId: string) => {
    if (!state || turn.kind !== "night") return;
    const acted = reduce(state, { type: "detectAction", actorId: turn.seatId, aId, bId });
    setState(advanceNight(acted, turn.seatId));
  };

  const submitRaise = (targetId: string | null) => {
    if (!state || turn.kind !== "night") return;
    const acted = reduce(state, { type: "raiseAction", actorId: turn.seatId, targetId });
    setState(advanceNight(acted, turn.seatId));
  };

  const passNight = () => {
    if (!state || turn.kind !== "nightPass") return;
    setState(advanceNight(state, turn.seatId));
  };

  const submitShoot = (targetId: string) => {
    if (!state || turn.kind !== "shoot") return;
    setState(reduce(state, { type: "shoot", hunterId: turn.seatId, targetId }));
  };

  const callVote = () => {
    if (!state) return;
    let next = reduce(state, { type: "startVote" });
    // If nobody may vote (e.g. everyone silenced), resolve straight away so the
    // day can't dead-end — there's no host "force" button in pass-device.
    if (allVotesIn(next)) next = reduce(next, { type: "resolveVote" });
    setState(next);
  };

  const submitVote = (targetId: string | null) => {
    if (!state || turn.kind !== "vote") return;
    let next = reduce(state, { type: "castVote", voterId: turn.seatId, targetId });
    if (allVotesIn(next)) next = reduce(next, { type: "resolveVote" });
    setState(next);
  };

  const reset = () => {
    setState(null);
    setAcks(new Set());
  };

  return {
    state, turn, view, start,
    submitNight, submitWitch, submitSwap, submitDetect, submitRaise,
    passNight, submitShoot, callVote, submitVote, reset,
  };
}

export { getRole };
