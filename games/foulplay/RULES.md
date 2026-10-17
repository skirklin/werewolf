# Foul Play: rules

These are the rules as built (in beta). Where a rule is still a guess, it's
marked **Open**, with the option the game currently uses.

Changed from the first draft while building: a turn is now investigate
*then* share, rather than one of the two, and each lead answers a specific
question rather than holding random evidence. Bot simulations showed that
with one action a turn, and evidence spread thin, the innocents almost never
had enough by dawn.

## The story

It is midsummer at Ashcombe Manor. Lord Edmund Ashcombe has thrown a party
and promised his guests an announcement at midnight. The rumour is that it's
a new will.

Midnight comes and Lord Ashcombe doesn't. At a quarter past twelve the butler
finds him dead at the foot of the grand staircase in the Hall.

He didn't die there. Someone killed him somewhere else in the house or
grounds and moved him to make it look like a fall. Whoever did it is still
at the party, and so is everyone who had a reason to want him dead. The
roads are flooded, so the inspector can't arrive until dawn. Until then the
guests investigate the death themselves, and one of them is lying.

### The cast

Every player is one of the guests, and every guest has a motive. Motives are
flavour: they never count as evidence.

| Guest | Motive |
| --- | --- |
| Lady Ashcombe | The new will was said to leave her nothing. |
| Julian Ashcombe | The nephew, who inherits under the old will. |
| Dr. Moreau | Owed Lord Ashcombe more than he could ever repay. |
| Mr. Okafor | His business partner, about to be bought out on bad terms. |
| Miss Tanaka | The secretary who typed the new will, so she knew what was in it. |
| Signor Bellini | The art dealer whose "Old Masters" Lord Ashcombe had begun to doubt. |
| Colonel Petrov | An old army friend who had been paying for his silence for years. |
| Madame Duval | The medium. Lord Ashcombe had promised to expose her as a fraud. |

Each guest's looks are fixed, the same every game, so you can learn the cast
like the characters in Clue:

| Guest | Hat | Coat | Height | Writes with | Glasses | Gloves |
| --- | --- | --- | --- | --- | --- | --- |
| Lady Ashcombe | none | red | short | right | no | yes |
| Julian Ashcombe | fedora | black | tall | left | no | no |
| Dr. Moreau | none | grey | tall | right | yes | yes |
| Mr. Okafor | fedora | camel | tall | right | no | yes |
| Miss Tanaka | beret | black | short | left | yes | no |
| Signor Bellini | beret | camel | short | right | yes | yes |
| Colonel Petrov | none | grey | tall | left | no | no |
| Madame Duval | beret | red | short | right | yes | no |

Each trait splits the cast roughly in half, and no two guests share more
than four of the six traits.

What changes from game to game is the evidence. The generator first picks
the killer, the weapon and the room, then writes evidence that fits them.
For example, if Petrov did it, the body might show he was strangled by
someone tall, or a waiter might remember a grey coat on the Terrace. Only
the guests actually at the table are suspects, so the evidence only has to
tell those players apart.

### What the table is solving

The case has three parts:

- **Who:** one of the players.
- **With what:** one of nine weapons from around the house.
- **Where:** the real scene, one of six rooms. The Hall is never the answer,
  because the body was moved there.

To win, the innocents have to name all three. Catching the right person
with the wrong weapon or the wrong room isn't enough. The three parts are
linked, so each helps you find the others. The weapon has to fit the room (the revolver needs a crowded room to
hide the shot; the garden shears are kept outdoors), and the body carries
traces of the real scene (mud on his shoes, ash on his sleeve). Some weapons
also need a particular kind of person: only someone tall could have swung
the candlestick, and only someone in gloves could have handled the poison
without leaving a mark.

## Roles

- **The killer.** Always one of the players, chosen at random and in secret.
  The killer's screen shows the full truth.
- **The accomplice.** Used at 6 or more players, and optional at 5. They know
  who the killer is but not the weapon or the room. They win with the
  killer, can tamper and plant like the killer, but cannot strike.
- **Everyone else is innocent.** They know they didn't do it, and that's
  all.

**Open:** should the killer sometimes be one of the staff rather than a
player? My suggestion for version 1 is that the killer is always at the
table. A "nobody here" variant could come later, once the always-at-table
version plays well.

## Cards

A card is one fact, and every card shows where it came from:

- *"Starting memory: Miss Tanaka."*
- *"Questioned the staff about the Library: drawn by Sam, night 2."*

| Kind | Where it comes from | What it's about |
| --- | --- | --- |
| Memory | Your starting hand | What your character remembers seeing. |
| Testimony | Questioning the staff about a room | Who was or wasn't seen there. |
| Alibi | Checking a player's alibi | Where that guest was. |
| Forensics | Examining the body | The killer's looks; what kind of room it happened in. |
| Scene | Searching a room | Whether this is the real scene; whether anything is missing from here. |

All cards are true, except forgeries. A forgery looks exactly like a true
card, including its claimed source.

### Talk is free; cards are proof

You can say anything, to anyone, at any time: what you found, what you
suspect, who you think is lying. Nothing you say is checked, and the killer
will lie. Playing apart, you'll need a call; the app has no chat.

A card is proof. Your notebook records every card you have *seen*, but only
cards you *hold* can be shown, and a shown card carries where it came from.
That's the difference between "I checked Petrov's alibi and it clears him"
and putting the card down where everyone can read it. So the real moves are:

- **Claim**, out loud, as much as you like.
- **Ask for proof.** "Then testify it." Refusing, or burning a card, looks bad.
- **Prove it**, by testifying or conferring (see below), when it's worth a
  turn's share.

When the table is down to two or three suspects, the argument is about
what you can prove and where your proof came from.

## Setup

1. Deal the characters, one per player.
2. Generate the case:
   - Pick the killer, the weapon and the scene. The weapon has to fit the
     killer's looks and the room.
   - Decide where every guest went during the evening.
   - Write the evidence to fit all of that.
3. Prepare a small stack of evidence for each lead (see Investigate below).
   Most leads have 1–3 cards; some leads have nothing.
4. Deal the starting hands:
   - **Innocents:** 3 true memory cards each.
   - **Killer:** 2 harmless true memories and the full truth on their
     screen. They also get a choice of forgeries (see The killer's tools).
5. The first player is chosen at random. Play goes clockwise.

The generator guarantees three things:

- All of the true evidence together points to exactly one answer.
- The case can be solved without anything the killer holds.
- Every forgery contradicts the truth somewhere, so a forgery can always be
  caught in principle.

## A night

The night lasts **3 rounds**. In each round, every living player takes one
turn. A turn has two steps.

### 1. Investigate

Choose a lead and draw its top card into your hand. Only you see the card.
The table sees which lead you followed, for example "Sam questioned the staff
about the Library". Each lead answers its own question:

- **Examine the body:** the killer's looks, and what kind of room it happened
  in (mud on his shoes: outdoors).
- **Question the staff** about a room: every guest who set foot there all
  evening, and so also who never did. Not every room's staff have something
  to say.
- **Check an alibi:** exactly where that guest went all evening. Not every
  guest's can be checked.
- **Search a room:** whether this is where it happened, and then, on a
  second look, whether the weapon kept there is still in its place or
  missing.

Most leads hold one card, so once someone has followed a lead, the next
person usually finds nothing: *"Search the Library: nothing more to find
there."* That's information too. When a lead still has something left after
your draw, you're told so (privately): *"There's more to find there."* The
body and a room search usually do.

Instead of investigating, you can **call an inquest** (see below).

### 2. Prove something, if you like

Talking is free and needs no turn. Proof does. Then do one of these, or
keep your cards to yourself:

- **Testify.** Put one card from your hand face up in the **public record**.
  Everyone reads the card itself, with its source printed on it. It's the
  only way to prove something to the whole table, and the card leaves your
  hand.
- **Confer.** Prove a card to one player: show it to them, and they show you
  one back. Both cards stay where they were. The table sees that you
  conferred, not what was shown, so what either of you says about it
  afterwards is only your word again.

### Calling an inquest

Name the full answer: who, with what, and where. Everyone still alive votes
yes or no.

- **More than half of the living vote yes:** the accusation stands and the
  game ends. It's right only if all three parts are right. A split vote (2–2
  with four alive) fails. The caller votes too.
- **The vote fails:** play carries on. The player who called the inquest
  can never call one again.

### Hand limit

The hand limit is 4. If you end your turn holding more than that, you must
either testify or **burn** one card. Burning destroys it for good, and the
table sees that you burned something.

## The killer's tools

### Cover

The killer takes the same turns as everyone else: investigating, conferring
and testifying. They already know the answer, so every action they take is
for show, or for steering the table.

### Tampering

Whenever the killer or the accomplice investigates, they may tamper with the
lead instead of drawing from it. The table sees exactly what it would see
for an honest investigation. Tampering is one of two moves:

- **Bury.** Move the lead's top card to the bottom of its stack. The next
  person to follow that lead finds something else, or nothing.
- **Plant.** Put a forgery on top of the lead's stack. The next person to
  follow that lead draws it, and the card's source shows *their* name.

### Forgeries

At the start of the game, the killer chooses 2 forgeries from a menu of
about 4. A forgery can point the table at the wrong person, the wrong
weapon or the wrong room. Since the innocents need all three, a cheap
misdirection about the weapon can be as good as framing someone. For
example: *"The cook saw Dr. Moreau carrying something wrapped in a towel
towards the Terrace."*

The accomplice gets 1 forgery of their own.

A forgery can be caught in two ways:

- **Contradictions.** If a forgery and true cards a player has seen can't
  all be true, their notebook says so and shows the smallest set of cards
  that clash. The player can then mark the card they doubt, and their
  notebook sets it aside.
- **Chain of custody.** A planted card was drawn by an innocent, but someone
  followed that same lead just before them. The public log shows who.

### Striking again

Once per game, the killer may strike a second time.

1. During their turn, the killer secretly marks a victim. To keep this
   hidden, every player gets a "night" prompt at the end of each round, and
   only the killer's answer counts.
2. At the end of the round, the victim is found dead. They are out of the
   game: they can't act or vote.
3. The victim's whole hand goes into the public record.
4. The second body is a new lead to examine. It has its own small stack of
   true forensics about the killer.

Striking silences someone who was getting close, but it leaves fresh
evidence behind.

## Dawn

After the third round, the inspector arrives.

1. **Discussion.** The table argues it out, out loud. The app has no chat
   yet, so playing apart needs a call.
2. **Vote.** The table builds one accusation in three votes: first who,
   then with what, then where. Each is a secret vote by every living
   player, and the most votes wins.
   - On a tie, there is one revote among the tied options only.
   - If it's still tied, the inspector picks one of them at random.
   - The table sees every vote's count, not just the winner.

   The killer and the accomplice vote too. Pushing the table toward the
   wrong weapon is as good for them as pushing it toward the wrong person.

## Winning

- **The innocents win** if the accusation, at dawn or by an inquest, gets
  all three right: the killer, the weapon and the room.
- **The killer, and the accomplice if there is one, win** if any part is
  wrong, or if the table can't settle on an accusation. Naming the
  accomplice is simply a wrong answer.

### The reveal

After the game, the table sees the full story:

- Who did it, with what, and where.
- How the body got to the Hall.
- Every forgery and where it was planted.
- Every bury.
- Each guest's evening, room by room.

## By player count

| Players | Accomplice | Rounds | Killer's forgeries |
| --- | --- | --- | --- |
| 4 | No | 3 | 2 |
| 5 | Optional (off by default) | 3 | 2 |
| 6–8 | Yes | 3 | 2, plus 1 for the accomplice |

## Tuning targets

Checked with bot simulations (`npm run foulplay -- --sim 150 --players 5`):

- The killer should win **35–45%** of games between people. Against the
  baseline bots, which play worse than people, the killer currently wins
  about 45% at 5 players and 50–63% at 4 and at 6–8.
- Going into dawn, the evidence the table has made public should usually
  still allow **2–3 possible answers**. It does: the median is 2–3.
- A turn should take under a minute.

## Open questions

1. **How the dawn accusation is built.**
   - *Start with:* three separate votes, for who, then with what, then
     where.
   - *Alternative:* everyone writes down a full accusation, and the one
     written most often stands. That's harder for the innocents, because a
     split on the weapon splits the whole vote.
2. **The inquest threshold.**
   - *Start with:* a majority of living players.
   - *Alternative:* everyone except the accused.
3. **What a failed inquest costs.**
   - *Start with:* the caller loses their turn and can't call another.
   - *Alternative:* the caller can't vote at dawn either.
4. **Burying.**
   - *Start with:* burying is unlimited, because each bury costs the killer
     their turn.
   - *Alternative:* if it turns out too strong in simulation, cap it at 2
     per game.
5. **The length of the night.**
   - *Start with:* 3 rounds at every player count.
   - *Alternative:* 4 rounds at 4 players.
6. **Character abilities.**
   - *Start with:* leave them out of version 1, then add one
     once-per-game ability per guest. Ideas:
     - Dr. Moreau: examine the body and draw a card that is guaranteed
       true.
     - Signor Bellini: test whether one card is genuine.
     - Miss Tanaka: peek at one card in a player's hand.
     - Lady Ashcombe: search a room and draw two cards.
     - Colonel Petrov: make a player testify.
     - Mr. Okafor: count how many forgeries are in a player's hand.
