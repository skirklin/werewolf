import { useState } from "react";
import type React from "react";
import type { Answer, PlayerView } from "@party/foulplay";
import { looks, seatName } from "./text.js";

/** "🗡️ Rope · 📌 Library": a story at a glance. */
export function StoryChips({ view, story }: { view: PlayerView; story: Answer }) {
  const d = view.dossier;
  return (
    <span className="chips">
      <span className="pill">🗡️ {d.devices[story.device].name}</span>
      <span className="pill">📌 {d.rooms[story.room].name}</span>
    </span>
  );
}

/** The three kinds of card that break a story, for whoever's story it is. */
function Breakers({ view, story, who }: { view: PlayerView; story: Answer; who: string }) {
  const d = view.dossier;
  const room = d.rooms[story.room].name;
  const weapon = d.devices[story.device];
  return (
    <div className="stack breakers" style={{ gap: 4 }}>
      <span className="small">
        <span className="card-kind clear">🛡️ Alibi</span> for {who}. It could be in any room.
      </span>
      <span className="small">
        <span className="card-kind clear">🚪 Room cleared</span> &ldquo;It didn&apos;t happen in the {room}.&rdquo; Kept in the {room}.
      </span>
      <span className="small">
        <span className="card-kind clear">🔪 Weapon cleared</span> &ldquo;No trace on the {weapon.name.toLowerCase()}.&rdquo; Kept in the{" "}
        {d.rooms[weapon.location].name}, with the weapon.
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
            <StoryChips view={view} story={g!.answer} />
            <p>
              You win if the table names the wrong answer.
              {view.you.role === "killer" && g!.accomplice !== null ? ` Your accomplice is ${seatName(view, g!.accomplice)}.` : ""}
              {view.you.role === "killer" ? " You know where every card in the house is." : ""}
            </p>
          </>
        ),
    },
    {
      title: "Everyone has a story",
      body: (
        <>
          <p>
            The house tells a story about every guest: a weapon they could have used, and a room they were in. Only the
            killer&apos;s is true.
          </p>
          {!g ? (
            <>
              <p>The story about you, which is false:</p>
              <StoryChips view={view} story={view.you.story} />
              <p className="small">A false story is broken by cards like these, somewhere in the house:</p>
              <Breakers view={view} story={view.you.story} who="you" />
              <p className="small">
                If a story borrows the real room or weapon, there&apos;s no card to clear it: there are two alibis instead.
                Other cards fit stories without proving anything, like a <span className="card-kind point">👁️ Sighting</span>{" "}
                of a guest where their story says they were.
              </p>
            </>
          ) : (
            <>
              <p className="small">Everyone else&apos;s story, which they each know:</p>
              {view.players.map((p, i) =>
                i === g.killer ? null : (
                  <div key={p.id} className="small frame-row">
                    <b>{d.agents[i].name}</b> <StoryChips view={view} story={g.stories[i]} />
                  </div>
                )
              )}
              <p className="small">
                Each false story is broken by an <span className="card-kind clear">🛡️ Alibi</span>, a{" "}
                <span className="card-kind clear">🚪 Room cleared</span> card kept in its room, and a{" "}
                <span className="card-kind clear">🔪 Weapon cleared</span> card kept with its weapon (or a second alibi
                where the story borrows the real room or weapon). Destroy them, and the story could stick.
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
