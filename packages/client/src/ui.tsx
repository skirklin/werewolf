import type { ReactNode } from "react";
import { ROLES, type PlayerView, type PublicPlayer, type LogEntry } from "@werewolf/shared";

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
          🐺 Your partners in crime:{" "}
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
      <b>🔮 What you've seen</b>
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
      return `🌅 Night ${e.round}: the wolves pounced, but ${name(e.playerId)} lived to tell the tale!`;
    case "noDeath":
      return e.cause === "wolves"
        ? `🌅 Night ${e.round}: everyone woke up in one piece. Suspicious.`
        : `🗳️ Day ${e.round}: the town lost its nerve — nobody eliminated.`;
    case "lynch":
      return `🗳️ Day ${e.round}: the town pointed fingers, and ${name(e.playerId)} got the boot.`;
    case "hunterShot":
      return `🏹 ${name(e.playerId)} caught a parting arrow from a dying Hunter. Rude.`;
    case "poisoned":
      return `☠️ ${name(e.playerId)} was found extremely dead in the night. (Poison? Who's to say.)`;
    case "raised":
      return `👻 A séance worked?! ${name(e.playerId)} is back among the living.`;
    case "voteTie":
      return `🗳️ Day ${e.round}: the vote tied — the town shrugged and moved on.`;
    default:
      return null;
  }
}
