import { GAMES } from "../games/index.js";

/** Games on the way: shown so the picker says what's coming, but not playable. */
const COMING = [{ id: "deaddrop", name: "Dead Drop", emoji: "🕵️", tagline: "Trade intel, unmask the mole." }];

/** The front door: pick a game. */
export function Picker({ onPick }: { onPick: (gameId: string) => void }) {
  return (
    <div className="app">
      <div className="spacer" />
      <div className="phase-banner">
        <h1>Game night</h1>
        <p className="muted">Pick something to play.</p>
      </div>
      <div className="spacer" />
      <div className="stack">
        {GAMES.map((g) => (
          <button key={g.id} className="full lg" onClick={() => onPick(g.id)}>
            {g.emoji} {g.name}
            <div className="small muted" style={{ fontWeight: 400 }}>{g.tagline}</div>
          </button>
        ))}
        {COMING.filter((c) => !GAMES.some((g) => g.id === c.id)).map((c) => (
          <button key={c.id} className="ghost full lg" disabled>
            {c.emoji} {c.name}
            <div className="small muted" style={{ fontWeight: 400 }}>{c.tagline} Coming soon.</div>
          </button>
        ))}
      </div>
      <div className="spacer" />
      <p className="center small muted">Homemade. No app store, no accounts.</p>
    </div>
  );
}
