import type { PlayerView, WerewolfAction } from "@party/werewolf";
import type { TableProps } from "../../shell/game.js";
import { RoleCard, RolesInPlay, TimeBadge, TownNews, useTimeTheme, nameOf } from "./ui.js";
import {
  NightAction, NightResult, IdleNight, AnnouncementScreen, DayBoard, VoteAction, InspectHistory, DetectionHistory,
  GameOver, PlayerList, type Send,
} from "./phases.js";

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

  switch (view.phase) {
    case "roleReveal": {
      const imReady = view.ready.includes(view.you.id);
      const waiting = view.players.filter((p) => !view.ready.includes(p.id)).map((p) => p.name);
      return (
        <div className="stack">
          <RoleCard view={view} />
          <RolesInPlay roleIds={view.possibleRoles} wolves={view.wolfCount} open />
          {imReady ? (
            <p className="center muted">
              Keep a straight face. Night falls once everyone's ready — waiting on {listNames(waiting)}.
            </p>
          ) : (
            <>
              <p className="center muted small">Read your card. Night falls once everyone has.</p>
              <button className="primary full lg" onClick={() => send({ type: "ready" })}>
                I know my role
              </button>
            </>
          )}
        </div>
      );
    }

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
          <RolesInPlay roleIds={view.possibleRoles} wolves={view.wolfCount} />
        </div>
      );

    case "dayDiscussion":
      return <DayBoard view={view} send={send} isHost={view.you.isHost} />;

    case "dayVote":
      if (dead) return <Spectator view={view} label="🗳️ The town is deliberating…" />;
      if (view.silencedIds.includes(view.you.id))
        return (
          <div className="stack">
            <div className="card tight small">🤫 You&apos;re getting the cold shoulder today: no vote for you. Sit tight and look innocent.</div>
            <VoteAction view={view} send={send} />
          </div>
        );
      return <VoteAction view={view} send={send} />;

    case "announce":
      return <AnnouncementScreen view={view} onContinue={view.you.isHost ? () => send({ type: "proceed" }) : null} />;

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
  const action: { label: string; hint: string; msg: WerewolfAction } | null =
    view.phase === "roleReveal" && view.ready.length > 0
      ? { label: "Start the night anyway", hint: "if someone's not answering", msg: { type: "startNight" } }
      : view.phase === "night"
        ? { label: "End the night now", hint: "if someone has wandered off", msg: { type: "endNight" } }
        : view.phase === "dayVote" && view.voteTurn
          ? { label: `Skip ${nameOf(view.players, view.voteTurn)}'s vote`, hint: "counts as an abstain", msg: { type: "skipVoter" } }
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

/** "Sam", "Sam and Alex", "Sam, Alex and Jo". */
function listNames(names: string[]): string {
  return names.length <= 1 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
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
