# Foul Play

A hidden-killer deduction game. Lord Ashcombe has been murdered during his
own party; every player is one of the guests, and one of them did it. The
table investigates through the night and, at dawn, has to name **who**,
**with what** and **where**. The full rules are in [RULES.md](RULES.md).

This package is the engine: content, case generator, solver, turn rules and
a baseline bot, exported to the platform as `foulplayModule`. The screens
live in `packages/client/src/games/foulplay/`.

```bash
npm run foulplay -- --seed 7 --players 5          # print a case: guests, leads, forgeries, solution
npm run foulplay -- --sim 150 --players 5         # bot games: how often the killer wins, and how
npm run foulplay -- --sim 150 --players 6 --accomplice no --rounds 4
```

## Pieces

- **`content.ts`**: the cast (fixed looks and motives), rooms and their
  features, weapons with where they're kept and what they demand of the
  murder, and every evidence sentence.
- **`space.ts` / `solver.ts`**: every possible world (killer, weapon, room,
  and the killer's evening), filtered by bitsets. The solver gives what's
  still possible, why something was ruled out, and, for cards that can't all
  be true, a small set that clashes (`conflict`) or the most trusted subset
  that can (`believable`).
- **`generate.ts`**: builds a case. It picks the killer, weapon and room,
  writes evidence to fit, and lays it out as starting memories and lead
  stacks. Every lead answers its own question (the body: looks and the kind
  of room; staff: exactly who was in a room; an alibi: exactly where a guest
  went; a search: is this the scene, is a weapon missing). It checks that the
  innocents can solve the case without anything the killer's side holds,
  that their memories alone don't come close, and that every forgery is
  false.
- **`game.ts`**: the turn rules as a pure reducer, and `projectView`, which
  is all a player is ever sent. The truth only appears in the killer's view,
  and in everyone's once the game is over.
- **`bot.ts`**: a baseline player for simulations and practice. Innocents
  trust their own memories most and anything from a lead someone else looked
  at first least, and set aside whatever contradicts what they trust more.
  The guilty plant, bury, strike once, and vote for the likeliest-looking
  wrong answer.

## Things the engine leans on

- **Knowing versus proving.** A player's notebook (`known`) keeps every card
  they've seen; their hand is only what they can still show. Cards carry an
  `origin` that everyone who sees them sees, so a planted card reads exactly
  like a real one, drawn by an innocent.
- **Role knowledge.** `selfKnowledge` turns a role into cards with negative
  ids: an innocent knows it wasn't them, the accomplice knows who, the killer
  knows everything. The board and the bots both reason with these; they never
  go into play.
- **Generated, never sorted.** Every case is built from its seed and checked,
  so a badly shuffled deck can't happen.

## History

Foul Play began as Dead Drop, a spy game in the style of Awkward Guests:
players traded scored evidence cards on asks to the whole table, with rounds
of discards and redraws, and raced (or cooperated) to the answer. It became a
murder mystery, then this hidden-killer version, where the information comes
from investigating leads and the opponent is someone at the table. Some
identifiers (`agent`, `device`, `moleTrait`, `handoffFeature`) are left over
from the spy draft.
