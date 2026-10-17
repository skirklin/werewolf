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
        <p className="muted">Lord Ashcombe is dead, and one of you did it. Name who, with what, and where.</p>
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
          Lord Ashcombe promised his guests an announcement at midnight. At a quarter past twelve he was found dead at
          the foot of the stairs, moved there from wherever he was really killed. Every player is one of the guests, and
          one of you did it.
        </p>
        <h3>Your role</h3>
        <p className="muted">
          One player is the <b>killer</b> and knows everything. At five or more there may be an <b>accomplice</b>, who
          knows who the killer is but not how. Everyone else is <b>innocent</b>, and knows only that they didn&apos;t
          do it.
        </p>
        <h3>Talk is free; cards are proof</h3>
        <p className="muted">
          Say anything, any time: what you found, who you suspect. Nothing you say is checked, and the killer will lie.
          A card is proof: it shows where it came from. So claim what you like, ask others to back their claims up, and
          prove yours when it matters. Playing apart, you&apos;ll need a call.
        </p>
        <h3>A turn</h3>
        <p className="muted">
          <b>Investigate</b> one lead and draw its top card: examine the body, question a room&apos;s staff about who
          was there, check a guest&apos;s alibi, or search a room. Only you see what you find; the table sees where you
          looked. Then you may prove something: <b>testify</b> (put a card on the public record, for everyone) or{" "}
          <b>confer</b> (show one player a card and see one of theirs). You can hold four cards: over that, testify one
          or burn it.
        </p>
        <h3>The killer&apos;s tools</h3>
        <p className="muted">
          The killer can lie out loud like anyone, but a forgery is a lie that survives &ldquo;show me the card&rdquo;.
          They investigate like anyone, but can <b>tamper</b> instead: bury a lead&apos;s top card, or plant a
          forgery on it for the next person to find. Once a game they can <b>strike again</b>; the victim is found at the
          end of the round, with everything they were carrying.
        </p>
        <h3>Catching a lie</h3>
        <p className="muted">
          Every card shows where it came from. If cards you&apos;ve seen can&apos;t all be true, your board says so; doubt
          one and it works without it. A forgery is drawn by an innocent, but someone else followed that lead first.
        </p>
        <h3>Inquests and dawn</h3>
        <p className="muted">
          Instead of investigating, you can once call an <b>inquest</b>: name who, with what and where. If most of the
          living agree, the game ends there. Otherwise, after three rounds the inspector arrives and the table votes
          who, then with what, then where.
        </p>
        <h3>Winning</h3>
        <p className="muted">
          The innocents win only if the accusation gets all three right. Anything else, and the killer (with the
          accomplice) wins.
        </p>
      </div>
    </div>
  );
}
