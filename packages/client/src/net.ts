import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientMessage, ServerMessage, PlayerView } from "@werewolf/shared";

interface Creds {
  code: string;
  playerId: string;
  token: string;
}

const STORE_KEY = "werewolf.creds";

function loadCreds(): Creds | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Creds) : null;
  } catch {
    return null;
  }
}

export interface OnlineGame {
  view: PlayerView | null;
  code: string | null;
  error: string | null;
  connected: boolean;
  create: (name: string) => void;
  join: (code: string, name: string) => void;
  send: (msg: ClientMessage) => void;
  leave: () => void;
}

export function useOnlineGame(): OnlineGame {
  const [view, setView] = useState<PlayerView | null>(null);
  const [code, setCode] = useState<string | null>(null);
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

  const rawSend = useCallback((msg: ClientMessage) => {
    queueRef.current.push(msg);
    flush();
  }, []);

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
          onOpenRef.current = () => {
            const c = credsRef.current!;
            rawSend({ type: "rejoin", code: c.code, playerId: c.playerId, token: c.token });
          };
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
        setError(null);
      } else if (msg.type === "view") {
        setView(msg.view);
      } else if (msg.type === "error") {
        setError(msg.message);
      }
    };
  }, [rawSend]);

  // On mount, if we have stored creds, try to rejoin the existing game.
  useEffect(() => {
    if (credsRef.current) {
      onOpenRef.current = () => {
        const c = credsRef.current!;
        rawSend({ type: "rejoin", code: c.code, playerId: c.playerId, token: c.token });
      };
      ensureSocket();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const create = useCallback(
    (name: string) => {
      onOpenRef.current = () => rawSend({ type: "createRoom", name });
      ensureSocket();
      flush();
    },
    [ensureSocket, rawSend]
  );

  const join = useCallback(
    (roomCode: string, name: string) => {
      onOpenRef.current = () => rawSend({ type: "joinRoom", code: roomCode.toUpperCase(), name });
      ensureSocket();
      flush();
    },
    [ensureSocket, rawSend]
  );

  const leave = useCallback(() => {
    localStorage.removeItem(STORE_KEY);
    credsRef.current = null;
    sockRef.current?.close();
    sockRef.current = null;
    setView(null);
    setCode(null);
    setError(null);
  }, []);

  return { view, code, error, connected, create, join, send: rawSend, leave };
}
