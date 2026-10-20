import { useEffect, useRef, useState } from "react";
import { ROLES, MAX_CHAT_TEXT, type PlayerView, type WerewolfAction, type PublicPlayer } from "@party/werewolf";
import { PlayerChip, LogFeed, roleEmoji, InspectHistory, RolesInPlay, VoteHistory } from "./ui.js";

type Send = (msg: WerewolfAction) => void;

export function TargetGrid({
  view,
  ids,
  selected,
  onPick,
  multi,
}: {
  view: PlayerView;
  ids: string[];
  selected: string | null;
  onPick: (id: string) => void;
  /** Ids to mark selected when more than one can be chosen (e.g. the swap). */
  multi?: string[];
}) {
  const byId = (id: string) => view.players.find((p) => p.id === id)!;
  return (
    <div className="targets">
      {ids.map((id) => {
        const p = byId(id);
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
          </button>
        );
      })}
    </div>
  );
}

const NIGHT_PROMPT: Record<string, string> = {
  kill: "Choose tonight's victim",
  protect: "Choose someone to protect — never the same patient twice running",
  inspect: "Choose someone to inspect",
  silence: "Choose whose vote to silence",
  convert: "Choose someone to infect",
};

/** The acting player's night UI. Assumes view.nightPrompt is present. */
export function NightAction({ view, send }: { view: PlayerView; send: Send }) {
  const prompt = view.nightPrompt!;
  if (prompt.kind === "witch")
    return <WitchPanel view={view} onSubmit={(heal, poison) => send({ type: "witchAction", healTargetId: heal, poisonTargetId: poison })} />;
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

/**
 * The Witch's night action. She chooses blind — she is never told whom the
 * wolves picked — so the heal is a guess: shield someone, and if the wolves
 * come for them they live (and only then is the potion spent).
 */
export function WitchPanel({
  view,
  onSubmit,
}: {
  view: PlayerView;
  onSubmit: (healTargetId: string | null, poisonTargetId: string | null) => void;
}) {
  const w = view.nightPrompt!.witch!;
  const [heal, setHeal] = useState<string | null>(null);
  const [poison, setPoison] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">🧪</div>
        <h2>The Witch wakes</h2>
        <p className="muted">You don't know who the wolves are after. Brew wisely.</p>
      </div>

      {w.healAvailable && (
        <>
          <div className="muted small">
            ❤️‍🩹 Healing potion (optional) — shield one player tonight. If the wolves strike them, they live and the potion is spent.
          </div>
          <TargetGrid view={view} ids={w.healTargetIds} selected={heal} onPick={(id) => setHeal((h) => (h === id ? null : id))} />
        </>
      )}

      {w.poisonAvailable && (
        <>
          <div className="muted small">☠️ Poison potion (optional, one-time) — they won't wake up.</div>
          <TargetGrid view={view} ids={view.nightPrompt!.targetIds} selected={poison} onPick={(id) => setPoison((p) => (p === id ? null : id))} />
        </>
      )}

      {!w.healAvailable && !w.poisonAvailable && <p className="center muted">Your shelf is bare — both potions are spent.</p>}

      <button className="primary full lg" onClick={() => onSubmit(heal, poison)}>
        {heal || poison ? "Use potion(s)" : "Do nothing tonight"}
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
        <p className="muted">Choose two players to secretly swap. {2 - picked.length} more.</p>
      </div>
      <TargetGrid view={view} ids={view.nightPrompt!.targetIds} selected={null} onPick={toggle} multi={picked} />
      <button className="primary full lg" disabled={picked.length !== 2} onClick={() => onSubmit(picked[0], picked[1])}>
        Swap them
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
        <p className="muted">Investigate two players — same team? {2 - picked.length} more.</p>
      </div>
      <TargetGrid view={view} ids={view.nightPrompt!.targetIds} selected={null} onPick={toggle} multi={picked} />
      <button className="primary full lg" disabled={picked.length !== 2} onClick={() => onSubmit(picked[0], picked[1])}>
        Investigate
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
        <p className="muted">Raise one dead player back to life — once per game.</p>
      </div>
      <TargetGrid view={view} ids={dead} selected={picked} onPick={(id) => setPicked((p) => (p === id ? null : id))} />
      <button className="primary full lg" disabled={!picked} onClick={() => picked && onSubmit(picked)}>
        Raise the dead
      </button>
      <button className="ghost full" onClick={() => onSubmit(null)}>Save my power</button>
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
        {isWolf ? "is a Werewolf." : last.reveal === "not-werewolf" ? "is not a werewolf." : `is the ${ROLES[last.reveal]?.name ?? last.reveal}.`}
      </div>
    </div>
  );
}

/**
 * What you learned tonight, held on screen until you dismiss it. The night
 * doesn't end until every actor with a result has tapped through, so a vision
 * can't vanish under the dawn before it's been read.
 */
export function NightResult({ view, send }: { view: PlayerView; send: Send }) {
  const inspect = view.myInspects.find((r) => r.round === view.round);
  const detect = view.myDetections.find((r) => r.round === view.round);
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? "someone";
  return (
    <div className="stack">
      {inspect && <InspectResultCard view={view} />}
      {detect && (
        <div className="rolecard">
          <div className="emoji">{detect.sameTeam ? "🤝" : "🎭"}</div>
          <div className="rname">{name(detect.aId)} &amp; {name(detect.bId)}</div>
          <div className="blurb">{detect.sameTeam ? "are on the same team." : "are on different teams."}</div>
        </div>
      )}
      <p className="muted center small">Commit it to memory — it stays in your notes below, but nobody else can see it.</p>
      <button className="primary full lg" onClick={() => send({ type: "nightAck" })}>
        Got it ✓
      </button>
    </div>
  );
}

/**
 * The night screen for a player with no power tonight. Everyone at the table
 * is tapping at night, so a busy phone gives nobody away; this pick goes
 * nowhere, and the night waits for it like any other.
 */
export function IdleNight({ view, send }: { view: PlayerView; send: Send }) {
  const [picked, setPicked] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">🌙</div>
        <h2>The village sleeps</h2>
        <p className="muted">Who do you suspect most? Only you see this, and it changes nothing — it just keeps every phone at the table equally busy.</p>
      </div>
      <TargetGrid view={view} ids={view.idlePrompt!.targetIds} selected={picked} onPick={setPicked} />
      <button className="primary full lg" disabled={!picked} onClick={() => picked && send({ type: "nightIdle", targetId: picked })}>
        Confirm
      </button>
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
        <p className="muted">A new day dawns. Who seems suspicious?</p>
      </div>
      <LogFeed log={view.log} players={view.players} />
      <SilencedNote view={view} />
      <InspectHistory view={view} />
      <DetectionHistory view={view} />
      <VoteHistory history={view.voteHistory} players={view.players} />
      {view.config.chat !== false && <ChatPanel view={view} send={send} />}
      <PlayerList players={view.players} youId={view.you.id} />
      <RolesInPlay roleIds={view.possibleRoles} />
      {isHost && (
        <button className="primary full lg" onClick={() => send({ type: "startVote" })}>
          Call a vote
        </button>
      )}
      {!isHost && <p className="muted center small">Waiting for the host to round everyone up…</p>}
    </div>
  );
}

/**
 * The town square. Everything said is public and daytime-only, so this panel
 * can never leak a role its speaker didn't give away. The dead get to read it
 * but not add to it.
 */
export function ChatPanel({ view, send }: { view: PlayerView; send: Send }) {
  const [draft, setDraft] = useState("");
  const feed = useRef<HTMLDivElement>(null);
  const nameOf = (id: string) => view.players.find((p) => p.id === id)?.name ?? "someone";

  // Stick to the newest message as talk comes in.
  useEffect(() => {
    if (feed.current) feed.current.scrollTop = feed.current.scrollHeight;
  }, [view.chat.length]);

  const say = () => {
    const text = draft.trim();
    if (!text) return;
    send({ type: "say", text });
    setDraft("");
  };

  return (
    <div className="card tight stack">
      <b>💬 Town square</b>
      <div className="chat" ref={feed}>
        {view.chat.length === 0 ? (
          <p className="muted small center">Nobody's said anything yet.</p>
        ) : (
          view.chat.map((m, i) => (
            <div key={i} className="said">
              <b>{nameOf(m.playerId)}{m.playerId === view.you.id ? " (you)" : ""}</b> {m.text}
            </div>
          ))
        )}
      </div>
      {view.you.alive ? (
        <div className="spread" style={{ gap: 8 }}>
          <input
            value={draft}
            placeholder="Make your case…"
            maxLength={MAX_CHAT_TEXT}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && say()}
          />
          <button className="primary" disabled={!draft.trim()} onClick={say}>Say</button>
        </div>
      ) : (
        <p className="muted small center">The dead don't get a say.</p>
      )}
    </div>
  );
}

/**
 * Where the vote stands (who voted for whom is in the voting order below). A
 * tie eliminates nobody, which is a wasted day for the town.
 */
function VoteTally({ view }: { view: PlayerView }) {
  const standing = Object.entries(view.voteTally)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  if (standing.length === 0) return null;
  const most = standing[0]?.[1] ?? 0;
  const tied = standing.filter(([, n]) => n === most).length > 1;
  return (
    <div className="card tight stack">
      <div className="spread">
        <b>🗳️ Where the vote stands</b>
        {tied && <span className="pill">tied — nobody goes</span>}
      </div>
      {standing.map(([id, n]) => (
        <div key={id} className="spread small">
          <span>{view.players.find((p) => p.id === id)?.name ?? "someone"}</span>
          <b className="count">{n}</b>
        </div>
      ))}
    </div>
  );
}

/**
 * Voting, one at a time in the day's order: each vote is public the moment
 * it's cast, so later voters know exactly where the earlier ones landed.
 */
export function VoteAction({ view, send }: { view: PlayerView; send: Send }) {
  const alive = view.players.filter((p) => p.alive && p.id !== view.you.id);
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? "someone";
  const already = view.myVote !== undefined;
  const myTurn = view.voteTurn === view.you.id;
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">🗳️</div>
        <h2>Vote</h2>
        <p className="muted">
          {myTurn ? "Your turn — who should the town eliminate?" : view.voteTurn ? <>Waiting on <b>{name(view.voteTurn)}</b> to vote…</> : "Counting the votes…"}
        </p>
      </div>
      <VoteTally view={view} />
      {myTurn ? (
        <>
          <TargetGrid view={view} ids={alive.map((p) => p.id)} selected={null} onPick={(id) => send({ type: "castVote", targetId: id })} />
          <button className="ghost full" onClick={() => send({ type: "castVote", targetId: null })}>
            Abstain
          </button>
        </>
      ) : null}
      <VoteOrder view={view} name={name} />
      {already && !myTurn && (
        <p className="center muted small">
          You voted: <b>{view.myVote ? name(view.myVote) : "Abstain"}</b>
        </p>
      )}
      {view.config.chat !== false && <ChatPanel view={view} send={send} />}
    </div>
  );
}

/** The day's voting order, with who's done and who's up. */
function VoteOrder({ view, name }: { view: PlayerView; name: (id: string) => string }) {
  if (view.voteOrder.length === 0) return null;
  return (
    <div className="card tight stack">
      <b>Voting order</b>
      {view.voteOrder.map((id, i) => {
        const done = id in view.votes;
        const up = id === view.voteTurn;
        return (
          <div key={id} className="spread small" style={{ opacity: done ? 0.6 : 1 }}>
            <span>
              {i + 1}. {name(id)}
              {id === view.you.id ? " (you)" : ""}
            </span>
            <b>{up ? "voting now…" : done ? (view.votes[id] === null ? "abstained" : `→ ${name(view.votes[id]!)}`) : ""}</b>
          </div>
        );
      })}
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

export function GameOver({
  view,
  onPlayAgain,
  onExit,
}: {
  view: PlayerView;
  /** Null for players who can't start the rematch (everyone but the host). */
  onPlayAgain: (() => void) | null;
  onExit: () => void;
}) {
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
      {onPlayAgain ? (
        <button className="primary full lg" onClick={onPlayAgain}>
          Play again? 🔁
        </button>
      ) : (
        <p className="center muted">Waiting for the host to deal another round…</p>
      )}
      <button className="ghost full" onClick={onExit}>
        Leave
      </button>
    </div>
  );
}
