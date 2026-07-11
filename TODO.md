# TODO / ideas

## Testing
- **Browser UI tests (Playwright) — deferred.** The engine, pass-device
  sequencing, server, and a full game over live WebSockets are all covered by
  tests. The one uncovered layer is the React UI wiring itself (clicking through
  the rendered handoff / night / vote screens). The UI has held up well in
  manual play, so this is parked. If flakiness ever shows up, add:
  1. a pass-the-device spec (single page, no server) that plays to a win, and
  2. a multi-device spec driving ~4 browser contexts through a full game.

## Roles / mechanics
- Growing the role registry beyond the classic core (see `roles.ts`). Candidates
  from Wolfsville and friends: Hunter, Witch, Cupid/Lovers, Bodyguard, Minion,
  Sorcerer, Tanner/Jester, Drunk, Mason, Prince, etc.
