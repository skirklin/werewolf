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
        <p className="muted">Lord Ashcombe is dead, and the house tells a story about every one of you. Only one is true.</p>
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
        Every case is generated fresh and checked to have exactly one answer, if you can find the evidence. Still being balanced: expect changes.
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
          and the house tells a story about every one of you: a weapon you could have used and a room you were in. Only
          the killer&apos;s story is true.
        </p>
        <h3>Your role and your story</h3>
        <p className="muted">
          One player is the <b>killer</b>, who knows everything, including where every card is. At five or more there may
          be an <b>accomplice</b>, who knows what the killer knows except where the cards are. Everyone else is{" "}
          <b>innocent</b>. You all start in the Hall with one memory, and you each know your own story and where you went
          this evening. Somewhere in the house are the cards that break an innocent&apos;s story: an alibi, or proof that
          their weapon or room wasn&apos;t the one.
        </p>
        <h3>A turn</h3>
        <p className="muted">
          <b>Move</b>: stay, go to a room, or join another guest. Then <b>search</b> the room (take the top card of its
          evidence) or <b>keep watch</b>. If anyone else is in the room, what you find goes straight on the public
          record. If you&apos;re alone, it goes into your hand, unseen. Then <b>testify</b> what you hold onto the record,
          or <b>burn</b> it. Anyone can burn: you might want rid of a card that fits your own story. Everyone sees where
          everyone is and how many cards are left in each room, but nobody sees a burn.
        </p>
        <h3>The night</h3>
        <p className="muted">
          The device goes round the table and everyone taps through. The killer may murder one guest who was left alone
          (once a game; no weapon or presence needed, and the body leaves new evidence), or destroy a card in an empty room.
        </p>
        <h3>The Reconstruction</h3>
        <p className="muted">
          Once a game, instead of moving, you can call everyone together and name who did it, with what, and where. Everyone
          alive says yes or no, openly. If most say yes, that&apos;s the verdict: right, and the innocents win; wrong, and
          the killer does. If not, play goes on. The game never ends just because the evidence adds up: someone has to
          see it and convince the table. The killer can call one too, to frame someone.
        </p>
        <h3>Talk is free</h3>
        <p className="muted">
          Say anything, any time; nothing you say is checked, and the killer will lie. The record is the only proof. The
          dead don&apos;t talk.
        </p>
        <h3>Winning</h3>
        <p className="muted">
          The innocents win if the table accepts the right answer. The killer (with the accomplice) wins if it accepts a
          wrong one, or if the guilty come to outnumber the innocents. If nobody has convinced the table after six rounds,
          it votes at dawn: who, then with what, then where.
        </p>
      </div>
    </div>
  );
}
