# Foul Play

A hidden-killer deduction game. Lord Ashcombe has been murdered during his
own party; every player is one of the guests, and one of them did it. The
evidence is scattered through the house, and it's a race: the innocents
search for it, the killer destroys it. The full rules are in
[RULES.md](RULES.md).

This package is the engine: content, case generator, solver, turn rules and
a baseline bot, exported to the platform as `foulplayModule`. The screens
live in `packages/client/src/games/foulplay/`.

```bash
npm run foulplay -- --seed 7 --players 5          # print a case: guests, memories, every room's evidence, solution
npm run foulplay -- --sim 100 --players 5         # bot games: who wins, and how
npm run foulplay -- --sim 100 --players 6 --accomplice no --rounds 4
```

## Pieces

- **`content.ts`**: the cast (fixed looks and motives), rooms and their
  features, weapons with where they're kept and what they demand of the
  murder, and every evidence sentence.
- **`space.ts` / `solver.ts`**: every possible world (killer, weapon, room,
  and the killer's evening), filtered by bitsets. The solver says what's
  still possible, why something was ruled out, and whether a set of cards
  proves one answer.
- **`generate.ts`**: builds a case. It picks the killer, weapon and room,
  writes evidence to fit, and leaves it around the house: on the body in the
  Hall (the killer's looks, the kind of room), and in each room (was it here,
  is the weapon kept here missing, sometimes who came and went or a guest's
  evening). Each player gets one memory. It checks that the innocents could
  prove the case even with any one card destroyed.
- **`game.ts`**: the rules as a pure reducer, and `projectView`, which is
  all a player is ever sent. Turns are one player at a time, the night
  included, so the game works passing one device. The solver decides the
  end: the record proves the answer (innocents), or what's left can't
  (killer).
- **`bot.ts`**: a baseline player for simulations and practice. Innocents
  head for the most evidence or tag along with someone; the killer goes
  after the most damaging card it can reach unwatched and burns it, and
  murders a lone guest at night.

## Things the engine leans on

- **Location is the clue.** Everyone's room is public, and so is how much
  evidence is left in each. A find in company goes straight on the record;
  a find alone goes into your hand. So "you were alone in the Library and
  its count dropped" is the deduction, and joining someone is both
  protection and surveillance. Any company counts, not just innocent
  company, or a find staying private would give a guilty companion away.
- **Role knowledge.** `selfKnowledge` turns a role into cards with negative
  ids: an innocent knows it wasn't them, the accomplice knows who, the killer
  knows everything. The board and the bots reason with these; they never go
  into play.
- **Generated, never sorted.** Every case is built from its seed and checked.

## History

Foul Play began as Dead Drop, a spy game in the style of Awkward Guests:
players traded scored evidence cards on asks to the whole table, with rounds
of discards and redraws. It became a murder mystery, then a hidden-killer
game with leads and forgeries, and then this version: a race through the
house, where where you are matters. Some identifiers (`agent`, `device`,
`moleTrait`, `handoffFeature`) are left over from the spy draft.
