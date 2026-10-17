# Foul Play v3: rules draft (a race through the house)

This is a draft for discussion, and none of it is built yet. The current
rules are in [RULES.md](RULES.md). Rules that are still a guess are marked
**Open**, with the option I'd start with.

## The idea

The story and cast stay as they are. Lord Ashcombe is dead, one of you did
it, and the evidence is still lying around the house.

What changes is that the night becomes a **race**:

- **The innocents** search the house for evidence. They don't know where it
  is.
- **The killer** knows exactly where every piece of evidence is, and works
  to destroy enough of it that the case can never be proved.

Where everyone is matters. Each player is always in a room, everyone can see
who is where, and three rules follow from that:

- The killer can only destroy evidence when no innocent is watching.
- A guest can only be murdered when they're alone.
- Staying with someone keeps you safe and keeps an eye on them, but costs
  you your search.

Every step is taken by one player at a time, so the game works when you pass
a single device around.

## The house and the evidence

- **The rooms.** The six rooms of the manor. Each holds a small face-down
  stack of evidence, 0–3 cards.
- **Where the evidence is.** The generator spreads it out so that the case
  can be proved more than one way. That way no single destroyed card ends
  the game, but destroying enough of them does.
- **The killer's knowledge.** The killer sees every room's stack: what each
  card says and how much it would hurt them.
- **What everyone else sees.** The innocents only see **how many cards are
  left in each room**.

## Playing a round

Each round, every living player takes one turn in seat order, and then the
night comes.

### Your turn

**1. Move.** Choose one of these:
- Stay where you are.
- Go to any room.
- **Join another player** and go to the room they're in.

Everyone sees where you go. Each player's current room is always shown.

**2. Act in your room.** Choose one of these:

- **Search.** Turn over the top card of the room's stack. The card goes
  straight onto the **public record** for everyone to read.
- **Keep watch.** Do nothing yourself.
  - While an innocent is keeping watch in a room, nobody can destroy
    evidence there.
  - A guest who is keeping watch, or who is being watched, isn't alone, so
    they can't be murdered that night.
- **Destroy (killer only, and only if no innocent is in the room).** Remove
  one card from the room's stack without anyone seeing it. The room's card
  count drops by one.
  - **Open:** should the accomplice be able to destroy too? I'd start with
    yes, at one card per round.
  - **The trace:** the table sees the count drop. "There were 3 cards in the
    Library, Petrov was alone in there, and now there are 2" is the
    deduction.

**3. Talk.** Talking is free at any time, and nothing anyone says is
checked. The public record is the only proof.

### The night

After everyone has taken a turn, the house goes dark.

- **Choosing.** The device goes round the table, and every player taps
  through a night screen so nobody can tell who made a choice. Only the
  killer's choice counts. They pick one of these:
  - **Murder** one guest who is **alone in a room**. The killer needn't be
    there; they slip out in the dark.
  - **Destroy** one card in an **empty room**. Unlike daytime destruction,
    this leaves no trail to a person.
  - **Do nothing.**
- **In the morning.**
  - A murder is announced, along with the room it happened in.
  - The dead player is out of the game and can't talk.
  - **Open:** should the body be new evidence, the way the second body works
    now? I'd start with yes: one true card about the killer, placed in that
    room.
- **Who counts as alone:** a guest who is the only person in their room, or
  who shares it only with the killer or accomplice.
  - So being alone with the killer is deadly.
  - But a murder in a room that held only the victim and one other person
    points straight at that person. The killer has to weigh that.

## How it ends

There's no fixed length. The game ends as soon as one side has won.

**The innocents win:** the moment the **public record proves the whole
answer** (who, with what, and where), the inspector arrives and makes the
arrest. The solver checks this automatically. Nobody has to vote, and nobody
can argue their way past proof.

**The killer and accomplice win if either of these happens:**
- **The case can't be proved any more.** The record plus every card still in
  the house no longer names one answer. The solver checks this after every
  destruction.
- **The guilty are no longer outnumbered.** They are at least as many as the
  living innocents.

**Open:** should there be a safety valve if neither side gets there by
round 6? I'd start with a dawn vote on who, then with what, then where, like
the current dawn. In practice the race should usually end before then.

**Open:** should anyone be able to accuse early? I'd leave it out to start
with. The proof rule makes accusations unnecessary, and leaving them out
keeps the game simple.

## What makes it tick

- **Search against watch.** Innocents who all stay with someone are safe,
  but find nothing, and the killer destroys evidence elsewhere in peace.
  Innocents who all search are fast, but they're exposed at night and the
  killer moves freely.
- **The killer has to show up.** Destroying evidence in daylight means
  moving alone to the room that holds it, in front of everyone. Destroying at
  night is safe, but costs a murder, and only works on empty rooms.
- **Following someone is an accusation.** "Why do you keep joining me?"
  Using the join move against people you suspect is half the social game.
- **Locations are the clues to the second murder.** Who was alone where,
  who left whom, which room's count dropped while who was in it.

## Compared with the current version

**Dropped:**
- Forgeries and planting.
- Burying.
- Hand limits and burning.
- Conferring.
- Fixed rounds.
- The dawn vote, which becomes at most a fallback.
- Starting memories. **Open:** perhaps keep one memory card each, so every
  player starts with something to say.

**Kept:**
- The story and the cast with fixed looks.
- Generated cases checked by the solver.
- The public record, chain of custody (who was where when a card turned up),
  practice mode with bots, and the BETA label.

**New:**
- Player locations, moving and joining.
- Searching rooms, keeping watch and destroying evidence.
- Card counts per room.
- The night phase.
- Proof-based arrest and the solver-checked "no longer provable" loss.

## Tuning targets

- **Length:** usually over within **4–6 rounds**, with about 20–30 turns at
  5 players.
- **Balance:** the killer wins about **40%** of games between people.
- **Variety:** each side should regularly win both ways. That means the
  innocents sometimes get proof early and sometimes win in the last round,
  and the killer sometimes wins by destroying evidence and sometimes by
  killing.
