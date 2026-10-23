import { useEffect, useMemo, useRef, useState } from "react";
import {
  createGame,
  reduce,
  projectView,
  passDeviceTurn,
  toEngineAction,
  nightAckKey,
  allNightStepsDone,
  allVotesIn,
  living,
  unackedNightResults,
  type GameState,
  type GameConfig,
  type Player,
  type PlayerView,
  type Turn,
  type WerewolfAction,
} from "@party/werewolf";
import { reportGame } from "./report.js";

function randomSeed(): number {
  return Math.floor(Math.random() * 2 ** 31);
}

export interface LocalGame {
  state: GameState | null;
  turn: Turn;
  /** The seat holding the device, if anyone's. */
  seatId: string | null;
  /** Redacted view for the seat currently holding the device (or a public one). */
  view: PlayerView | null;
  start: (names: string[], config: GameConfig) => void;
  /** The device holder's night move, as the online client would send it. */
  act: (action: WerewolfAction) => void;
  /** Move on from an announcement (dawn, or a vote's result). */
  proceed: () => void;
  passNight: () => void;
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

  const turn = useMemo<Turn>(() => passDeviceTurn(state, acks), [state, acks]);
  const seatId = "seatId" in turn ? turn.seatId : null;

  const view = useMemo<PlayerView | null>(() => {
    const viewer = seatId ?? state?.players[0]?.id;
    return state && viewer ? projectView(state, viewer) : null;
  }, [state, seatId]);

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
  const advanceNight = (s: GameState, id: string): GameState => {
    const nextAcks = new Set(acks).add(nightAckKey(s.round, id));
    setAcks(nextAcks);
    const allDone =
      living(s).every((p) => nextAcks.has(nightAckKey(s.round, p.id))) && allNightStepsDone(s);
    return allDone ? reduce(s, { type: "endNight" }) : s;
  };

  const act = (action: WerewolfAction) => {
    if (!state || state.phase !== "night" || !seatId) return;
    const next = reduce(state, toEngineAction(seatId, action, false));
    // A Seer or Detective keeps the device until they've read their result (nightAck).
    setState(unackedNightResults(next).includes(seatId) ? next : advanceNight(next, seatId));
  };

  const proceed = () => {
    if (state?.phase === "announce") setState(reduce(state, { type: "proceed" }));
  };

  const passNight = () => {
    if (!state || turn.kind !== "nightPass") return;
    setState(advanceNight(state, turn.seatId));
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

  return { state, turn, seatId, view, start, act, proceed, passNight, callVote, submitVote, reset };
}
