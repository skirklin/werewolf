import { useState } from "react";
import type React from "react";
import type { Answer, PlayerView } from "@party/foulplay";
import { looks, seatName } from "./text.js";

/** "🗡️ Means: rope · 📌 Opportunity: Library": the case against a guest at a glance. */
export function CaseChips({ view, against, short }: { view: PlayerView; against: Answer; short?: boolean }) {
  const d = view.dossier;
  return (
    <span className="chips">
      <span className="pill">🗡️ {short ? "" : "Means: "}{d.devices[against.device].name}</span>
      <span className="pill">📌 {short ? "" : "Opportunity: "}{d.rooms[against.room].name}</span>
    </span>
  );
}

/** The kinds of card that clear a guest, for whoever's case it is. */
function Breakers({ view, story, who }: { view: PlayerView; story: Answer; who: string }) {
  const d = view.dossier;
  const r = d.rooms[story.room];
  const room = `${r.preposition} the ${r.name}`;
  const weapon = d.devices[story.device];
  const kept = d.rooms[weapon.location];
  return (
    <div className="stack breakers" style={{ gap: 4 }}>
      <span className="small">
        <span className="card-kind clear">🛡️ Alibi</span> for {who}: clears you outright. It could be in any room.
      </span>
      <span className="small">
        <span className="card-kind clear">🚪 Room cleared</span> &ldquo;It didn&apos;t happen {room}&rdquo;: no opportunity. Kept {room}.
      </span>
      <span className="small">
        <span className="card-kind clear">🔪 Weapon cleared</span> &ldquo;No trace on the {weapon.name.toLowerCase()}&rdquo;: no means. Kept {kept.preposition} the {kept.name}, with the weapon.
      </span>
    </div>
  );
}

/**
 * The briefing, page by page, before your first turn: who you are, what you
 * know, and how the game is played. It explains; it never advises.
 */
export function Briefing({ view, onDone }: { view: PlayerView; onDone: () => void }) {
  const [page, setPage] = useState(0);
  const d = view.dossier;
  const me = view.you.seat;
  const agent = d.agents[me];
  const g = view.guilty;
  const pages: { title: string; body: React.ReactNode }[] = [
    {
      title: `You are ${agent.name}`,
      body: (
        <>
          <p>{d.theme.story}</p>
          <p className="muted small">
            You: {looks(d, me)}. {agent.motive}
          </p>
          <p className="muted small">
            At the table:{" "}
            {view.players
              .map((_, i) => i)
              .filter((i) => i !== me)
              .map((i) => seatName(view, i))
              .join(", ")}
            .
          </p>
        </>
      ),
    },
    {
      title: view.you.role === "killer" ? "🔪 You did it" : view.you.role === "accomplice" ? "🤝 You're the accomplice" : "🕊️ You're innocent",
      body:
        view.you.role === "innocent" ? (
          <>
            <p>You didn&apos;t kill Lord Ashcombe. One of the others did, and will try to pin it on someone else.</p>
            <p>The innocents win together if the table names the real killer, the weapon and the room.</p>
          </>
        ) : (
          <>
            <p>
              {view.you.role === "killer"
                ? "You killed Lord Ashcombe"
                : `${seatName(view, g!.killer)} killed Lord Ashcombe, and you're helping them get away with it. It happened`}
              :
            </p>
            <CaseChips view={view} against={g!.answer} />
            <p>
              You win if the table names the wrong answer.
              {view.you.role === "killer" && g!.accomplice !== null ? ` Your accomplice is ${seatName(view, g!.accomplice)}.` : ""}
              {view.you.role === "killer" ? " You know where every card in the house is." : ""}
            </p>
          </>
        ),
    },
    {
      title: "Means, motive and opportunity",
      body: (
        <>
          <p>
            Anyone could have done it. Every guest had a <b>motive</b>, the <b>means</b> (a weapon they could have used)
            and the <b>opportunity</b> (a room they were in where it could have happened). Only the killer actually did.
          </p>
          {!g ? (
            <>
              <p className="small">The case against you:</p>
              <span className="small">💰 Motive: {agent.motive}</span>
              <CaseChips view={view} against={view.you.story} />
              <p className="small">You know it&apos;s wrong. These cards, somewhere in the house, would show it:</p>
              <Breakers view={view} story={view.you.story} who="you" />
              <p className="small">
                If your means or opportunity happens to be the real weapon or room, there&apos;s no card to clear that part,
                and a second alibi instead. Some cards make a case look stronger without proving anything, like a{" "}
                <span className="card-kind point">👁️ Sighting</span> of you where you had the opportunity.
              </p>
            </>
          ) : (
            <>
              <p className="small">The case against each of the others, which they each know:</p>
              {view.players.map((p, i) =>
                i === g.killer ? null : (
                  <div key={p.id} className="small frame-row">
                    <b>{d.agents[i].name}</b> <CaseChips view={view} against={g.stories[i]} short />
                  </div>
                )
              )}
              <p className="small">
                Each of them is cleared by an <span className="card-kind clear">🛡️ Alibi</span>, a{" "}
                <span className="card-kind clear">🚪 Room cleared</span> card kept in their room (no opportunity), and a{" "}
                <span className="card-kind clear">🔪 Weapon cleared</span> card kept with their weapon (no means), or a
                second alibi where their case shares the real room or weapon. Destroy those, and the case against them
                stands.
              </p>
            </>
          )}
          <p className="small">👣 This evening you went to: {view.you.evening.map((r) => d.rooms[r].name).join(", ")}.</p>
        </>
      ),
    },
    {
      title: "Your turn",
      body: (
        <ol className="small turn-steps">
          <li>
            <b>Move.</b> Stay, go to any room, or join another guest. Everyone sees where everyone is, and how many cards
            are left in each room.
          </li>
          <li>
            <b>Search or keep watch.</b> A search takes the top card of the room. If anyone else is in the room, it goes
            straight on the public record. If you&apos;re alone, it goes into your hand, and nobody else sees it.
          </li>
          <li>
            <b>Testify or burn</b> what&apos;s in your hand. Testifying puts it on the record. Burning destroys it unseen.
            Anyone may burn.
          </li>
        </ol>
      ),
    },
    {
      title: "Night, and the verdict",
      body: (
        <>
          <p className="small">
            After everyone&apos;s turn the house goes dark. The killer may murder a guest who is alone (once a game), or
            destroy a card in an empty room.
          </p>
          <p className="small">
            Once a game, instead of moving, you can call the <b>Reconstruction</b>: name who, with what, and where. Everyone
            alive votes yes or no. If most say yes, that&apos;s the verdict, right or wrong. If not, play goes on.
          </p>
          <p className="small">After round {view.rounds}, if nobody has convinced the table, it votes at dawn.</p>
          <p className="small">Talk as much as you like. Nothing anyone says is checked, and every card is true.</p>
        </>
      ),
    },
  ];
  const last = page === pages.length - 1;
  return (
    <div className="card stack briefing">
      <div className="spread">
        <span className="muted small">
          Briefing {page + 1} of {pages.length}
        </span>
        <span className="muted small">Only you should see this.</span>
      </div>
      <h2 style={{ margin: 0 }}>{pages[page].title}</h2>
      <div className="stack" style={{ gap: 6 }}>{pages[page].body}</div>
      <div className="btn-row">
        <button className="ghost" disabled={page === 0} onClick={() => setPage(page - 1)}>
          ← Back
        </button>
        <button className="primary" onClick={() => (last ? onDone() : setPage(page + 1))}>
          {last ? "Start" : "Next →"}
        </button>
      </div>
    </div>
  );
}
