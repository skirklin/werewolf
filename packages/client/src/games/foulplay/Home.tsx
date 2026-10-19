import type React from "react";
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
        <p className="muted">Lord Ashcombe is dead. Every one of you had means, motive and opportunity. Only one of you did it.</p>
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
          Lord Ashcombe has been murdered at his own party. Every player is one of the guests, and one of you did it. The
          evidence is still lying around the house, face down, room by room.
        </p>

        <h3>1. Means, motive and opportunity</h3>
        <p className="muted">
          Anyone could have done it. Every guest has a <b>motive</b>, the <b>means</b> (a weapon they could have used) and
          the <b>opportunity</b> (a room they were in where it could have happened). You&apos;re told the case against you
          at the start. Only the killer actually did it, and wins by getting the table to convict someone else.
        </p>

        <h3>2. The cards</h3>
        <p className="muted">Every card is true. Each one says what kind it is:</p>
        <div className="stack" style={{ gap: 6 }}>
          <KindRow kind="clear" icon="🛡️" label="Alibi">A witness swears a guest was elsewhere. Clears that guest outright.</KindRow>
          <KindRow kind="clear" icon="🚪" label="Room cleared">
            The murder didn&apos;t happen in this room, so nobody had the opportunity there. Kept in that room.
          </KindRow>
          <KindRow kind="clear" icon="🔪" label="Weapon cleared">
            This weapon wasn&apos;t used, so it&apos;s nobody&apos;s means. Kept where the weapon is kept.
          </KindRow>
          <KindRow kind="point" icon="👁️" label="Sighting">
            A guest was seen in a room. It makes the case against them look stronger, but proves nothing.
          </KindRow>
          <KindRow kind="plain" icon="📋" label="Staff record · A guest's evening · From the body · Memory">
            Who went where, and what the body shows. Everyone starts with one memory.
          </KindRow>
        </div>
        <p className="muted">
          So an innocent guest is cleared by an alibi, a room-cleared card for their opportunity and a weapon-cleared
          card for their means. Where their means or opportunity is the real weapon or room, there&apos;s no card for
          that part, and a second alibi instead.
        </p>

        <h3>3. Your role</h3>
        <p className="muted">
          One player is the <b>killer</b>, and knows where every card is. At five or more there may be an{" "}
          <b>accomplice</b>, who knows the truth but not where the cards are. Everyone else is <b>innocent</b>.
        </p>

        <h3>4. A turn</h3>
        <p className="muted">
          <b>Move:</b> stay, go to a room, or join another guest. Everyone sees where everyone is, and how many cards are
          left in each room. <b>Then search or keep watch:</b> a search takes the top card of the room. If anyone else is
          there, it goes straight on the public record; if you&apos;re alone, it goes into your hand, unseen.{" "}
          <b>Then testify or burn</b> what you hold: testifying puts it on the record, burning destroys it, and nobody sees a
          burn. Anyone may burn.
        </p>

        <h3>5. The night</h3>
        <p className="muted">
          The device goes round and everyone taps through. The killer may murder a guest who is alone (once a game; the
          body leaves new evidence), or destroy the top card in an empty room.
        </p>

        <h3>6. The verdict</h3>
        <p className="muted">
          Once a game, instead of moving, anyone can call the <b>Reconstruction</b>: name who, with what, and where.
          Everyone alive votes yes or no, openly. If most say yes, that&apos;s the verdict: right, and the innocents win;
          wrong, and the killer does. If not, play goes on. After six rounds, the table votes at dawn.
        </p>

        <h3>Talk is free</h3>
        <p className="muted">
          Say anything, any time. Nothing anyone says is checked; only cards are proof. The dead don&apos;t talk.
        </p>
      </div>
    </div>
  );
}

function KindRow({ kind, icon, label, children }: { kind: "clear" | "point" | "plain"; icon: string; label: string; children: React.ReactNode }) {
  return (
    <div className={`clue kind-${kind}`}>
      <span className={`card-kind ${kind}`}>
        {icon} {label}
      </span>
      <span className="small">{children}</span>
    </div>
  );
}
