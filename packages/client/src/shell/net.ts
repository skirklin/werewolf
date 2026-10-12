import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeRoomCode, type ClientMessage, type RoomInfo, type ServerMessage } from "@party/core";

interface Creds {
  code: string;
  playerId: string;
  token: string;
}

const STORE_KEY = "party.creds";

function loadCreds(): Creds | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Creds) : null;
  } catch {
    return null;
  }
}

/** True when this browser was in a room and should try to rejoin it. */
export function hasSavedRoom(): boolean {
  return loadCreds() !== null;
}

export interface RoomConnection {
  room: RoomInfo | null;
  /** The game's view for this seat, once a game is under way. */
  view: unknown;
  code: string | null;
  playerId: string | null;
  error: string | null;
  connected: boolean;
  create: (game: string, name: string) => void;
  join: (code: string, name: string) => void;
  send: (msg: ClientMessage) => void;
  act: (action: unknown) => void;
  leave: () => void;
}

/** One device's connection to one room, with automatic reconnect and rejoin. */
export function useRoom(): RoomConnection {
  const [room, setRoom] = useState<RoomInfo | null>(null);
  const [view, setView] = useState<unknown>(null);
  const [code, setCode] = useState<string | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);
  const sockRef = useRef<WebSocket | null>(null);
  const credsRef = useRef<Creds | null>(loadCreds());
  const queueRef = useRef<ClientMessage[]>([]);
  // Pending intent to run once the socket opens (create/join/rejoin).
  const onOpenRef = useRef<(() => void) | null>(null);

  const flush = () => {
    const sock = sockRef.current;
    if (sock?.readyState === WebSocket.OPEN) {
      for (const m of queueRef.current) sock.send(JSON.stringify(m));
      queueRef.current = [];
    }
  };

  const send = useCallback((msg: ClientMessage) => {
    queueRef.current.push(msg);
    flush();
  }, []);

  const rejoin = useCallback(() => {
    const c = credsRef.current;
    if (c) send({ type: "rejoin", code: c.code, playerId: c.playerId, token: c.token });
  }, [send]);

  const ensureSocket = useCallback(() => {
    if (sockRef.current && sockRef.current.readyState <= WebSocket.OPEN) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    const sock = new WebSocket(`${proto}://${location.host}/ws`);
    sockRef.current = sock;

    sock.onopen = () => {
      setConnected(true);
      onOpenRef.current?.();
      onOpenRef.current = null;
      flush();
    };
    sock.onclose = () => {
      setConnected(false);
      // Auto-reconnect + rejoin if we have credentials and a live game.
      if (credsRef.current) {
        setTimeout(() => {
          onOpenRef.current = rejoin;
          ensureSocket();
        }, 800);
      }
    };
    sock.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMessage;
      if (msg.type === "joined") {
        credsRef.current = { code: msg.code, playerId: msg.playerId, token: msg.token };
        localStorage.setItem(STORE_KEY, JSON.stringify(credsRef.current));
        setCode(msg.code);
        setPlayerId(msg.playerId);
        setError(null);
      } else if (msg.type === "room") {
        setRoom(msg.room);
        // Back in the lobby, the last game's view no longer applies.
        if (msg.room.phase === "lobby") setView(null);
      } else if (msg.type === "view") {
        setView(msg.view);
      } else if (msg.type === "error") {
        setError(msg.message);
      }
    };
  }, [rejoin]);

  // On mount, if we have stored creds, try to rejoin the existing game — unless
  // an invite link points at a different room, which should take precedence.
  useEffect(() => {
    const invite = normalizeRoomCode(new URLSearchParams(location.search).get("room") ?? "") || null;
    if (credsRef.current && invite && invite !== credsRef.current.code) {
      localStorage.removeItem(STORE_KEY);
      credsRef.current = null;
    }
    if (credsRef.current) {
      onOpenRef.current = rejoin;
      ensureSocket();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = useCallback(
    (game: string, name: string) => {
      onOpenRef.current = () => send({ type: "createRoom", game, name });
      ensureSocket();
      flush();
    },
    [ensureSocket, send]
  );

  const join = useCallback(
    (roomCode: string, name: string) => {
      onOpenRef.current = () => send({ type: "joinRoom", code: normalizeRoomCode(roomCode), name });
      ensureSocket();
      flush();
    },
    [ensureSocket, send]
  );

  const act = useCallback((action: unknown) => send({ type: "act", action }), [send]);

  const leave = useCallback(() => {
    localStorage.removeItem(STORE_KEY);
    credsRef.current = null;
    sockRef.current?.close();
    sockRef.current = null;
    setRoom(null);
    setView(null);
    setCode(null);
    setPlayerId(null);
    setError(null);
  }, []);

  return { room, view, code, playerId, error, connected, create, join, send, act, leave };
}
