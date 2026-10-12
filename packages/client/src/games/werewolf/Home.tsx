import type { HomeProps } from "../../shell/game.js";
import { LocalApp } from "./LocalApp.js";
import { StatsPage } from "./Stats.js";

/** Werewolf's own front page, plus its pass-the-device and stats screens. */
export function WerewolfHome({ sub, navigate, onBack }: HomeProps) {
  if (sub === "local") return <LocalApp onExit={() => navigate("")} />;
  if (sub === "stats") return <StatsPage onExit={() => navigate("")} />;
  return <Menu onPick={navigate} onBack={onBack} />;
}

function Menu({ onPick, onBack }: { onPick: (sub: "online" | "local" | "stats") => void; onBack: () => void }) {
  return (
    <div className="app">
      <div className="spread">
        <button className="ghost small" onClick={onBack}>← All games</button>
      </div>
      <div className="spacer" />
      <div className="phase-banner">
        <div className="big" style={{ fontSize: "5rem" }}>🐺</div>
        <h1>Werewolf</h1>
        <p className="muted">Villagers, wolves, and a truly alarming amount of lying.</p>
      </div>
      <div className="spacer" />
      <div className="stack">
        <button className="primary full lg" onClick={() => onPick("online")}>
          📱 Play together
          <div className="small" style={{ fontWeight: 400, opacity: 0.8 }}>
            Everyone on their own phone
          </div>
        </button>
        <button className="full lg" onClick={() => onPick("local")}>
          🤝 Pass the device
          <div className="small muted" style={{ fontWeight: 400 }}>
            One phone, shared around the table
          </div>
        </button>
        <button className="ghost full" onClick={() => onPick("stats")}>
          📊 House numbers
          <div className="small muted" style={{ fontWeight: 400 }}>
            Win rates and other anonymous trivia
          </div>
        </button>
      </div>
      <div className="spacer" />
      <p className="center small muted">Homemade with love and mild betrayal. No app store, no accounts.</p>
    </div>
  );
}
