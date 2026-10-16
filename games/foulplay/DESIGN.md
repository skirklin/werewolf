# Foul Play

A deduction game in the family of Awkward Guests. Lord Ashcombe was found
dead during his own party at Ashcombe Manor. The players trade evidence to
work out **who** the killer was, **which weapon** they used, and **where** the
murder happened.

This package is the engine: content, scenario generator, solver, turn rules
and a baseline bot, exported to the platform as `foulplayModule`. The screens
live in `packages/client/src/games/foulplay/`. Play it from the game picker,
each player on their own phone, or practise on one device: a solo game
against bots, or pass-the-device when more than one seat is a person.

```bash
npm run foulplay -- --seed 7 --players 4               # print a case, its hands and the solution
npm run foulplay -- --sim 200 --players 4              # bot games, competitive
npm run foulplay -- --sim 200 --players 4 --mode coop --turn-limit 999
```

## Theme and engine

The engine doesn't know it's a murder. It knows **suspects** with traits
(`agents`), **rooms** with features, and **items** (`devices`) each kept in a
room with one requirement; the answer is a suspect, an item and a room (the
"act" happens there). Everything players read comes from the content set in
`content.ts`: the `Theme` words ("the killer", "the murder", "weapon"), and
evidence sentences on each trait value and room feature. Another setting is
another content set. Some identifiers (`moleTrait`, `handoffFeature`) are
left over from the first, spy-themed draft; see History.

## What every player knows: the case file

- **Suspects (8)**, each with visible traits: headwear, coat colour, height,
  handedness, glasses, gloves. Any two suspects differ in at least two traits.
- **The house (6 rooms)** with features (outdoors, crowded, quiet, dark,
  seating). Every guest visited between two and four rooms over the evening.
- **Weapons (6 of 9)**. Each one was kept in a room, which the killer must
  have visited to take it. Each one also only fits some murders:
  - a **room feature**: a revolver shot would be heard anywhere quiet, so it
    happened somewhere crowded; garden shears mean outdoors;
  - a **killer trait**: a candlestick blow to the top of the head needs a tall
    killer; a wiped-clean poison vial means the poisoner wore gloves.
- The murder happened in a room the killer visited.

These links are where the extrapolation comes from. Mud on the victim's shoes
means outdoors, so not the revolver. The wound was struck from the left, Ruiz
is left-handed, and the staff swear Ruiz never set foot in the Study, where
the letter opener was kept.

## Clues are evidence

Every clue is true, has a source you can picture, and is data (`ClueBody`),
so it can be evaluated, rendered and sent over the wire:

| kind | example |
|---|---|
| `visited` | The butler saw Colonel Petrov in the Library. / The staff swear he never set foot there. |
| `never` | The staff swear nobody who wore a beret set foot in the Study. |
| `moleTrait` | Red wool fibres were found on the body: the killer wears a red coat. |
| `handoffFeature` | There was mud and grass on the victim's shoes: the murder happened outdoors. |
| `notRoom` | The Garden was searched top to bottom: the murder didn't happen there. |
| `notDevice` | No trace on the candlestick: not the weapon. |
| `notAgent` | Dr. Moreau has a solid alibi: not the killer. |

## Every game is generated, never sorted

A broken deal can't happen, because each scenario is built and then verified
by the solver:

1. Cast the suspects, place the weapons, pick the killer, then pick a weapon,
   room and evening (rooms visited) that the case file allows. Everyone else visits a
   random few rooms.
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

`Space` lists every possible world: killer × weapon × room × the set of rooms
the killer visited. That's about fourteen thousand worlds, and roughly
100–150 distinct answers survive the case file's rules. The solver is exact filtering over
bitsets. It gives:

- **remaining answers** and the **marginals** (how many answers each suspect,
  weapon and room still appears in): the auto-filled board;
- **`explain`**: the clues that together rule a value out, for "why is this
  crossed out?";
- **`valueOf`**: how much a clue would tell someone, in bits. This can show
  how lopsided a trade was.

The host picks how much of this the app shows, as a house rule
(`GameConfig.assist`):
- `grid` (default): the auto-filled board. Tap a crossed-off value to see the
  clues that rule it out, and an accusation comes prefilled once one answer
  remains.
- `notes`: clues are filed and players cross things off the board by hand.

A gauge-only level ("N answers left", but not which) was tried and dropped:
you can't choose sensible trades without tracking what you know.

The board is also where you pick on your turn: two subjects to ask about, or
who, how and where to accuse.

## Cards, hands and rounds

Clues are cards worth **1, 2 or 3 points**, printed on them. Points come from
how much a clue cuts on its own, measured against the dossier, and are split
into thirds within each case so every game has a spread. "Mud on the
victim's shoes: outdoors" is a 3; "the butler saw Dr. Moreau in the Study" is
a 1.

Your **hand** is what you can trade. Your **notebook** remembers every clue
you've ever seen, so trading or discarding a card doesn't make you forget
it.

The generator deals two public clues, a starting hand each, and a **deck**
twice the size of the starting hands. All of it together names exactly one
answer; the starting hands together must not.

A **round** is one turn for each player still in the running. At the end of
it everyone discards half their hand (rounded down), at the same time, and
draws the same number from the deck. New evidence keeps arriving while
old cards stay in circulation.

**Discards go under the deck**, reshuffled. If they left play instead, a clue
discarded before anyone else had seen it would be gone for good, and the
case could become unsolvable for everyone. Simulations hit exactly that:
about a third of co-op games with no turn limit never got solved.

## Turns

On your turn you either **ask the table** or **accuse**.

1. Name **two subjects**: a suspect, look (trait), weapon, room or room
   feature. Two subjects also hides which one a card is about.
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
| 3 | 14 (≈5 each) | 14 (≈5 each) |
| 4 | 21 (≈5 each) | 19 (≈5 each) |
| 5 | 25 (≈5 each) | 24 (≈5 each) |

Dropping the hours roughly halved these (from 8–10 turns each). If cases now
feel too easy, more suspects or weapons would grow them without bringing time
back. The co-op limit (`players × 5`) is set so these bots win about half
their games. People choosing their subjects should do better. It's still a
guess until humans have played.

### History

Foul Play started as **Dead Drop**, a spy game: a mole passing secrets with a
concealment device (an umbrella, a hatband). The device rules were arbitrary
("the umbrella only works outdoors") and a secret handoff leaves no evidence
by design, so the clues read as bare facts. A murder leaves a body, fibres,
fingerprints and a missing weapon, so the same engine reads as detective
work.

An earlier version also asked *when*, with an hour-by-hour route for every
guest; it was dropped as more bookkeeping than fun.

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
- **More content**: other houses, a train or an ocean liner, and more weapons.
  Hidden traits or unreliable witnesses only once the base game is fun.
