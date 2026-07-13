export function Home({ onPick }: { onPick: (mode: "online" | "local") => void }) {
  return (
    <div className="app">
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
      </div>
      <div className="spacer" />
      <p className="center small muted">Homemade with love and mild betrayal. No app store, no accounts.</p>
    </div>
  );
}
