import type { PlayerView, WerewolfAction } from "@party/werewolf";
import type { TableProps } from "../../shell/game.js";
import { RoleCard, InspectHistory, RolesInPlay, TimeBadge, TownNews, useTimeTheme } from "./ui.js";
import { NightAction, NightResult, IdleNight, DayBoard, VoteAction, ShootAction, DetectionHistory, GameOver, PlayerList } from "./phases.js";

type Send = (action: WerewolfAction) => void;

/** A Werewolf game in progress, on one player's own device. */
export function WerewolfTable({ view, act, playAgain, onExit }: TableProps<PlayerView, WerewolfAction>) {
  useTimeTheme(view.phase);
  return (
    <>
      <TimeBadge phase={view.phase} round={view.round} />
      {renderPhase(view, act, playAgain, onExit)}
      <HostRecovery view={view} send={act} />
    </>
  );
}

function renderPhase(view: PlayerView, send: Send, playAgain: () => void, onExit: () => void) {
  const dead = !view.you.alive;
  const host = view.players.find((p) => p.isHost)?.name ?? "The host";

  switch (view.phase) {
    case "roleReveal":
      return (
        <div className="stack">
          <RoleCard view={view} />
          <RolesInPlay roleIds={view.possibleRoles} open />
          {view.you.isHost ? (
            <>
              <p className="center muted small">Start once everyone has seen their card.</p>
              <button className="primary full lg" onClick={() => send({ type: "startNight" })}>
                Start the night
              </button>
            </>
          ) : (
            <p className="center muted">Keep a straight face. {host} starts the night once everyone has seen their card.</p>
          )}
        </div>
      );

    case "night":
      if (dead) return <Spectator view={view} label="The night goes on without you. No hints, no faces." />;
      if (view.nightPrompt) return <NightAction view={view} send={send} />;
      if (view.nightAwaitingAck) return <NightResult view={view} send={send} />;
      if (view.idlePrompt) return <IdleNight view={view} send={send} />;
      return (
        <div className="stack">
          <div className="phase-banner">
            <div className="big">🌙</div>
            <h2>You're done for tonight</h2>
            <p className="muted">Keep your eyes on your own screen. Dawn comes when everyone has finished.</p>
          </div>
          <InspectHistory view={view} />
          <DetectionHistory view={view} />
          <RolesInPlay roleIds={view.possibleRoles} />
        </div>
      );

    case "hunterShot":
      if (view.shootPrompt) return <ShootAction view={view} send={send} />;
      return (
        <div className="stack">
          <div className="phase-banner">
            <div className="big">🏹</div>
            <h2>A shot rings out</h2>
            <p className="muted">A fallen Hunter is choosing who to take down with them.</p>
          </div>
        </div>
      );

    case "dayDiscussion":
      return <DayBoard view={view} send={send} isHost={view.you.isHost} />;

    case "dayVote":
      if (dead) return <Spectator view={view} label="🗳️ The town is deliberating…" />;
      if (view.silencedIds.includes(view.you.id))
        return (
          <div className="stack">
            <div className="card tight small">🤫 You&apos;ve been silenced: no vote for you today. Sit tight and look innocent.</div>
            <VoteAction view={view} send={send} />
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
      ? { label: "End the night now", hint: "if someone has wandered off", msg: { type: "endNight" } as WerewolfAction }
      : view.phase === "dayVote" && turnName
        ? { label: `Skip ${turnName}'s vote`, hint: "counts as an abstain", msg: { type: "skipVoter" } as WerewolfAction }
        : view.phase === "hunterShot"
          ? { label: "Skip the Hunter's shot", hint: "if they've left", msg: { type: "skipShot" } as WerewolfAction }
          : null;
  if (!action) return null;
  return (
    <div className="host-tools">
      <span className="muted small">Host · {action.hint}</span>
      <button className="ghost small" onClick={() => send(action.msg)}>
        {action.label}
      </button>
    </div>
  );
}

function Spectator({ view, label }: { view: PlayerView; label: string }) {
  return (
    <div className="stack">
      <div className="phase-banner"><div className="big">💀</div><h2>You're out</h2><p className="muted">{label}</p></div>
      <TownNews log={view.log} voteHistory={view.voteHistory} round={view.round} players={view.players} />
      <PlayerList players={view.players} youId={view.you.id} />
    </div>
  );
}
