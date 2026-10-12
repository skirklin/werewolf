# 🐺 Werewolf

A home-built Werewolf / Mafia game. No app store, no accounts — you run it on
your own machine and everyone plays from a phone browser on the same WiFi, or
you pass a single device around the table.

## Why

Built to replace a buggy commercial clone: the random role assignment is fair
and *scales* (no more "1 werewolf for 7 players"), the mechanics are covered by
tests, and it's yours to change.

## How it's built

The repo is a small platform for phone-browser party games, with Werewolf as
the first game and room for more.

- **`packages/core`** — the contract between the platform and a game
  (`GameModule`: start, act, view, isOver), the wire protocol, and a seeded RNG.
- **`packages/server`** — Fastify + WebSocket. Owns rooms for every game: codes,
  roster, host, reconnects, the lobby, and dealing again afterwards. It runs
  each game's module authoritatively and sends each phone only its **own
  redacted view**, so no client can see another player's secrets.
- **`packages/client`** — React + Vite. A shared shell (game picker, join,
  lobby, invite) plus each game's own screens under `src/games/<game>/`.
- **`packages/arena`** — Werewolf agent-vs-agent play over the real WebSocket
  protocol, for measuring how strategies perform. See below.
- **`games/werewolf`** — a pure, framework-free Werewolf engine (roles,
  night/day resolution, win conditions, fair seeded role dealing) plus
  per-player view redaction. This is the single source of truth for the rules
  and is fully unit-tested. The same engine runs in the browser for
  pass-the-device play, so the two modes can never disagree on the rules.
- **`games/deaddrop`** — a second, in-progress game: spy deduction with
  generated, solver-verified scenarios. The server can host it; its screens
  aren't built yet. See [its design notes](games/deaddrop/DESIGN.md).

### Adding a game

1. Write the rules as a package under `games/` and export a `GameModule` from
   `@party/core`. Keep `act` pure and treat its `action` as untrusted.
2. Add the module to `GAMES` in `packages/server/src/server.ts`.
3. Add a `ClientGame` (home screen, lobby settings, in-game table) under
   `packages/client/src/games/` and list it in `games/index.ts`.
4. Add the new package's manifest to the `Dockerfile` and the root workspaces.

## Play modes

- **Play together** — each person on their own phone. One player creates a room,
  everyone else joins with the 4-letter code (letters only, so phone keyboards
  never have to switch to digits). When a game ends the host can deal another
  one in place — the room, the code and the roster all stay put. Days have a
  town-square chat, so this works for playing apart as well as around a table.
- **Pass the device** — one phone shared around the table, with privacy handoff
  screens. Role reveal is folded into the first night so the device only circles
  once.

## Roles

Villager, Werewolf, Seer, Doctor to start. The role registry
(`games/werewolf/src/roles.ts`) is designed so adding a role that reuses an
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

## Agent arena

`packages/arena` lets LLM agents play each other, so you can measure what
different strategies actually win.

Each agent gets **one WebSocket connection and nothing else**. What it can see
is the same redacted `PlayerView` a phone gets, so an agent cannot read another
player's role — not because the harness is careful, but because the server never
sent it. That's enforced by the same code path that protects human players, and
there's a test that walks every view handed to every agent and asserts only its
own role (and its packmates', if it's a wolf) was ever filled in.

```bash
npm run arena -- --games 20 --lineup random:7          # free, no API calls
npm run arena -- --games 20 --lineup heuristic:5,random:4
npm run arena -- --games 10 --lineup llm:4,heuristic:3  # costs money
npm run arena -- --games 6  --lineup llm:3,llm@claude-sonnet-5:4
```

Strategies:

- **`random`** — legal moves at random, never speaks. The control: any win rate
  is measured against "what does luck alone get at this table size?".
- **`heuristic`** — plays its own information (seer reads, its pack) but never
  reasons about what anyone *said*. Whatever an LLM wins above this line is the
  value of talking.
- **`llm`** / **`llm@MODEL`** — a Claude agent per seat, defaulting to
  `claude-haiku-4-5` because sample size is the point (a seven-player game is
  easily fifty calls). Needs `ANTHROPIC_API_KEY`; API trouble degrades to a
  random legal move rather than killing the run.

Results print as a table — win rates per strategy, split by the side each seat
drew, plus per-role numbers, how often the town's lynch actually hit a wolf, and
how many days deadlocked. `--out FILE` appends the anonymous records,
`--transcript FILE` saves everything that was said, and `--roles a,b,c` /
`--ratio N` set what gets dealt (the default pool is fixed at seven seats, and
the runner says so). Arena games are tagged `agent` and never mix into the house
numbers; the transcript is kept *out* of the game record, because words are the
one thing players write themselves.

Two more entry points: `npm run arena:analyze -- records.jsonl` re-prints the
table from saved records, and `npm run arena:annotate -- records.jsonl
transcript.txt` joins talk back to roles so you can ask who was bluffing.

### What it has found

At five seats with one wolf and a peaceful first night, over 40 agent games
against an 80-game random control:

| | random | agents |
|---|---|---|
| Village win rate | 34% | **55%** (p = 0.03) |
| Lynch accuracy | 25% | 37% |
| Days deadlocked | 33% | 21% |

Getting there was mostly a matter of giving agents information the server had
been sending all along and the prompt ignored — the wolf count and house rules,
the running vote tally, the pack's own night picks. Before that audit the agents
were statistically indistinguishable from random, and a village that cannot see
a majority forming ties a third of its days away.

Two cautions if you extend this. The default role pool is fixed, so every game
deals the same four roles unless you pass `--roles`; and win rate is a noisy
measure at these sample sizes — lynch accuracy counts every vote and is the
better signal for whether discussion is doing anything.

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
