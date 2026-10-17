import type { HomeProps } from "../../shell/game.js";
import { FoulPlayLocal } from "./LocalApp.js";

export function FoulPlayHome({ sub, navigate, onBack }: HomeProps) {
  if (sub === "rules") return <Rules onBack={() => navigate("")} />;
  if (sub === "practice") return <FoulPlayLocal onExit={() => navigate("")} />;
  return (
    <div className="app">
      <div className="spread">
        <button className="ghost small" onClick={onBack}>← All games</button>
      </div>
      <div className="spacer" />
      <div className="phase-banner">
        <div className="big" style={{ fontSize: "5rem" }}>🔍</div>
        <h1>
          Foul Play <span className="beta-pill">BETA</span>
        </h1>
        <p className="muted">Lord Ashcombe is dead, and one of you did it. Find the evidence before the killer destroys it.</p>
      </div>
      <div className="spacer" />
      <div className="stack">
        <button className="primary full lg" onClick={() => navigate("online")}>
          📱 Play together
          <div className="small" style={{ fontWeight: 400, opacity: 0.8 }}>Everyone on their own phone · 4–8 players</div>
        </button>
        <button className="full lg" onClick={() => navigate("practice")}>
          🤖 Practice on one device
          <div className="small muted" style={{ fontWeight: 400 }}>Solo against bots, or pass the device</div>
        </button>
        <button className="ghost full" onClick={() => navigate("rules")}>
          📖 How to play
        </button>
      </div>
      <div className="spacer" />
      <p className="center small muted">
        Every case is generated fresh and checked to have exactly one answer. Still being balanced: expect changes.
      </p>
    </div>
  );
}

function Rules({ onBack }: { onBack: () => void }) {
  return (
    <div className="app">
      <div className="spread">
        <button className="ghost small" onClick={onBack}>← Back</button>
        <span className="beta-pill">BETA</span>
      </div>
      <div className="stack">
        <h2>How to play</h2>
        <p>
          Lord Ashcombe has been found dead at the foot of the stairs in the Hall, moved there from wherever he was really
          killed. Every player is one of the guests, and one of you did it. The evidence is still lying around the house,
          and it&apos;s a race: the innocents search for it, and the killer, who knows where every piece is, destroys it.
        </p>
        <h3>Your role</h3>
        <p className="muted">
          One player is the <b>killer</b> and knows everything. At five or more there may be an <b>accomplice</b>, who
          knows who the killer is but not how. Everyone else is <b>innocent</b>. Everyone starts in the Hall with one
          memory.
        </p>
        <h3>A turn</h3>
        <p className="muted">
          <b>Move</b>: stay, go to a room, or join another guest. Then <b>search</b> the room (take the top card of its
          evidence) or <b>keep watch</b>. If anyone else is in the room, what you find goes straight on the public
          record. If you&apos;re alone, it goes into your hand, unseen, and you can <b>testify</b> it whenever it&apos;s
          your turn. Everyone sees where everyone is and how many cards are left in each room.
        </p>
        <h3>The guilty</h3>
        <p className="muted">
          The killer and accomplice destroy evidence by searching alone and quietly <b>burning</b> what they find. From
          outside, that looks just like someone keeping a find to themselves, so ask what people found. At night the
          device goes round the table and everyone taps through; the killer may murder one guest who was left alone (once
          a game), or destroy a card in an empty room.
        </p>
        <h3>Talk is free; the record is proof</h3>
        <p className="muted">
          Say anything, any time. Nothing you say is checked, and the killer will lie. Playing apart, you&apos;ll need a
          call. The dead don&apos;t talk.
        </p>
        <h3>Winning</h3>
        <p className="muted">
          The innocents win the moment the public record proves who, with what and where. The killer (with the accomplice)
          wins once too much evidence is gone for that ever to happen, or if the guilty come to outnumber the innocents.
          If neither has happened after six rounds, the table votes at dawn.
        </p>
      </div>
    </div>
  );
}
