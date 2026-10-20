import type { PlayerView, WerewolfAction } from "@party/werewolf";
import type { TableProps } from "../../shell/game.js";
import { RoleCard, InspectHistory, LogFeed, RolesInPlay, TimeBadge, useTimeTheme } from "./ui.js";
import { NightAction, NightResult, IdleNight, DayBoard, VoteAction, ShootAction, DetectionHistory, GameOver, PlayerList } from "./phases.js";

type Send = (action: WerewolfAction) => void;

/** A Werewolf game in progress, on one player's own device. */
export function WerewolfTable({ view, act, playAgain, onExit }: TableProps<PlayerView, WerewolfAction>) {
  useTimeTheme(view.phase);
  return (
    <>
      <TimeBadge phase={view.phase} />
      {renderPhase(view, act, playAgain, onExit)}
      <HostRecovery view={view} send={act} />
    </>
  );
}

function renderPhase(view: PlayerView, send: Send, playAgain: () => void, onExit: () => void) {
  const dead = !view.you.alive;

  switch (view.phase) {
    case "roleReveal":
      return (
        <div className="stack">
          <RoleCard view={view} />
          <RolesInPlay roleIds={view.possibleRoles} />
          {view.you.isHost ? (
            <button className="primary full lg" onClick={() => send({ type: "startNight" })}>
              Everyone's ready — begin the night
            </button>
          ) : (
            <p className="center muted">Memorize your role. Waiting for the host…</p>
          )}
        </div>
      );

    case "night":
      if (dead) return <Spectator view={view} label="🌙 The night creeps by…" />;
      if (view.nightPrompt) return <NightAction view={view} send={send} />;
      if (view.nightAwaitingAck) return <NightResult view={view} send={send} />;
      if (view.idlePrompt) return <IdleNight view={view} send={send} />;
      return (
        <div className="stack">
          <div className="phase-banner"><div className="big">🌙</div><h2>Night falls</h2></div>
          <InspectHistory view={view} />
          <DetectionHistory view={view} />
          <p className="center muted">Waiting for the night to end…</p>
          <RolesInPlay roleIds={view.possibleRoles} />
        </div>
      );

    case "hunterShot":
      if (view.shootPrompt) return <ShootAction view={view} send={send} />;
      return (
        <div className="stack">
          <div className="phase-banner"><div className="big">🏹</div><h2>A shot rings out</h2></div>
          <p className="center muted">A fallen Hunter is taking someone down with them…</p>
        </div>
      );

    case "dayDiscussion":
      return <DayBoard view={view} send={send} isHost={view.you.isHost} />;

    case "dayVote":
      if (dead) return <Spectator view={view} label="🗳️ The town is deliberating…" />;
      if (view.silencedIds.includes(view.you.id))
        return (
          <div className="stack">
            <div className="phase-banner"><div className="big">🤫</div><h2>You&apos;ve been silenced</h2><p className="muted">No vote for you today — sit tight and look innocent.</p></div>
            <LogFeed log={view.log} players={view.players} />
          </div>
        );
      return <VoteAction view={view} send={send} />;

    case "gameOver":
      // The host deals a rematch in place — everyone stays in the room, so no
      // one has to re-enter the code.
      return (
        <GameOver
          view={view}
          onPlayAgain={view.you.isHost ? playAgain : null}
          onExit={onExit}
        />
      );

    default:
      return null;
  }
}

/**
 * A subtle host-only escape hatch for phases that wait on one player. If someone
 * goes idle or drops, the host can force the game forward so it never wedges.
 */
function HostRecovery({ view, send }: { view: PlayerView; send: Send }) {
  if (!view.you.isHost) return null;
  const turnName = view.players.find((p) => p.id === view.voteTurn)?.name;
  const action =
    view.phase === "night"
      ? { label: "Nudge the night along (someone's AFK)", msg: { type: "endNight" } as WerewolfAction }
      : view.phase === "dayVote" && turnName
        ? { label: `Skip ${turnName}'s vote (they're AFK)`, msg: { type: "skipVoter" } as WerewolfAction }
        : view.phase === "hunterShot"
          ? { label: "Skip the shot (Hunter's AFK)", msg: { type: "skipShot" } as WerewolfAction }
          : null;
  if (!action) return null;
  return (
    <div style={{ marginTop: 16 }}>
      <button className="ghost full small" onClick={() => send(action.msg)}>
        {action.label}
      </button>
    </div>
  );
}

function Spectator({ view, label }: { view: PlayerView; label: string }) {
  return (
    <div className="stack">
      <div className="phase-banner"><div className="big">💀</div><h2>You're out 💀</h2><p className="muted">{label}</p></div>
      <LogFeed log={view.log} players={view.players} />
      <PlayerList players={view.players} youId={view.you.id} />
    </div>
  );
}
