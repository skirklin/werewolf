# Dead Drop

*Working title.* A deduction game in the family of Awkward Guests, with a spy
story. During an embassy reception a mole handed secrets to their handler.
The players trade intelligence to work out **who** the mole was, **what
device** they used, **where** and **when** the handoff happened.

This package is the engine only: content, scenario generator, solver, turn
rules and a baseline bot. It does not yet have a UI or a server hookup.

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

The plan is for the UI to offer this at different levels as a house setting:
- notebook only;
- a "N possibilities left" gauge;
- a full auto-filled grid with explanations.

## Turns

On your turn you either **ask** or **accuse**.

- **Ask** a player about a subject: a suspect, room, hour, device, trait or
  feature. They must hand you a clue about it that you don't already have, and
  they choose which. If they hold nothing on that exact subject, they must give
  something from the same *category* (people, places, times, devices), and the
  table sees that they did. If they hold nothing at all, that's public too, and
  your turn ends.
- **Competitive**: whoever gave you something may then ask you something back.
  First correct accusation wins. A wrong accusation puts you out of the running,
  but you still answer questions.
- **Co-op**: no asking back. The table shares a turn limit and one accusation.

Who asked whom about what is public, so a question tells everyone what you are
missing.

### Why the category fallback

Without it, bots asking about random subjects needed about 40–60 turns each:
there are 35 subjects and only about 5 clues per hand, so most questions came
back empty. With it, bot games take about 9–13 turns each and every game ends
in a correct solve:

| players | competitive, median total turns | co-op, median total turns |
|---|---|---|
| 3 | 26 | 28 |
| 4 | 46 | 50 |
| 5 | 63 | 68 |

The bots ask at random, so people who think about who to ask should be quicker.
The co-op turn limit (`players × 5`) is a provisional guess until humans have
played.

## Open questions / next steps

- **UI and server**: this needs the multi-game restructure (the `GameModule`
  split of rooms, lobby and protocol). The reducer and `projectView` here are
  already shaped for it. Pass-the-device works naturally with turns, since the
  device goes to whoever must answer.
- **Smarter bots** to tune the co-op limit and hand sizes: for example, a bot
  that tracks who answered what and asks about the subjects of its own clues.
- **Trade fairness**: should the giver have to match the value of what they
  received (Awkward Guests' point values, computed honestly by `valueOf`)?
- **More content**: further house maps, a train or a casino, and more devices.
  Hidden traits or unreliable witnesses only once the base game is fun.
