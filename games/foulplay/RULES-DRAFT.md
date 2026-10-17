# Foul Play: rules draft (hidden-killer version)

This is a draft for discussion. Nothing in it is built yet. Where a rule is
still a guess, it's marked **Open**, with the option I'd start with.

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

Each game deals every guest a random look: hat, coat, height, writing hand,
glasses and gloves. Who matches the evidence therefore changes from game to
game.

### What the table is solving

The case has three parts:

- **Who:** one of the players.
- **With what:** one of nine weapons from around the house.
- **Where:** the real scene, one of six rooms. The Hall is never the answer,
  because the body was moved there.

Only *who* is voted on at the end. *With what* and *where* are how you get to
*who*: the weapon has to fit the room (the revolver needs a crowded room to
hide the shot; the garden shears are kept outdoors), and the body carries
traces of the real scene (mud on his shoes, ash on his sleeve).

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
| Forensics | Examining the body | The killer's looks; what the weapon was or wasn't. |
| Scene | Searching a room | Whether this is the real scene; whether anything is missing from here. |

All cards are true, except forgeries. A forgery looks exactly like a true
card, including its claimed source.

### Knowing versus proving

Your notebook automatically records every card you have *seen*. It tracks
what is still possible, and it flags contradictions.

Only cards you *hold* can be shown to the table. That's the difference
between telling the table "I saw an alibi card clearing Petrov" and putting
the card down where everyone can read it. When the table is down to two or
three suspects, the argument is about what you can prove and where your
proof came from.

## Setup

1. Deal the characters, one per player, with random looks.
2. Generate the case: the killer, the weapon, the scene, and where every
   guest went during the evening.
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
turn. On your turn you do exactly one thing.

### 1. Investigate

Choose a lead and draw its top card into your hand. Only you see the card.
The table sees which lead you followed, for example "Sam questioned the staff
about the Library".

The leads are:

- **Question the staff** about a room.
- **Check an alibi** of another player.
- **Examine the body.**
- **Search a room.**

When a lead runs dry, you learn that instead: *"The staff have nothing more
to say about the Library."* That's information too.

### 2. Confer

Choose another player. Each of you secretly picks one card from your hand,
and you show them to each other at the same time. Both cards stay where they
were: you each learn the other's fact, but you can't prove it.

The table sees who conferred with whom, but not what was shown.

### 3. Testify

Put one card from your hand face up in the **public record**. Everyone's
notebook takes it in, and the card's source stays printed on it.

### 4. Call an inquest

Name a player. Everyone still alive votes yes or no.

- **A majority votes yes:** that player is arrested and the game ends.
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
about 4. Each forgery points toward a different innocent, for example *"The
cook saw Dr. Moreau carrying something wrapped in a towel towards the
Terrace."*

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

1. **Discussion.** The table can argue, testify and show cards. In person
   this is untimed. Online there is a 3-minute timer and a chat.
2. **Vote.** Each living player secretly names one player. The player with
   the most votes is arrested.
   - On a tie, there is one revote among the tied players only.
   - If it's still tied, nobody is arrested. That counts as the killer
     getting away.

## Winning

- **The innocents win** if the killer is arrested, either at dawn or by an
  inquest.
- **The killer, and the accomplice if there is one, win** if anyone else is
  arrested, or if nobody is.
- **If the accomplice is arrested, the killer wins.** The inspector has their
  arrest and closes the case.

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

I would check these with bot simulations, the same way as the current game:

- The killer wins **35–45%** of games.
- Going into dawn, the evidence the table has made public should usually
  still allow **2–3 suspects**. The evidence everyone has privately seen,
  pooled together, should usually solve the case. The gap between the two
  is the game.
- Under 1 in 10 games end at a dawn tie.
- A turn should take under a minute. Most turns are one tap plus a moment
  to read a card.

## Open questions

1. **What an inquest names.**
   - *Start with:* just the person, the same as the dawn vote.
   - *Alternative:* the full answer of who, weapon and room. That's harder
     to get right, so an early win would mean more.
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

## What carries over from the current game

**Kept:**

- The case generator and solver, re-aimed at players instead of a separate
  suspect list.
- The looks, weapons, rooms and room features.
- The automatic notebook and board.
- Card provenance.
- Practice mode with bots.

**Dropped:**

- Points, offers and paybacks.
- The discard and redraw rounds.
- Co-op mode. The killer is now the opponent.

**New:**

- Roles.
- Leads, with their own evidence stacks.
- The public record.
- Contradiction detection.
- Tampering, forgeries and the second strike.
- Inquests and the dawn vote.
- Chat for online play, reusing Werewolf's.
