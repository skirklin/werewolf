# Foul Play: rules (every guest has a story)

These are the rules as built, in beta.

This is the fourth version. The first was a trading game in the style of
Awkward Guests. The second had leads and forgeries. The third was a race
through the house that ended on its own: the innocents won the moment the
record proved the answer, and the killer won once it no longer could.
Playtests of the third showed the problems with that. The game could end
before anyone at the table had worked anything out. A killer who sees every
card could make the case unprovable in a single round. And anyone burning a
card was obviously guilty. Inspired by the film *Clue*, this version gives
every guest a believable story, lets everyone destroy evidence, and leaves
the verdict to the table.

## The idea

Lord Ashcombe is dead, one of you did it, and the evidence is still lying
around the house. **The house tells a story about every guest**: a weapon
they could have used, and a room they were in that fits. Only the killer's
story is true.

- **The killer** knows everything, including where every card is. They win
  by pinning the murder on someone else: they destroy the cards that break
  an innocent's story, then get the table to accept that story.
- **The innocents** each know their own story and that it isn't true.
  Somewhere in the house are the cards that break it. They want those on the
  record, and they want the real story found.
- **Anyone can burn a card.** An innocent might burn a sighting that fits
  their own story. So a card that goes missing is no longer proof of guilt.

Every step is taken by one player at a time, so the game works when you pass
a single device around.

## Stories and evidence

- **Your story** is shown on your role card, along with where you went this
  evening. For example: "Mr. Okafor, with the rope, in the Library". Every
  story is consistent with the guest's looks, the weapon's demands and where
  that guest really went.
- **Cards that break a story.** Each innocent's story is broken by two or
  three cards:
  - an **alibi** ("The chauffeur was playing cards with Mr. Okafor the whole
    time"), sometimes from two witnesses;
  - "the murder didn't happen in the Library", if that isn't the real room;
  - "no trace on the rope", if that isn't the real weapon.

  None of these are in the Hall or in anyone's memory, so all of them can be
  destroyed. The true story is broken by nothing.
- **Cards that fit a story.** Sightings, such as "A maid saw Mr. Okafor
  slip out of the Library just before midnight". They're true and prove
  nothing, but they look bad. These are the cards an innocent may want to
  burn.
- **Other evidence.** Who set foot where, a guest's whole evening, and the
  body's evidence in the Hall.
- **All of it is true.** Every card in the game is true. Players can lie;
  cards can't.

## Playing a round

Each round, every living player takes one turn in seat order, then the night
comes.

### Your turn

1. **Move:** stay, go to any room, or **join another player** where they
   are. Everyone sees where everyone is, and how many cards are left in each
   room.
   - **Or, instead of moving, call the Reconstruction** (below).
2. **Act:** **search** (take the top card of the room's stack) or **keep
   watch**.
   - If anyone else is in the room, your find goes straight onto the
     **public record**.
   - If you're alone, it goes into your hand, unseen.
3. **Testify or burn** what you hold. Both are free. Testifying puts the
   card on the record. Burning destroys it and nobody sees it happen; the
   table only sees that you found something and didn't testify it.
4. **Talk** at any time. Nothing you say is checked.

### The night

The device goes round the table and everyone taps through, so nobody can
tell who chose. The killer may:

- **murder** a guest who is alone (once a game). The killer needn't be in
  the room and needs no weapon: being alone is all it takes. The body leaves
  new evidence about the killer, plus whatever the victim carried;
- **destroy** the top card in an empty room;
- or do nothing.

The dead don't talk or vote, and nobody can be accused once dead.

## The Reconstruction

Once a game, instead of moving, a player gathers everyone and names **who,
with what, and where**. Everyone alive then answers yes or no. The answers
are shown once everyone has given one.

- **Most say yes:** that's the verdict. Right, and the innocents win; wrong,
  and the killer and accomplice win.
- **Otherwise:** play goes on, and the caller's turn and call are spent.

The game never ends just because the evidence adds up: someone has to see
it and convince the table. The killer can call one too, to frame someone.

## How it ends

- **A Reconstruction is accepted** (see above).
- **The guilty are no longer outnumbered:** the killer wins.
- **Dawn:** if nobody has convinced the table by the end of round 6, it
  votes on who, then with what, then where. The most votes wins each part.
  On a tie it votes again between the tied options, and if they tie again
  the inspector picks.

## What makes it tick

- **Where you are is evidence.** "You were alone in the Library and its
  count dropped, and you testified nothing." Joining someone protects you
  and keeps an eye on them.
- **Burning is no longer a confession.** Innocents burn sightings that fit
  their own story, so the killer's burns hide among theirs. What still
  stands out is which cards go missing: an alibi that never turns up, or a
  room's "not here" card that should be in it.
- **The killer has to work for a frame.** Destroying two or three cards
  means being alone, in rooms everyone can see, more than once.
- **The table is the judge.** The record rarely settles everything by
  itself. The Reconstruction rewards whoever tells the most convincing
  story, and the killer will try to.
- **Your notebook is your own.** The board is a sheet you mark yourself.
  The app never says "solved".

## Tuning

Against the baseline bots (`npm run foulplay -- --sim 100 --players 5`), the
killer wins about 55–70%. The bots don't talk and don't reason about who was
alone where or which counts dropped, and that is the innocents' best
evidence, so people should do better. The target is about 40–50% between
people. The main dials are in `generate.ts`:

- how often stories share the real room or weapon (`shareChance`);
- how much extra evidence is dealt;
- how many cards break each story.
