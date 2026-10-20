import { useEffect, useState, type ReactNode } from "react";
import { ROLES, type Phase, type PlayerView, type PublicPlayer, type LogEntry, type VoteRecord } from "@party/werewolf";

/** Whether the table should be quiet (night) or talking (day) in a phase. */
export function timeOfDay(phase: Phase): "day" | "night" | null {
  if (phase === "roleReveal" || phase === "night") return "night";
  if (phase === "dayDiscussion" || phase === "dayVote" || phase === "hunterShot") return "day";
  return null;
}

/** Re-theme the whole page for the time of day, and put it back on the way out. */
export function useTimeTheme(phase: Phase | null) {
  const time = phase ? timeOfDay(phase) : null;
  useEffect(() => {
    if (time) document.body.dataset.time = time;
    else delete document.body.dataset.time;
    return () => {
      delete document.body.dataset.time;
    };
  }, [time]);
}

/** A loud reminder of whether the table may talk right now. */
export function TimeBadge({ phase }: { phase: Phase }) {
  const time = timeOfDay(phase);
  if (!time) return null;
  return time === "night" ? (
    <div className="time-badge">🌙 Night — no talking, eyes on your own screen</div>
  ) : (
    <div className="time-badge">☀️ Day — talk it over</div>
  );
}

/**
 * Every role that could be in this game — no counts, no owners. Tap a role to
 * read what it does, so players can answer "wait, what does the Witch do?"
 * themselves (and bluff more convincingly).
 */
export function RolesInPlay({ roleIds }: { roleIds: string[] }) {
  const [open, setOpen] = useState<string | null>(null);
  if (roleIds.length === 0) return null;
  const role = open ? ROLES[open] : null;
  return (
    <div className="card tight stack">
      <b>🎴 Roles that could be in this game</b>
      <div className="roles-list">
        {roleIds.map((id) => (
          <button
            key={id}
            className="pill"
            style={{ minHeight: 0, padding: "6px 10px", borderColor: open === id ? "var(--accent-2)" : undefined }}
            onClick={() => setOpen((cur) => (cur === id ? null : id))}
          >
            {ROLES[id]?.emoji} {ROLES[id]?.name ?? id}
          </button>
        ))}
      </div>
      {role && (
        <div className="small">
          <b>{role.name}</b> <span className={`team ${role.team}`}>({role.team})</span>
          <div className="muted">{role.blurb}</div>
        </div>
      )}
      <div className="muted small">Not every role here was necessarily dealt.</div>
      <div className="muted small">
        🌙 Everyone acts at the same time at night. What happens (swaps, infections, deaths) lands at dawn, so a
        vision shows the table as it stood at nightfall.
      </div>
    </div>
  );
}

/** Who voted for whom, day by day (votes are public). Most recent first. */
export function VoteHistory({ history, players, limit = 1 }: { history: VoteRecord[]; players: PublicPlayer[]; limit?: number }) {
  if (history.length === 0) return null;
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? "someone";
  return (
    <>
      {history
        .slice(-limit)
        .reverse()
        .map((rec) => (
          <div key={rec.round} className="card tight stack">
            <b>🗳️ Day {rec.round}: how everyone voted</b>
            <BallotLines votes={rec.votes} name={name} />
          </div>
        ))}
    </>
  );
}

/** One line per voter: "Sam → Alex", "Kai abstained". */
export function BallotLines({ votes, name }: { votes: Record<string, string | null>; name: (id: string) => string }) {
  const entries = Object.entries(votes);
  if (entries.length === 0) return <div className="muted small">Nobody voted.</div>;
  return (
    <>
      {entries.map(([voter, target]) => (
        <div key={voter} className="spread small">
          <span>{name(voter)}</span>
          <b>{target === null ? "abstained" : `→ ${name(target)}`}</b>
        </div>
      ))}
    </>
  );
}

export function Screen({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`app ${className}`}>{children}</div>;
}

export function roleEmoji(roleId: string | null): string {
  return roleId ? ROLES[roleId]?.emoji ?? "❔" : "❔";
}

export function PlayerChip({
  player,
  you,
  tag,
}: {
  player: PublicPlayer;
  you?: boolean;
  tag?: ReactNode;
}) {
  const role = player.roleId ? ROLES[player.roleId] : null;
  return (
    <div className={`chip ${player.alive ? "" : "dead"}`}>
      <span className="avatar">{player.alive ? roleEmoji(player.roleId) : "💀"}</span>
      <span className="name">
        {player.name}
        {you ? " (you)" : ""}
      </span>
      {role && <span className="tag">{role.name}</span>}
      {tag}
      {!role && (
        <span className={`dot ${player.connected ? "on" : ""}`} title={player.connected ? "connected" : "offline"} />
      )}
    </div>
  );
}

export function RoleCard({ view }: { view: PlayerView }) {
  const role = view.you.roleId ? ROLES[view.you.roleId] : null;
  if (!role) return null;
  return (
    <div className="rolecard">
      <div className="emoji">{role.emoji}</div>
      <div className="rname">{role.name}</div>
      <div className={`team ${role.team}`}>{role.team}</div>
      <div className="blurb">{role.blurb}</div>
      {view.packmates.length > 0 && (
        <div className="small" style={{ marginTop: 14 }}>
          🐺 Your pack:{" "}
          <b>
            {view.players
              .filter((p) => view.packmates.includes(p.id))
              .map((p) => p.name)
              .join(", ")}
          </b>
        </div>
      )}
    </div>
  );
}

export function InspectHistory({ view }: { view: PlayerView }) {
  if (view.myInspects.length === 0) return null;
  return (
    <div className="card tight stack">
      <b>🔮 Your visions</b>
      {view.myInspects.map((r, i) => {
        const target = view.players.find((p) => p.id === r.targetId);
        const label =
          r.reveal === "werewolf"
            ? "🐺 Werewolf"
            : r.reveal === "not-werewolf"
              ? "✅ Not a werewolf"
              : ROLES[r.reveal]?.name ?? r.reveal;
        return (
          <div key={i} className="spread small">
            <span>Night {r.round}: {target?.name}</span>
            <b>{label}</b>
          </div>
        );
      })}
    </div>
  );
}

export function LogFeed({ log, players }: { log: LogEntry[]; players: PublicPlayer[] }) {
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? "someone";
  const lines = log
    .map((e) => describe(e, name))
    .filter((x): x is string => x !== null)
    .slice(-8);
  return (
    <div className="log">
      {lines.map((l, i) => (
        <div key={i} className="entry">{l}</div>
      ))}
    </div>
  );
}

function describe(e: LogEntry, name: (id: string) => string): string | null {
  switch (e.type) {
    case "death":
      return `🌙 Night ${e.round}: the wolves had ${name(e.playerId)} for a midnight snack.`;
    case "saved":
      return `🌅 Night ${e.round}: the wolves struck, but ${name(e.playerId)} survived the night.`;
    case "noDeath":
      return e.cause === "wolves"
        ? `🌅 Night ${e.round}: everyone woke up in one piece.`
        : `🗳️ Day ${e.round}: the town couldn't decide — nobody eliminated.`;
    case "lynch":
      return `🗳️ Day ${e.round}: the town pointed fingers, and ${name(e.playerId)} got the boot.`;
    case "hunterShot":
      return `🏹 ${name(e.playerId)} took a parting shot from a dying Hunter.`;
    case "poisoned":
      return `☠️ ${name(e.playerId)} was found dead in the night, untouched by the wolves.`;
    case "raised":
      return `👻 the Medium's séance worked — ${name(e.playerId)} is back among the living.`;
    case "voteTie":
      return `🗳️ Day ${e.round}: the vote tied — nobody eliminated.`;
    default:
      return null;
  }
}
