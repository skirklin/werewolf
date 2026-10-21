import { useCallback, useEffect, useRef, useState } from "react";
import { normalizeRoomCode, type ClientMessage, type RoomInfo, type ServerMessage } from "@party/core";

interface Creds {
  code: string;
  playerId: string;
  token: string;
}

const STORE_KEY = "party.creds";
/** Remembers which build we already reloaded for, so a reload can never loop. */
const RELOAD_KEY = "party.reloadedFor";
/** Hidden longer than this and the socket is presumed dead (iOS kills it silently). */
const STALE_AFTER_HIDDEN_MS = 3000;

/** Load the newest page, at most once per server build. True if reloading. */
function reloadFor(build: string): boolean {
  try {
    if (sessionStorage.getItem(RELOAD_KEY) === build) return false;
    sessionStorage.setItem(RELOAD_KEY, build);
  } catch {
    /* storage off: still worth one reload */
  }
  location.reload();
  return true;
}

function loadCreds(): Creds | null {
  try {
    const raw = localStorage.getItem(STORE_KEY);
    return raw ? (JSON.parse(raw) as Creds) : null;
  } catch {
    return null;
  }
}

const DEVICE_KEY = "party.deviceId";

/**
 * This browser's own random id, made once and kept (it outlives Leave). The
 * server uses it to hand a seat back to the device that held it — never a
 * name, which anyone could type.
 */
function deviceId(): string | undefined {
  try {
    let id = localStorage.getItem(DEVICE_KEY);
    if (!id) {
      id = crypto.randomUUID?.() ?? Array.from(crypto.getRandomValues(new Uint8Array(16)), (b) => b.toString(16).padStart(2, "0")).join("");
      localStorage.setItem(DEVICE_KEY, id);
    }
    return id;
  } catch {
    return undefined; // storage blocked: this device just can't reclaim a seat
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
  /** `name` is the player's real name; `alias` an optional nickname shown beside it. */
  create: (game: string, name: string, alias?: string) => void;
  join: (code: string, name: string, alias?: string) => void;
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
  // Set once the server has turned this page away as outdated: stop retrying.
  const outdatedRef = useRef(false);

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
    if (outdatedRef.current) return;
    if (sockRef.current && sockRef.current.readyState <= WebSocket.OPEN) return;
    const proto = location.protocol === "https:" ? "wss" : "ws";
    // The server checks the build and turns away pages from an older deploy.
    const sock = new WebSocket(`${proto}://${location.host}/ws?build=${encodeURIComponent(__BUILD_ID__)}`);
    sockRef.current = sock;

    sock.onopen = () => {
      setConnected(true);
      onOpenRef.current?.();
      onOpenRef.current = null;
      flush();
    };
    sock.onclose = () => {
      // A socket we already replaced (see resume below) has nothing to say.
      if (sockRef.current !== sock) return;
      setConnected(false);
      // Auto-reconnect + rejoin if we have credentials and a live game.
      if (credsRef.current && !outdatedRef.current) {
        setTimeout(() => {
          onOpenRef.current = rejoin;
          ensureSocket();
        }, 800);
      }
    };
    sock.onmessage = (ev) => {
      const msg = JSON.parse(ev.data) as ServerMessage;
      if (msg.type === "outdated") {
        outdatedRef.current = true;
        // Saved creds survive the reload, so the new page rejoins the seat.
        reloadFor(msg.build);
      } else if (msg.type === "joined") {
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
        setError(null); // the game moved on; an old complaint no longer applies
      } else if (msg.type === "error") {
        setError(msg.message);
      }
    };
  }, [rejoin]);

  /**
   * Coming back to the page. iOS Safari freezes a backgrounded tab and kills its
   * socket without ever firing `close`, so the page looks connected but is
   * deaf: every tap goes nowhere. After any real absence, or whenever the
   * socket is plainly gone, replace it and rejoin the seat.
   */
  useEffect(() => {
    let hiddenAt: number | null = document.hidden ? Date.now() : null;
    const resume = (force: boolean) => {
      if (!credsRef.current || outdatedRef.current) return;
      const sock = sockRef.current;
      const alive = sock && sock.readyState === WebSocket.OPEN;
      if (alive && !force) return;
      if (sock) {
        sockRef.current = null; // detach first, so its close doesn't schedule a second reconnect
        try {
          sock.close();
        } catch {
          /* already dead */
        }
      }
      onOpenRef.current = rejoin;
      ensureSocket();
    };
    const onVisibility = () => {
      if (document.hidden) {
        hiddenAt = Date.now();
        return;
      }
      const away = hiddenAt === null ? 0 : Date.now() - hiddenAt;
      hiddenAt = null;
      resume(away > STALE_AFTER_HIDDEN_MS);
    };
    // Restored from the back/forward cache: the old socket is certainly gone.
    const onPageShow = (e: PageTransitionEvent) => resume(e.persisted);
    const onOnline = () => resume(true);
    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", onPageShow);
    window.addEventListener("online", onOnline);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", onPageShow);
      window.removeEventListener("online", onOnline);
    };
  }, [ensureSocket, rejoin]);

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
    (game: string, name: string, alias?: string) => {
      onOpenRef.current = () => send({ type: "createRoom", game, name, alias, deviceId: deviceId() });
      ensureSocket();
      flush();
    },
    [ensureSocket, send]
  );

  const join = useCallback(
    (roomCode: string, name: string, alias?: string) => {
      onOpenRef.current = () =>
        send({ type: "joinRoom", code: normalizeRoomCode(roomCode), name, alias, deviceId: deviceId() });
      ensureSocket();
      flush();
    },
    [ensureSocket, send]
  );

  const act = useCallback((action: unknown) => send({ type: "act", action }), [send]);

  const leave = useCallback(() => {
    localStorage.removeItem(STORE_KEY);
    credsRef.current = null;
    // Say so before hanging up, so a lobby seat is freed rather than held
    // open for a reconnect that will never come.
    const sock = sockRef.current;
    if (sock?.readyState === WebSocket.OPEN) sock.send(JSON.stringify({ type: "leave" } satisfies ClientMessage));
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
