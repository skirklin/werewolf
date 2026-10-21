import { useEffect, useState, type ReactNode } from "react";
import { ROLES, type Phase, type PlayerView, type PublicPlayer, type LogEntry, type VoteRecord } from "@party/werewolf";

/** Whether the table should be quiet (night) or talking (day) in a phase. */
export function timeOfDay(phase: Phase): "day" | "night" | null {
  if (phase === "roleReveal" || phase === "night") return "night";
  if (phase === "dayDiscussion" || phase === "dayVote" || phase === "verdict" || phase === "hunterShot") return "day";
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

/**
 * The screen's header line: which night or day it is, and whether the table
 * may talk. One line instead of a badge plus a separate title.
 */
export function TimeBadge({ phase, round }: { phase: Phase; round: number }) {
  const time = timeOfDay(phase);
  if (!time) return null;
  if (time === "night")
    return <div className="time-badge">🌙 {round > 0 ? `Night ${round}` : "Before nightfall"} · no talking</div>;
  return <div className="time-badge">☀️ Day {round} · talk it over</div>;
}

/** Log entries that belong to a day's vote (as opposed to a night). */
const DAY_EVENTS = new Set<LogEntry["type"]>(["lynch", "voteTie", "hunterShot"]);

/**
 * What the town wakes up to: last night's outcome and yesterday's vote, with
 * everything older folded away. The full record is a tap away.
 */
export function TownNews({
  log,
  voteHistory,
  round,
  players,
}: {
  log: LogEntry[];
  voteHistory: VoteRecord[];
  round: number;
  players: PublicPlayer[];
}) {
  const [all, setAll] = useState(false);
  const recent = (e: LogEntry) =>
    e.round === round || (e.round === round - 1 && (DAY_EVENTS.has(e.type) || (e.type === "noDeath" && e.cause === "lynch")));
  const shownLog = all ? log : log.filter(recent);
  const shownVotes = all ? voteHistory : voteHistory.filter((v) => v.round === round - 1);
  const hasEarlier = log.some((e) => !recent(e) && describe(e, () => "") !== null) || voteHistory.length > shownVotes.length;
  return (
    <div className="stack" style={{ gap: 8 }}>
      <LogFeed log={shownLog} players={players} limit={all ? 50 : 8} />
      <VoteHistory history={shownVotes} players={players} limit={shownVotes.length} />
      {hasEarlier && (
        <button className="ghost small" style={{ alignSelf: "center" }} onClick={() => setAll((v) => !v)}>
          {all ? "Show just the latest" : "Show earlier days"}
        </button>
      )}
    </div>
  );
}

/**
 * Every role that could be in this game — no counts, no owners. Collapsed to
 * one line of emoji unless opened (or `open` from the start), so it's always
 * to hand without crowding the screen. Tap a role to read what it does, so
 * players can answer "wait, what does the Witch do?" themselves.
 */
export function RolesInPlay({ roleIds, open = false }: { roleIds: string[]; open?: boolean }) {
  const [expanded, setExpanded] = useState(open);
  const [shown, setShown] = useState<string | null>(null);
  if (roleIds.length === 0) return null;
  const role = shown ? ROLES[shown] : null;
  if (!expanded)
    return (
      <button className="card tight spread roles-summary" onClick={() => setExpanded(true)}>
        <span className="small"><b>Roles in play</b></span>
        <span aria-hidden>{roleIds.map((id) => ROLES[id]?.emoji).join(" ")}</span>
        <span className="muted small">Show</span>
      </button>
    );
  return (
    <div className="card tight stack">
      <div className="spread">
        <b className="small">Roles that could be in this game</b>
        {!open && (
          <button className="ghost small" onClick={() => setExpanded(false)}>
            Hide
          </button>
        )}
      </div>
      <div className="roles-list">
        {roleIds.map((id) => (
          <button
            key={id}
            className={`pill role-pill ${shown === id ? "on" : ""}`}
            onClick={() => setShown((cur) => (cur === id ? null : id))}
          >
            {ROLES[id]?.emoji} {ROLES[id]?.name ?? id}
          </button>
        ))}
      </div>
      {role && (
        <div className="role-detail">
          <b>{role.name}</b> · <span className={`team ${role.team}`}>{role.team}</span>
          <div>{role.blurb}</div>
        </div>
      )}
      <div className="muted small">
        Not every role listed was necessarily dealt. Everyone acts at once at night, and what happens lands at dawn,
        so a vision shows the table as it stood at nightfall.
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
            <b className="small">🗳️ Day {rec.round} vote</b>
            <BallotLines votes={rec.votes} name={name} />
          </div>
        ))}
    </>
  );
}

/**
 * A ballot grouped by who got the votes, most first: "Ben · 3 — Cleo, Dev,
 * Eli". One line per target reads faster than one per voter.
 */
export function BallotLines({ votes, name }: { votes: Record<string, string | null>; name: (id: string) => string }) {
  const entries = Object.entries(votes);
  if (entries.length === 0) return <div className="muted small">Nobody voted.</div>;
  const byTarget = new Map<string | null, string[]>();
  for (const [voter, target] of entries) byTarget.set(target, [...(byTarget.get(target) ?? []), voter]);
  const rows = [...byTarget.entries()].sort((a, b) => (a[0] === null ? 1 : b[0] === null ? -1 : b[1].length - a[1].length));
  return (
    <>
      {rows.map(([target, voters]) => (
        <div key={target ?? "-"} className="ballot-row small">
          <b>{target === null ? "Abstained" : `${name(target)} · ${voters.length}`}</b>
          <span className="muted">{voters.map(name).join(", ")}</span>
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

/**
 * One player in a list: just the name, a skull if they're dead, and their
 * role only where it's known. Online status matters to the host (who has the
 * AFK controls), so only the host sees it.
 */
export function PlayerChip({
  player,
  you,
  tag,
  showPresence = false,
}: {
  player: PublicPlayer;
  you?: boolean;
  tag?: ReactNode;
  showPresence?: boolean;
}) {
  // Never your own role on a shared board: the person beside you can see your screen.
  const role = player.roleId && !you ? ROLES[player.roleId] : null;
  const offline = showPresence && player.alive && !player.connected;
  return (
    <div className={`chip ${player.alive ? "" : "dead"}`}>
      {!player.alive && <span className="avatar">💀</span>}
      {player.alive && role && <span className="avatar">{role.emoji}</span>}
      <span className="who">
        <span className="name">
          {player.name}
          {you ? " (you)" : ""}
        </span>
        {(role || offline) && <span className="muted sub">{[role?.name, offline ? "offline" : ""].filter(Boolean).join(" · ")}</span>}
      </span>
      {tag}
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

export function LogFeed({ log, players, limit = 8 }: { log: LogEntry[]; players: PublicPlayer[]; limit?: number }) {
  const name = (id: string) => players.find((p) => p.id === id)?.name ?? "someone";
  const lines = log
    .map((e) => describe(e, name))
    .filter((x): x is string => x !== null)
    .slice(-limit);
  if (lines.length === 0) return null;
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
