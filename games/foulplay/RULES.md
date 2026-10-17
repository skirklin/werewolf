# Foul Play: rules (a race through the house)

These are the rules as built, in beta. Rules that are still a guess are
marked **Open**, with the option the game uses for now.

This is the third version. The first was a trading game in the style of
Awkward Guests; the second had leads, forgeries and a three-round night.
Playtests showed the second leaned too hard on forged cards and gave nobody
a reason to watch anyone, which is what this version is built around.

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

- The killer can only destroy evidence when nobody else is in the room.
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

- **Search.** Take the top card of the room's stack.
  - **With anyone else in the room:** everyone there sees it, and it goes
    straight onto the **public record**. A witness makes evidence public.
    (It has to be anyone, not just innocents. Otherwise a find that stayed
    private would give away that your companion is guilty.)
  - **Alone:** the card goes into your hand,
    privately. You can **testify** it onto the record at any point in your
    turn, which is free. Until you do, all you can offer is your word.
- **Keep watch.** Do nothing yourself.
  - While an innocent is keeping watch in a room, nobody can destroy
    evidence there.
  - A guest who is keeping watch, or who is being watched, isn't alone, so
    they can't be murdered that night.
- **Destroying, for the guilty.** The killer and the accomplice destroy
  evidence by searching alone and then quietly **burning** the card.
  - Burning is free, and nobody sees it.
  - From the outside it looks just like an innocent searching alone and
    keeping their find to themselves. So "what did you find in the
    Library?" is the question the table has to press.

**3. Talk.** Talking is free at any time, and nothing anyone says is
checked. The public record is the only proof.

### The night

After everyone has taken a turn, the house goes dark.

- **Choosing.** The device goes round the table, and every player taps
  through a night screen so nobody can tell who made a choice. Only the
  killer's choice counts. They pick one of these:
  - **Murder** one guest who is **alone in a room**. The killer needn't be
    there; they slip out in the dark. **Once a game**: simulations showed
    that a murder every night simply thins the table until the guilty win.
  - **Destroy** one card in an **empty room**. Unlike daytime destruction,
    this leaves no trail to a person.
  - **Do nothing.**
- **In the morning.**
  - A murder is announced, along with the room it happened in.
  - The dead player is out of the game and can't talk.
  - The body is new evidence: one true card about the killer is placed in
    that room, together with whatever the victim was carrying.
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

If neither side has won after round 6, the inspector arrives at dawn and
the table votes on who, then with what, then where, as a safety valve. In
practice the race usually ends before then.

No early accusations: proof does that job.

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

## Tuning

Against the baseline bots (`npm run foulplay -- --sim 100 --players 5`), the
killer wins about 30–60% depending on table size, most games end in rounds
3–5, the innocents mostly win by proof and the killer mostly by destroying
evidence. The bots don't talk, shadow suspects or reason about who was where,
so people should do better on both sides.

Targets:

- **Length:** usually over within **4–6 rounds**, with about 20–30 turns at
  5 players.
- **Balance:** the killer wins about **40%** of games between people.
- **Variety:** each side should regularly win both ways. That means the
  innocents sometimes get proof early and sometimes win in the last round,
  and the killer sometimes wins by destroying evidence and sometimes by
  killing.
