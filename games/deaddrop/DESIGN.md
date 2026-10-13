# Dead Drop

*Working title.* A deduction game in the family of Awkward Guests, with a spy
story. During an embassy reception a mole handed secrets to their handler.
The players trade intelligence to work out **who** the mole was, **what
device** they used, **where** and **when** the handoff happened.

This package is the engine: content, scenario generator, solver, turn rules
and a baseline bot, exported to the platform as `deaddropModule`. The screens
live in `packages/client/src/games/deaddrop/`. Play it from the game picker,
each player on their own phone, or practise on one device: a solo game
against bots, or pass-the-device when more than one seat is a person.

```bash
npm run deaddrop -- --seed 7 --players 4               # print a scenario, its hands and the solution
npm run deaddrop -- --sim 200 --players 4              # bot games, competitive
npm run deaddrop -- --sim 200 --players 4 --mode coop --turn-limit 999
```

## What every player knows: the dossier

- **Suspects (8)**, each with visible traits: headwear, coat colour, height,
  handedness, glasses, gloves. Any two suspects differ in at least two traits.
- **The house (6 rooms)** with features (outdoors, crowded, quiet, dark,
  seating) and a map. Each hour a guest stays put or walks to an adjacent room.
- **Devices (6 of 13)**. Each one waits in a room, and the mole has to pass
  that room at or before the handoff. Each device also has one requirement:
  - a **room feature**: the umbrella only works outdoors, the hollow coin needs a crowd;
  - an **hour**: cigars only came out after 10pm;
  - a **courier trait**: the hatband needs a hat, the ledger needs a tall courier.
- **Hours**: 8pm–11pm.

These links between categories are where the extrapolation comes from. Learn
that the handoff was indoors and the umbrella is out. Learn the mole is
bareheaded and the hatband is out. Learn where someone was at 9pm and the map
limits where they could have been at 10pm, which limits which devices they
could have collected.

## Clues

Every clue is true, and every clue is data (`ClueBody`), so it can be
evaluated, rendered and sent over the wire:

| kind | example |
|---|---|
| `at` | Colonel Petrov was (not) in the Library at 9pm. |
| `never` | Nobody who wore a beret set foot in the Study all evening. |
| `moleTrait` | The mole wears a hat. / The mole does not wear a grey coat. |
| `handoffFeature` | The handoff happened somewhere without seating. |
| `handoffHour` | The handoff happened before 10pm. |
| `notRoom` / `notDevice` / `notAgent` | Dr. Moreau is not the mole. |

## Every game is generated, never sorted

A broken deal can't happen, because each scenario is built and then verified
by the solver:

1. Cast the suspects, hide the devices, pick the mole, then pick a route, device
   and hour that the dossier allows. Everyone else wanders the house at random.
2. List every true statement, and measure how much each narrows the answer.
3. Draw clues (preferring the kinds that need combining over ones that name a
   suspect outright) until exactly one answer remains. Then drop any clue the
   others already imply.
4. Pad with further true clues up to `players × handSize + 2 public`. The extras
   are partly redundant, so a trade can turn out to be worthless.
5. Deal, and reject the deal unless:
   - no hand alone leaves fewer than 4 answers;
   - no hand starts with more than twice the information of another;
   - at 4+ players, no two hands together solve it.

The generator is deterministic given a seed, and takes about 0.1–0.8 s.

## The solver

`Space` lists every possible world: mole × device × hour × the mole's whole
route through the house. That's about 45k worlds, and around 300 distinct
answers survive the dossier's rules. The solver is exact filtering over
bitsets. It gives:

- **remaining answers** and the **marginals** (how many answers each suspect,
  device, room and hour still appears in): the auto-filled notebook;
- **`explain`**: the clues that together rule a value out, for "why is this
  crossed out?";
- **`valueOf`**: how much a clue would tell someone, in bits. This can show
  how lopsided a trade was.

The host picks how much of this the app shows, as a house rule
(`GameConfig.assist`):
- `notes`: clues are filed and players cross things off by hand;
- `gauge`: also "N possible answers left", but not which;
- `grid` (default): the auto-filled grid. Tap a crossed-off value to see the
  clues that rule it out, and the accusation form comes prefilled once one
  answer remains.

## Cards, hands and rounds

Clues are cards worth **1, 2 or 3 points**, printed on them. Points come from
how much a clue cuts on its own, measured against the dossier, and are split
into thirds within each case so every game has a spread. "The handoff
happened somewhere outdoors" is a 3; "Dr. Moreau was in the Study at 9pm" is
a 1.

Your **hand** is what you can trade. Your **notebook** remembers every clue
you've ever seen, so trading or discarding a card doesn't make you forget
it.

The generator deals two public clues, a starting hand each, and a **deck**
twice the size of the starting hands. All of it together names exactly one
answer; the starting hands together must not.

A **round** is one turn for each player still in the running. At the end of
it everyone discards half their hand (rounded down), at the same time, and
draws the same number from the deck. New intelligence keeps arriving while
old cards stay in circulation.

**Discards go under the deck**, reshuffled. If they left play instead, a clue
discarded before anyone else had seen it would be gone for good, and the
case could become unsolvable for everyone. Simulations hit exactly that:
about a third of co-op games with no turn limit never got solved.

## Turns

On your turn you either **ask the table** or **accuse**.

1. Name **two subjects**: a suspect, look (trait), room, room feature, hour or
   device. Two subjects also hides which one a card is about.
2. Everyone else, at the same time, offers any cards from their hand about
   either subject, or nothing. The table sees only "Ivo offers 4 points on 2
   cards", never the subjects or contents.
3. The asker takes any offers they like, seeing the cards only once taken.
   Each taken offer is paid back with cards from the asker's hand worth **at
   least as many points**; fewer cards is fine, only the total counts. A card
   the other player has already seen still counts, if mean. Payback comes from
   the hand held before the trade, and each card pays one person.

- **Competitive**: first correct accusation wins. A wrong one puts you out of
  the running, but you still offer, trade and discard.
- **Co-op**: the same trading, with a shared turn limit and one accusation.

Who asked about what, and the size of every offer and payback, is public.

### Game length

Baseline bots (random open subjects, accuse only when certain; rivals get one
cheap card, teammates everything; discard the cheapest cards), median turns
across 30 games:

| players | competitive | co-op |
|---|---|---|
| 3 | 26 (≈9 each) | 24 (≈8 each) |
| 4 | 39 (≈10 each) | 38 (≈9.5 each) |
| 5 | 42 (≈8.5 each) | 44 (≈9 each) |

The co-op limit (`players × 8`) is set so these bots win a little under half
their games. People choosing their subjects should do better. It's still a
guess until humans have played.

### History

The first version had you ask one player about one subject, and they had to
answer. That needed a category fallback ("nothing on the Garden, so something
about places") because most questions came back empty. Asking the whole table
about two subjects, with voluntary offers and paybacks, replaced it; it's
closer to Awkward Guests and makes offering a decision.

## Open questions / next steps

- **Practice mode** is meant for testing more than for real games: the bots
  are the baseline ones (random questions, accuse only when certain), and
  "Peek" shows the answer. Smarter bots would make solo games a fairer test.
- Generation runs on the server's event loop (up to about 0.8 s at six
  players). That's fine for a household; move it to a worker if it ever isn't.
- **Smarter bots** to tune the co-op limit and hand sizes: for example, a bot
  that tracks who answered what and asks about the subjects of its own clues.
- **More content**: further house maps, a train or a casino, and more devices.
  Hidden traits or unreliable witnesses only once the base game is fun.
