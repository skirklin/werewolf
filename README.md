# 🐺 Werewolf

A home-built Werewolf / Mafia game. No app store, no accounts — you run it on
your own machine and everyone plays from a phone browser on the same WiFi, or
you pass a single device around the table.

## Why

Built to replace a buggy commercial clone: the random role assignment is fair
and *scales* (no more "1 werewolf for 7 players"), the mechanics are covered by
tests, and it's yours to change.

## How it's built

- **`packages/shared`** — a pure, framework-free game engine (roles, night/day
  resolution, win conditions, fair seeded role dealing) plus per-player view
  redaction. This is the single source of truth for the rules and is fully
  unit-tested.
- **`packages/server`** — Fastify + WebSocket. Runs the engine authoritatively
  for multi-device play and sends each phone only its **own redacted view**, so
  no client can see another player's role.
- **`packages/client`** — React + Vite. The same engine runs in the browser for
  pass-the-device play, so the two modes can never disagree on the rules.

## Play modes

- **Play together** — each person on their own phone. One player creates a room,
  everyone else joins with the 4-letter code (letters only, so phone keyboards
  never have to switch to digits). When a game ends the host can deal another
  one in place — the room, the code and the roster all stay put.
- **Pass the device** — one phone shared around the table, with privacy handoff
  screens. Role reveal is folded into the first night so the device only circles
  once.

## Roles

Villager, Werewolf, Seer, Doctor to start. The role registry
(`packages/shared/src/roles.ts`) is designed so adding a role that reuses an
existing night action (kill / protect / inspect) is data-only.

## Role selection

Two ways to pick who's what, both fair:

- **Role pool** *(default)* — list the roles you're willing to include (the pool
  can hold more roles than players). The werewolf count comes from a team-ratio
  (Light / Standard / Heavy) so it always scales with the table.
- **Exact counts** — set exactly how many of each role; villagers fill the rest.

## House rules

Toggles that sit alongside the role setup:

- **Reveal roles on death** — off keeps everyone guessing.
- **Peaceful first night** — the wolves skip night one, so nobody is out of the
  game before the town has said a word.
- **Reveal more information** — announces saves and protected kills instead of a
  vague "quiet night" (tilts things toward the villagers).

Always on: the Doctor can't shield the same patient two nights running.

## Stats

Every finished game is filed as one anonymous record — who was dealt what, who
survived, who won, and the beat-by-beat timeline. **Names, player ids, room
codes and the RNG seed are all dropped on the way in**, so the numbers can be
public without exposing anyone's game.

- **📊 House numbers** on the home screen (or `/stats`) — win rates by team and
  by role, survival rates, how people go out, table sizes, house-rule usage.
- **`GET /api/stats`** — the same aggregates as JSON.
- **`GET /api/games?limit=N`** — the raw records, for anything ad hoc.
- **`POST /api/games`** — how the pass-the-device client reports its own games,
  since those never touch the server. Untrusted: every body is re-validated,
  the timestamp is the server's, the mode is forced to `local`, and one address
  may file 30 records an hour.

Records append to `$WEREWOLF_DATA_DIR/games.jsonl`, one JSON object per line
(`kubectl cp` it out, or `tail` it). With no `WEREWOLF_DATA_DIR` set they stay
in memory and vanish on restart, which is what happens in local dev.

## Running it

Requires Node 20+.

```bash
npm install

# Play at home (build once, then serve on one port):
npm run build
npm start
# open the printed http://<your-lan-ip>:3000 URL on each phone

# Or develop with hot reload:
npm run dev        # Vite on :5173, API on :3000
```

> **WSL note:** if you're on Windows/WSL2, phones on your LAN may need a Windows
> `portproxy` to reach the WSL server. On native macOS/Linux the printed LAN URL
> works directly.

## Tests

```bash
npm test           # engine + pass-device sequencing + server/websocket + redaction
```
