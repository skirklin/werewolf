import type { HomeProps } from "../../shell/game.js";
import { DeadDropLocal } from "./LocalApp.js";

export function DeadDropHome({ sub, navigate, onBack }: HomeProps) {
  if (sub === "rules") return <Rules onBack={() => navigate("")} />;
  if (sub === "practice") return <DeadDropLocal onExit={() => navigate("")} />;
  return (
    <div className="app">
      <div className="spread">
        <button className="ghost small" onClick={onBack}>← All games</button>
      </div>
      <div className="spacer" />
      <div className="phase-banner">
        <div className="big" style={{ fontSize: "5rem" }}>🕵️</div>
        <h1>Dead Drop</h1>
        <p className="muted">A mole passed secrets at the embassy reception. Trade intel and name who, how, where and when.</p>
      </div>
      <div className="spacer" />
      <div className="stack">
        <button className="primary full lg" onClick={() => navigate("online")}>
          📱 Play together
          <div className="small" style={{ fontWeight: 400, opacity: 0.8 }}>Everyone on their own phone · 2–6 players</div>
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
      <p className="center small muted">Every case is generated fresh and checked to have exactly one answer.</p>
    </div>
  );
}

function Rules({ onBack }: { onBack: () => void }) {
  return (
    <div className="app">
      <div className="spread">
        <button className="ghost small" onClick={onBack}>← Back</button>
      </div>
      <div className="stack">
        <h2>How to play</h2>
        <p>
          During a reception, a mole handed secrets to their handler. Name the <b>mole</b>, the <b>device</b> they
          used, the <b>room</b> and the <b>hour</b>.
        </p>
        <h3>What everyone knows</h3>
        <p className="muted">
          The dossier: every suspect&apos;s looks, the rooms and how they connect, and each device&apos;s hiding place
          and requirement. The umbrella only works outdoors; the hatband needs a hat. Each hour a guest stays put or
          walks next door, and the mole had to pass the device&apos;s hiding place first.
        </p>
        <h3>What only you know</h3>
        <p className="muted">
          A hand of clues. Nobody&apos;s hand solves the case alone. Together they always point to exactly one
          answer.
        </p>
        <h3>On your turn</h3>
        <p className="muted">
          <b>Ask</b> someone about a subject: a suspect, a look, a room, a room feature, an hour or a device. They
          must hand you a clue about it you don&apos;t already have, and they choose which. If they have nothing on
          that exact subject, they must give you something from the same category (people, places, times or
          devices), and everyone sees that they did.
        </p>
        <p className="muted">
          Or <b>accuse</b>: name all four. Everyone can see who asked whom about what, so your questions show what
          you&apos;re missing.
        </p>
        <h3>Competitive</h3>
        <p className="muted">
          Whoever answers you may ask you something back. The first correct accusation wins. A wrong one puts you
          out, but you still answer questions.
        </p>
        <h3>Co-op</h3>
        <p className="muted">
          No asking back. The table shares a turn limit and one accusation.
        </p>
        <h3>The notebook</h3>
        <p className="muted">
          Clues are filed for you. The host picks how much more the app helps: just the notes, a count of the answers
          still possible, or a full grid that crosses things off and tells you why.
        </p>
      </div>
    </div>
  );
}
