# Foul Play

A hidden-killer deduction game. Lord Ashcombe has been murdered during his
own party; every player is one of the guests, and one of them did it. The
every guest had means, motive and opportunity, and the killer wins by getting
someone else convicted. The full rules are in
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
- **`generate.ts`**: builds a case. It picks the killer and their real
  story (weapon, room, evening), then a believable story for every other
  guest, and gives each guest the evening their story needs. Then it deals
  the evidence: alibis, "not here" and "not the weapon" cards (the cards
  that break false stories), sightings that fit each story, and sometimes
  who came and went. It checks that everything findable proves the answer,
  and that every false story takes two or three destroyable cards to break.
- **`game.ts`**: the rules as a pure reducer, and `projectView`, which is
  all a player is ever sent. Turns are one player at a time, the night
  included, so the game works passing one device. The game ends when the
  table accepts a Reconstruction, at the dawn vote, or when the guilty are
  no longer outnumbered. It never ends on its own because the evidence adds
  up.
- **`bot.ts`**: a baseline player for simulations and practice. Innocents
  head for the most evidence or tag along with someone, burn sightings of
  themselves, and call the Reconstruction when what they know leaves one
  answer. The guilty pick someone to frame, burn the cards that break that
  story, and call it once the record can't tell it from the truth.

## Things the engine leans on

- **Location is the clue.** Everyone's room is public, and so is how much
  evidence is left in each. A find in company goes straight on the record;
  a find alone goes into your hand. So "you were alone in the Library and
  its count dropped" is the deduction, and joining someone is both
  protection and surveillance. Any company counts, not just innocent
  company, or a find staying private would give a guilty companion away.
- **The case against each guest** is called a story in the code
  (`scenario.stories`): their means (weapon) and opportunity (room).
  `breaks(dossier, card, story, evening)` says whether a card clears them of
  it; the bots use it to choose whom to frame.
- **Role knowledge.** `selfKnowledge` turns a role into cards with negative
  ids: an innocent knows it wasn't them, the guilty know everything. The bots
  reason with these; they never go into play. The board players see does no
  reasoning: it's a sheet they mark themselves.
- **Generated, never sorted.** Every case is built from its seed and checked.

## History

Foul Play began as Dead Drop, a spy game in the style of Awkward Guests:
players traded scored evidence cards on asks to the whole table, with rounds
of discards and redraws. It became a murder mystery, then a hidden-killer
game with leads and forgeries, then a race through the house, where where
you are matters, and then this version, where every guest had means, motive and opportunity. Some identifiers (`agent`, `device`,
`moleTrait`, `handoffFeature`) are left over from the spy draft.
