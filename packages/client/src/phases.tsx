import { useState } from "react";
import { ROLES, type PlayerView, type ClientMessage, type PublicPlayer } from "@werewolf/shared";
import { PlayerChip, LogFeed, roleEmoji } from "./ui.js";

type Send = (msg: ClientMessage) => void;

export function TargetGrid({
  view,
  ids,
  selected,
  onPick,
  groupChoices,
}: {
  view: PlayerView;
  ids: string[];
  selected: string | null;
  onPick: (id: string) => void;
  groupChoices?: Record<string, number>;
}) {
  const byId = (id: string) => view.players.find((p) => p.id === id)!;
  return (
    <div className="targets">
      {ids.map((id) => {
        const p = byId(id);
        const votes = groupChoices?.[id] ?? 0;
        // Always a neutral avatar — a target picker must never reveal roles.
        return (
          <button
            key={id}
            className={`target ${selected === id ? "selected" : ""}`}
            onClick={() => onPick(id)}
          >
            <span className="avatar">🙂</span>
            <span>{p.name}</span>
            {votes > 0 && <span className="pill">🐺 ×{votes}</span>}
          </button>
        );
      })}
    </div>
  );
}

const NIGHT_PROMPT: Record<string, string> = {
  kill: "Choose tonight's victim",
  protect: "Choose someone to protect",
  inspect: "Choose someone to inspect",
};

/** The acting player's night UI. Assumes view.nightPrompt is present. */
export function NightAction({ view, send }: { view: PlayerView; send: Send }) {
  const prompt = view.nightPrompt!;
  const [picked, setPicked] = useState<string | null>(null);
  const role = ROLES[prompt.roleId];
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">{role.emoji}</div>
        <h2>{role.name}</h2>
        <p className="muted">{NIGHT_PROMPT[prompt.kind]}</p>
      </div>
      <TargetGrid
        view={view}
        ids={prompt.targetIds}
        selected={picked}
        groupChoices={prompt.groupChoices}
        onPick={setPicked}
      />
      <button
        className="primary full lg"
        disabled={!picked}
        onClick={() => picked && send({ type: "nightChoice", targetId: picked })}
      >
        Confirm
      </button>
    </div>
  );
}

/** Result shown to the seer right after inspecting (pass-device convenience). */
export function InspectResultCard({ view }: { view: PlayerView }) {
  const last = view.myInspects.at(-1);
  if (!last) return null;
  const target = view.players.find((p) => p.id === last.targetId);
  const isWolf = last.reveal === "werewolf";
  return (
    <div className="rolecard">
      <div className="emoji">{isWolf ? "🐺" : "✅"}</div>
      <div className="rname">{target?.name}</div>
      <div className="blurb">
        {isWolf ? "is a Werewolf!" : last.reveal === "not-werewolf" ? "is not a werewolf." : `is the ${ROLES[last.reveal]?.name ?? last.reveal}.`}
      </div>
    </div>
  );
}

/** Day discussion board — public info everyone can see. */
export function DayBoard({
  view,
  send,
  isHost,
}: {
  view: PlayerView;
  send: Send;
  isHost: boolean;
}) {
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">☀️</div>
        <h2>Day {view.round}</h2>
        <p className="muted">Discuss. Who seems suspicious?</p>
      </div>
      <LogFeed log={view.log} players={view.players} />
      <PlayerList players={view.players} youId={view.you.id} />
      {isHost && (
        <button className="primary full lg" onClick={() => send({ type: "startVote" })}>
          Call a vote
        </button>
      )}
      {!isHost && <p className="muted center small">Waiting for the host to call a vote…</p>}
    </div>
  );
}

/** Voting UI for a living player. */
export function VoteAction({ view, send }: { view: PlayerView; send: Send }) {
  const alive = view.players.filter((p) => p.alive && p.id !== view.you.id);
  const already = view.myVote !== undefined;
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">🗳️</div>
        <h2>Vote</h2>
        <p className="muted">{already ? "Vote locked in." : "Who should the town eliminate?"}</p>
      </div>
      {already ? (
        <div className="card center">
          You voted:{" "}
          <b>{view.myVote === null ? "Abstain" : view.players.find((p) => p.id === view.myVote)?.name}</b>
          <p className="muted small">Waiting for {view.votesRemaining} more…</p>
        </div>
      ) : (
        <>
          <TargetGrid
            view={view}
            ids={alive.map((p) => p.id)}
            selected={null}
            onPick={(id) => send({ type: "castVote", targetId: id })}
          />
          <button className="ghost full" onClick={() => send({ type: "castVote", targetId: null })}>
            Abstain
          </button>
        </>
      )}
    </div>
  );
}

/** A fallen Hunter's dying shot. Assumes view.shootPrompt is present. */
export function ShootAction({ view, send }: { view: PlayerView; send: Send }) {
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">🏹</div>
        <h2>Your dying shot</h2>
        <p className="muted">You've fallen — take one player down with you.</p>
      </div>
      <TargetGrid
        view={view}
        ids={view.shootPrompt!.targetIds}
        selected={null}
        onPick={(id) => send({ type: "shoot", targetId: id })}
      />
    </div>
  );
}

export function PlayerList({ players, youId }: { players: PublicPlayer[]; youId: string }) {
  return (
    <div className="players">
      {players.map((p) => (
        <PlayerChip key={p.id} player={p} you={p.id === youId} />
      ))}
    </div>
  );
}

export function GameOver({ view, onExit }: { view: PlayerView; onExit: () => void }) {
  const soloWinner = view.soloWinnerId
    ? view.players.find((p) => p.id === view.soloWinnerId)
    : undefined;
  const { emoji, headline } =
    view.winner === "solo"
      ? {
          emoji: soloWinner?.roleId ? roleEmoji(soloWinner.roleId) : "🃏",
          headline: `${soloWinner?.name ?? "The Tanner"} wins alone!`,
        }
      : view.winner === "village"
        ? { emoji: "🎉", headline: "The Village wins!" }
        : { emoji: "🐺", headline: "The Werewolves win!" };
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">{emoji}</div>
        <h1>{headline}</h1>
      </div>
      <div className="card stack">
        <b>Everyone's role</b>
        {view.players.map((p) => (
          <div key={p.id} className="spread">
            <span>{roleEmoji(p.roleId)} {p.name}</span>
            <span className="muted">{p.roleId ? ROLES[p.roleId].name : "?"}</span>
          </div>
        ))}
      </div>
      <button className="primary full lg" onClick={onExit}>
        Back to start
      </button>
    </div>
  );
}
