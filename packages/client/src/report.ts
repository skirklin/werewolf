import { toGameRecord, type GameState } from "@werewolf/shared";

/**
 * Post the anonymous record of a finished pass-the-device game. Multi-device
 * games are filed by the server itself; only this mode, which never touches the
 * server, has to report in.
 *
 * Fire-and-forget by design: stats are never worth interrupting play for, so a
 * failure (offline, blocked, rate-limited) is simply dropped.
 */
export function reportGame(state: GameState): void {
  const record = toGameRecord(state, "local");
  if (!record) return;
  fetch("/api/games", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(record),
  }).catch(() => {});
}
