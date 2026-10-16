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
        <h1>Foul Play</h1>
        <p className="muted">Lord Ashcombe is dead. Trade evidence and name the killer, the weapon and the room.</p>
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
          Lord Ashcombe was found dead during his own party. Name the <b>killer</b>, the <b>weapon</b> and the{" "}
          <b>room</b>.
        </p>
        <h3>What everyone knows</h3>
        <p className="muted">
          The case file: every suspect&apos;s looks, the rooms, and where each weapon was kept. Each weapon only fits
          some murders: a revolver shot would be heard anywhere quiet, a candlestick blow needs a tall killer. Every
          guest visited a few rooms over the evening: the murder happened in one the killer visited, and the killer
          must have visited the room the weapon was taken from.
        </p>
        <h3>Your hand</h3>
        <p className="muted">
          You're dealt a hand of evidence cards, each worth 1 to 3 points: 3 for evidence that cuts broadly ("mud on
          the victim&apos;s shoes: the murder happened outdoors"), 1 for narrow sightings ("the butler saw Dr. Moreau in
          the Study"). Nobody&apos;s hand
          solves the case alone. Everything together always points to exactly one answer.
        </p>
        <h3>On your turn</h3>
        <p className="muted">
          <b>Ask the table</b> about two subjects: suspects, looks, weapons, rooms or room features. You pick them on the board. Everyone
          else may offer you cards from their hand about either one, or nothing. You only see how many points and
          cards each person offers, and nobody sees which subject they&apos;re about.
        </p>
        <p className="muted">
          Take any offers you like. The cards come to you, and you pay each person back with cards from your hand
          worth at least as many points; fewer cards is fine. A card they&apos;ve already seen still counts, if
          you&apos;re feeling mean.
        </p>
        <p className="muted">
          Or <b>accuse</b>: name the killer, the weapon and the room.
        </p>
        <h3>Rounds</h3>
        <p className="muted">
          Once everyone has had a turn, everyone discards half their hand and draws fresh cards. Discards go under the
          deck. Your notebook keeps everything you&apos;ve ever seen, so a discard only changes what you can trade.
        </p>
        <h3>Competitive</h3>
        <p className="muted">The first correct accusation wins. A wrong one puts you out, but you still offer and trade.</p>
        <h3>Co-op</h3>
        <p className="muted">The table shares a turn limit and one accusation.</p>
        <h3>The notebook</h3>
        <p className="muted">
          Evidence is filed for you, alongside a board of every suspect, weapon and room. The host picks how much the
          board helps: a full grid that crosses things off and tells you why, or notes only, where you cross things
          off yourself.
        </p>
      </div>
    </div>
  );
}
