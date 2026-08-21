import { useEffect, useState } from "react";
import { ROLES, type Stats, type TeamStats } from "@werewolf/shared";

const TEAM_LOOK: Record<TeamStats["team"], { emoji: string; label: string; color: string }> = {
  village: { emoji: "🏡", label: "Village", color: "var(--village)" },
  werewolf: { emoji: "🐺", label: "Werewolves", color: "var(--wolf)" },
  solo: { emoji: "🎭", label: "Solo", color: "var(--moon)" },
};

const pct = (n: number) => `${Math.round(n * 100)}%`;
const round1 = (n: number) => (Math.round(n * 10) / 10).toString();

/** Anonymous house numbers: who wins, how often, and how everyone dies. */
export function StatsPage({ onExit }: { onExit: () => void }) {
  const [stats, setStats] = useState<Stats | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/stats")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((s: Stats) => alive && setStats(s))
      .catch(() => alive && setError("Couldn't load the numbers just now."));
    return () => {
      alive = false;
    };
  }, []);

  return (
    <div className="app">
      <div className="spread">
        <button className="ghost small" onClick={onExit}>← Back</button>
        <span className="pill">📊 House numbers</span>
      </div>

      {error && <div className="err">⚠️ {error}</div>}
      {!stats && !error && <p className="center muted">Counting…</p>}

      {stats && stats.games === 0 && (
        <>
          <div className="phase-banner"><div className="big">🫙</div><h2>Nothing tallied yet</h2></div>
          <p className="center muted">Play a game and it'll show up here — anonymously, no names kept.</p>
        </>
      )}

      {stats && stats.games > 0 && (
        <div className="stack">
          <div className="phase-banner">
            <div className="big">📊</div>
            <h2>{stats.games} {stats.games === 1 ? "game" : "games"} played</h2>
            <p className="muted small">
              {round1(stats.avgPlayers)} players and {round1(stats.avgRounds)} rounds on average
            </p>
          </div>

          <div className="card stack">
            <b>Who wins</b>
            {stats.teams.map((t) => (
              <TeamBar key={t.team} team={t} />
            ))}
          </div>

          <div className="card stack">
            <b>By role</b>
            <div className="spread small muted">
              <span>Role</span>
              <span>Dealt · won · survived</span>
            </div>
            {stats.roles.map((r) => (
              <div key={r.roleId} className="spread small">
                <span>{ROLES[r.roleId]?.emoji ?? "❔"} {ROLES[r.roleId]?.name ?? r.roleId}</span>
                <span className="count">
                  <b>{r.dealt}</b>
                  <span className="muted"> · </span>
                  <b>{pct(r.winRate)}</b>
                  <span className="muted"> · {pct(r.survivalRate)}</span>
                </span>
              </div>
            ))}
          </div>

          <Tally title="How people go out" rows={Object.entries(stats.deaths)} />

          <div className="card stack">
            <b>Odds and ends</b>
            <Row label="🩹 Saves that landed" value={stats.saves} />
            <Row label="👻 Raised from the dead" value={stats.raises} />
            <Row label="🕊️ Games with a peaceful first night" value={stats.options.peacefulFirstNight} />
            <Row label="💀 Games revealing roles on death" value={stats.options.revealRoleOnDeath} />
            <Row label="📢 Games with the chattier night recap" value={stats.options.detailedSummary} />
            <Row label="📱 On separate phones" value={stats.byMode.online} />
            <Row label="🤝 Passing one device" value={stats.byMode.local} />
          </div>

          <Tally
            title="Table sizes"
            rows={Object.entries(stats.byPlayerCount)
              .sort((a, b) => Number(a[0]) - Number(b[0]))
              .map(([n, count]) => [`${n} players`, count])}
          />

          <p className="center small muted">
            Records keep no names, no player ids and no room codes — just the shape of the game.
          </p>
        </div>
      )}
    </div>
  );
}

function TeamBar({ team }: { team: TeamStats }) {
  const look = TEAM_LOOK[team.team];
  return (
    <div className="stack" style={{ gap: 4 }}>
      <div className="spread small">
        <span>{look.emoji} {look.label}</span>
        <span className="count"><b>{pct(team.rate)}</b> <span className="muted">({team.wins})</span></span>
      </div>
      <div className="bar">
        <div className="fill" style={{ width: pct(team.rate), background: look.color }} />
      </div>
    </div>
  );
}

function Tally({ title, rows }: { title: string; rows: [string, number][] }) {
  if (rows.length === 0) return null;
  return (
    <div className="card stack">
      <b>{title}</b>
      {rows.map(([label, count]) => (
        <Row key={label} label={label} value={count} />
      ))}
    </div>
  );
}

function Row({ label, value }: { label: string; value: number }) {
  return (
    <div className="spread small">
      <span>{label}</span>
      <b className="count">{value}</b>
    </div>
  );
}
