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
  multi,
}: {
  view: PlayerView;
  ids: string[];
  selected: string | null;
  onPick: (id: string) => void;
  groupChoices?: Record<string, number>;
  /** Ids to mark selected when more than one can be chosen (e.g. the swap). */
  multi?: string[];
}) {
  const byId = (id: string) => view.players.find((p) => p.id === id)!;
  return (
    <div className="targets">
      {ids.map((id) => {
        const p = byId(id);
        const votes = groupChoices?.[id] ?? 0;
        const isSel = selected === id || (multi?.includes(id) ?? false);
        // Always a neutral avatar — a target picker must never reveal roles.
        return (
          <button
            key={id}
            className={`target ${isSel ? "selected" : ""}`}
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
  kill: "Pick tonight's snack 🍽️",
  protect: "Who gets a guardian angel tonight?",
  inspect: "Whose true colors do you peek at?",
  silence: "Who loses their voice tomorrow?",
  convert: "Who catches the werewolf bug?",
};

/** The acting player's night UI. Assumes view.nightPrompt is present. */
export function NightAction({ view, send }: { view: PlayerView; send: Send }) {
  const prompt = view.nightPrompt!;
  if (prompt.kind === "witch")
    return <WitchPanel view={view} onSubmit={(save, poison) => send({ type: "witchAction", save, poisonTargetId: poison })} />;
  if (prompt.kind === "swap")
    return <SwapPanel view={view} onSubmit={(aId, bId) => send({ type: "swapAction", aId, bId })} />;
  if (prompt.kind === "detect")
    return <DetectPanel view={view} onSubmit={(aId, bId) => send({ type: "detectAction", aId, bId })} />;
  if (prompt.kind === "raise")
    return <RaisePanel view={view} onSubmit={(targetId) => send({ type: "raiseAction", targetId })} />;
  return <TargetNightAction view={view} send={send} />;
}

function TargetNightAction({ view, send }: { view: PlayerView; send: Send }) {
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
        Lock it in 🔒
      </button>
    </div>
  );
}

/** The Witch's night action: heal the wolves' victim and/or poison someone. */
export function WitchPanel({
  view,
  onSubmit,
}: {
  view: PlayerView;
  onSubmit: (save: boolean, poisonTargetId: string | null) => void;
}) {
  const w = view.nightPrompt!.witch!;
  const victim = w.victimId ? view.players.find((p) => p.id === w.victimId) : null;
  const [save, setSave] = useState(false);
  const [poison, setPoison] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">🧪</div>
        <h2>The Witch stirs her pot</h2>
        <p className="muted">
          {victim ? <>The wolves have their teeth out for <b>{victim.name}</b>.</> : "The wolves went hungry tonight."}
        </p>
      </div>

      {w.healAvailable && victim && (
        <button className={`chip ${save ? "" : ""}`} style={{ borderColor: save ? "var(--good)" : undefined }} onClick={() => setSave((s) => !s)}>
          <span className="avatar">❤️‍🩹</span>
          <div className="grow" style={{ textAlign: "left" }}>
            <div className="name">Healing potion 💚</div>
            <div className="muted small">{save ? `Snatching ${victim.name} from the jaws!` : `Save ${victim.name} (one-time only)`}</div>
          </div>
          <span className="pill">{save ? "✓" : "tap"}</span>
        </button>
      )}

      {w.poisonAvailable && (
        <>
          <div className="muted small">Poison potion ☠️ (one-time, optional)</div>
          <TargetGrid view={view} ids={view.nightPrompt!.targetIds} selected={poison} onPick={(id) => setPoison((p) => (p === id ? null : id))} />
        </>
      )}

      <button className="primary full lg" onClick={() => onSubmit(save, poison)}>
        {save || poison ? "Stir it up 🧪" : "Keep my potions corked"}
      </button>
    </div>
  );
}

/** The Troublemaker's night action: swap two players' roles. */
export function SwapPanel({
  view,
  onSubmit,
}: {
  view: PlayerView;
  onSubmit: (aId: string, bId: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : [cur[1], id]));
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">🎭</div>
        <h2>Troublemaker</h2>
        <p className="muted">Pick two unsuspecting souls to swap. {2 - picked.length} to go.</p>
      </div>
      <TargetGrid view={view} ids={view.nightPrompt!.targetIds} selected={null} onPick={toggle} multi={picked} />
      <button className="primary full lg" disabled={picked.length !== 2} onClick={() => onSubmit(picked[0], picked[1])}>
        Do the ol' switcheroo 🔀
      </button>
    </div>
  );
}

/** The Detective's night action: investigate two players for a same-team read. */
export function DetectPanel({
  view,
  onSubmit,
}: {
  view: PlayerView;
  onSubmit: (aId: string, bId: string) => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : [cur[1], id]));
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">🕵️</div>
        <h2>Detective</h2>
        <p className="muted">Line up two suspects — same team or not? {2 - picked.length} to go.</p>
      </div>
      <TargetGrid view={view} ids={view.nightPrompt!.targetIds} selected={null} onPick={toggle} multi={picked} />
      <button className="primary full lg" disabled={picked.length !== 2} onClick={() => onSubmit(picked[0], picked[1])}>
        Crack the case 🔍
      </button>
    </div>
  );
}

export function DetectionHistory({ view }: { view: PlayerView }) {
  if (view.myDetections.length === 0) return null;
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? "someone";
  return (
    <div className="card tight stack">
      <b>🕵️ Case file</b>
      {view.myDetections.map((d, i) => (
        <div key={i} className="spread small">
          <span>Night {d.round}: {name(d.aId)} &amp; {name(d.bId)}</span>
          <b>{d.sameTeam ? "🤝 Same team" : "🎭 Different teams"}</b>
        </div>
      ))}
    </div>
  );
}

/** The Medium's night action: raise a dead player, or hold the power. */
export function RaisePanel({
  view,
  onSubmit,
}: {
  view: PlayerView;
  onSubmit: (targetId: string | null) => void;
}) {
  const [picked, setPicked] = useState<string | null>(null);
  const dead = view.nightPrompt!.targetIds;
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">👻</div>
        <h2>Medium</h2>
        <p className="muted">Time for a séance? Bring one dearly departed back — once per game.</p>
      </div>
      <TargetGrid view={view} ids={dead} selected={picked} onPick={(id) => setPicked((p) => (p === id ? null : id))} />
      <button className="primary full lg" disabled={!picked} onClick={() => picked && onSubmit(picked)}>
        Hold the séance 👻
      </button>
      <button className="ghost full" onClick={() => onSubmit(null)}>Not tonight — save it</button>
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
        {isWolf ? "is a Werewolf! 🐺" : last.reveal === "not-werewolf" ? "is squeaky clean ✅" : `is the ${ROLES[last.reveal]?.name ?? last.reveal}.`}
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
        <p className="muted">Rise and shine! Who's looking a little... wolfish?</p>
      </div>
      <LogFeed log={view.log} players={view.players} />
      <SilencedNote view={view} />
      <PlayerList players={view.players} youId={view.you.id} />
      {isHost && (
        <button className="primary full lg" onClick={() => send({ type: "startVote" })}>
          Put it to a vote 🗳️
        </button>
      )}
      {!isHost && <p className="muted center small">Waiting for the host to round everyone up…</p>}
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
        <p className="muted">{already ? "Vote locked in. No take-backs!" : "Point the finger. Who's getting the boot?"}</p>
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
        <h2>One last shot 🏹</h2>
        <p className="muted">You're going down — but not alone. Who's coming with you?</p>
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

/** Public banner: who can't vote today (set by the Silencer). */
export function SilencedNote({ view }: { view: PlayerView }) {
  if (view.silencedIds.length === 0) return null;
  const names = view.silencedIds.map((id) => view.players.find((p) => p.id === id)?.name ?? "someone");
  return <div className="card tight small">🤫 Lost their voice today (no vote): <b>{names.join(", ")}</b></div>;
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
        <b>The big reveal 🎭</b>
        {view.players.map((p) => (
          <div key={p.id} className="spread">
            <span>{roleEmoji(p.roleId)} {p.name}</span>
            <span className="muted">{p.roleId ? ROLES[p.roleId].name : "?"}</span>
          </div>
        ))}
      </div>
      <button className="primary full lg" onClick={onExit}>
        Play again? 🔁
      </button>
    </div>
  );
}
