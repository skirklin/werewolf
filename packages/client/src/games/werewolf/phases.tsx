import { useEffect, useRef, useState } from "react";
import { ROLES, MAX_CHAT_TEXT, type PlayerView, type WerewolfAction, type PublicPlayer } from "@party/werewolf";
import { PlayerChip, roleEmoji, InspectHistory, RolesInPlay, TownNews } from "./ui.js";

type Send = (msg: WerewolfAction) => void;

const nameOf = (view: PlayerView, id: string) => view.players.find((p) => p.id === id)?.name ?? "someone";

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
            <span>{p.name}</span>
          </button>
        );
      })}
    </div>
  );
}

/** The confirm button names the act and the person, so a mis-tap is obvious. */
const NIGHT_VERB: Record<string, string> = {
  kill: "Attack",
  protect: "Protect",
  inspect: "Look into",
  silence: "Start a rumor about",
  convert: "Infect",
  mark: "Take",
};

const NIGHT_PROMPT: Record<string, string> = {
  kill: "Choose tonight's victim",
  protect: "Choose someone to protect — never the same patient twice running",
  inspect: "Choose someone to inspect",
  silence: "Who gets the cold shoulder tomorrow? Not the same person two nights running",
  convert: "Choose someone to infect",
  mark: "If you die before tomorrow night, who do you take down with you?",
};

/** The acting player's night UI. Assumes view.nightPrompt is present. */
export function NightAction({ view, send }: { view: PlayerView; send: Send }) {
  const prompt = view.nightPrompt!;
  if (prompt.kind === "witch")
    return <WitchPanel view={view} onSubmit={(heal, poison) => send({ type: "witchAction", heal, poisonTargetId: poison })} />;
  if (prompt.kind === "swap")
    return (
      <SwapPanel
        view={view}
        onSubmit={(aId, bId) => send({ type: "swapAction", aId, bId })}
        onSkip={() => send({ type: "nightSkip" })}
      />
    );
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
        {picked ? `${NIGHT_VERB[prompt.kind] ?? "Choose"} ${nameOf(view, picked)}` : "Pick someone"}
      </button>
      {prompt.canSkip && (
        <button className="ghost full" onClick={() => send({ type: "nightSkip" })}>
          Not tonight — save it for later
        </button>
      )}
    </div>
  );
}

/**
 * The Witch's night action. She chooses blind — she never learns whom the
 * wolves picked — so the heal is simply "save whoever they attack tonight".
 * It's spent either way.
 */
export function WitchPanel({
  view,
  onSubmit,
}: {
  view: PlayerView;
  onSubmit: (heal: boolean, poisonTargetId: string | null) => void;
}) {
  const w = view.nightPrompt!.witch!;
  const [heal, setHeal] = useState(false);
  const [poison, setPoison] = useState<string | null>(null);
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">🧪</div>
        <h2>The Witch wakes</h2>
        <p className="muted">You don't know who the wolves are after. Brew wisely.</p>
      </div>

      {w.healAvailable && (
        <label className="card tight rule-row" style={{ padding: "4px 14px" }}>
          <span aria-hidden>❤️‍🩹</span>
          <span className="grow">
            <b>Healing potion</b>
            <div className="muted small">Whoever the wolves attack tonight survives. One use, gone either way.</div>
          </span>
          <input type="checkbox" checked={heal} onChange={(e) => setHeal(e.target.checked)} />
        </label>
      )}

      {w.poisonAvailable && (
        <>
          <div className="muted small">☠️ Poison potion (optional, one use) — they won't wake up.</div>
          <TargetGrid view={view} ids={view.nightPrompt!.targetIds} selected={poison} onPick={(id) => setPoison((p) => (p === id ? null : id))} />
        </>
      )}

      {!w.healAvailable && !w.poisonAvailable && <p className="center muted">Your shelf is bare — both potions are spent.</p>}

      <button className="primary full lg" onClick={() => onSubmit(heal, poison)}>
        {heal && poison ? `Heal tonight and poison ${nameOf(view, poison)}` : heal ? "Heal tonight's victim" : poison ? `Poison ${nameOf(view, poison)}` : "Do nothing tonight"}
      </button>
    </div>
  );
}

/** The Troublemaker's night action: swap two players' roles. */
export function SwapPanel({
  view,
  onSubmit,
  onSkip,
}: {
  view: PlayerView;
  onSubmit: (aId: string, bId: string) => void;
  /** Keep the one swap for another night. */
  onSkip: () => void;
}) {
  const [picked, setPicked] = useState<string[]>([]);
  const toggle = (id: string) =>
    setPicked((cur) => (cur.includes(id) ? cur.filter((x) => x !== id) : cur.length < 2 ? [...cur, id] : [cur[1], id]));
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">🎭</div>
        <h2>Troublemaker</h2>
        <p className="muted">You get one swap a game. Pick two players to trade roles at dawn, or save it.</p>
      </div>
      <TargetGrid view={view} ids={view.nightPrompt!.targetIds} selected={null} onPick={toggle} multi={picked} />
      <button className="primary full lg" disabled={picked.length !== 2} onClick={() => onSubmit(picked[0], picked[1])}>
        {picked.length === 2 ? `Swap ${nameOf(view, picked[0])} and ${nameOf(view, picked[1])}` : `Pick ${2 - picked.length} more`}
      </button>
      <button className="ghost full" onClick={onSkip}>
        Not tonight — save it for later
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
      <p className="muted center small">Commit it to memory. It stays in your notes, and nobody else can see it.</p>
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
        <p className="muted">Who do you suspect most? It's just for you and changes nothing, but every phone stays busy at night.</p>
      </div>
      <TargetGrid view={view} ids={view.idlePrompt!.targetIds} selected={picked} onPick={setPicked} />
      <button className="primary full lg" disabled={!picked} onClick={() => picked && send({ type: "nightIdle", targetId: picked })}>
        {picked ? `Suspect ${nameOf(view, picked)}` : "Pick someone"}
      </button>
    </div>
  );
}

/** One side of the final reveal: everyone's name and the role they ended on. */
function RevealGroup({ title, players }: { title: string; players: PublicPlayer[] }) {
  if (players.length === 0) return null;
  return (
    <div className="card tight stack" style={{ gap: 8 }}>
      <b className="small">{title}</b>
      {players.map((p) => (
        <div key={p.id} className="spread small">
          <span>
            {roleEmoji(p.roleId)} {p.name}
            {p.alive ? "" : " 💀"}
          </span>
          <span className="muted">
            {p.dealtRoleId && p.dealtRoleId !== p.roleId && <>{ROLES[p.dealtRoleId]?.name ?? "?"} → </>}
            {p.roleId ? ROLES[p.roleId].name : "?"}
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * What just happened — the dawn, or a vote's result — read out to everyone
 * before play moves on, then whether the game is over. Dead players' roles are
 * named only when the setup reveals roles on death: a wolf's view also knows
 * its packmates, so going by the view alone would make some phones say more
 * than others. The host taps through for the table.
 */
export function AnnouncementScreen({
  view,
  onContinue,
  privateNews = true,
}: {
  view: PlayerView;
  onContinue: (() => void) | null;
  /** Show this player's own overnight news (off on a shared pass-the-device screen). */
  privateNews?: boolean;
}) {
  const a = view.announcement!;
  const you = view.you.id;
  const name = (id: string) => (id === you ? "you" : nameOf(view, id));
  const Name = (id: string) => (id === you ? "You" : nameOf(view, id));
  const was = (id: string) => {
    const roleId = view.config.revealRoleOnDeath ? view.players.find((p) => p.id === id)?.roleId : null;
    const role = roleId ? ROLES[roleId] : null;
    return role ? ` ${id === you ? "You were" : "They were"} the ${role.name}.` : "";
  };
  const line = (e: (typeof a.events)[number]): string => {
    switch (e.t) {
      case "killed":
        return `🐺 The wolves got ${name(e.playerId)}.${was(e.playerId)}`;
      case "poisoned":
        return `☠️ ${Name(e.playerId)} ${e.playerId === you ? "were" : "was"} found dead — and not by the wolves.${was(e.playerId)}`;
      case "saved":
        return `🩹 The wolves struck ${name(e.playerId)}, but ${e.playerId === you ? "you" : "they"} pulled through.`;
      case "quiet":
        return "🌅 Everyone woke up in one piece.";
      case "raised":
        return `👻 ${Name(e.playerId)} ${e.playerId === you ? "are" : "is"} back from the dead!`;
      case "votedOut":
        return `⚖️ The town voted out ${name(e.playerId)}.${was(e.playerId)}`;
      case "tie":
        return "🤝 A tie — nobody goes. Everyone lives another night.";
      case "noVotes":
        return "🤐 Nobody was voted out. Everyone lives another night.";
      case "shot":
        return `🏹 With a last breath, ${name(e.shooterId)} took ${name(e.playerId)} down too.${was(e.playerId)}`;
    }
  };
  const winnerLine =
    a.winner === "solo"
      ? `${a.soloWinnerId ? nameOf(view, a.soloWinnerId) : "The Tanner"} wins alone!`
      : a.winner === "village"
        ? "The Village wins!"
        : "The Werewolves win!";
  const next =
    a.next === "gameOver"
      ? { line: `Game over — ${winnerLine}`, button: "See the final reveal" }
      : a.next === "day"
        ? { line: "The game continues. Time to talk.", button: "Start the day" }
        : { line: "The game continues. Night falls.", button: "Start the night" };
  const host = view.players.find((p) => p.isHost)?.name ?? "The host";
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">{a.kind === "dawn" ? "🌅" : "⚖️"}</div>
        <h2>{a.kind === "dawn" ? `Morning of day ${a.round}` : "The town has voted"}</h2>
      </div>
      <div className="card tight stack" style={{ gap: 10 }}>
        {a.events.map((e, i) => (
          <div key={i}>{line(e)}</div>
        ))}
      </div>
      {/* Everyone alive gets a private line at dawn, news or not, so nobody's
          screen is visibly different from their neighbour's. */}
      {privateNews && a.kind === "dawn" && view.you.alive && <NoticeCard view={view} always />}
      <div className={`card tight center verdict-next ${a.next === "gameOver" ? "over" : ""}`}>
        <b>{next.line}</b>
      </div>
      {onContinue ? (
        <button className="primary full lg" onClick={onContinue}>
          {next.button}
        </button>
      ) : (
        <p className="center muted small">{host} will move everyone on.</p>
      )}
    </div>
  );
}

/**
 * Your own overnight news: a new role (a swap, an infection), coming back from
 * the dead, or a pack that changed. With `always`, says so when there's none.
 */
export function NoticeCard({ view, always = false }: { view: PlayerView; always?: boolean }) {
  const n = view.myNotice;
  if (!n) return always ? <div className="card tight small muted center">🔒 For you only: nothing changed for you overnight.</div> : null;
  const role = n.roleId ? ROLES[n.roleId] : null;
  const pack = view.players.filter((p) => view.packmates.includes(p.id)).map((p) => p.name);
  return (
    <div className="card tight stack notice" style={{ gap: 6 }}>
      <b className="small">🔒 For you only</b>
      {n.raised && <div>👻 You're back from the dead!</div>}
      {n.infected ? (
        <div>🧛 You were infected in the night. You're a <b>Werewolf</b> now — you win with the pack.</div>
      ) : (
        role && (
          <div>
            🎭 Your role changed overnight. You're now the <b>{role.name}</b> {role.emoji}.
            <div className="muted small">{role.blurb}</div>
          </div>
        )
      )}
      {n.packChanged && !n.infected && <div>🐺 Your pack changed in the night.</div>}
      {pack.length > 0 && (n.infected || n.packChanged || role) && (
        <div className="small">🐺 Your pack: <b>{pack.join(", ")}</b></div>
      )}
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
      <TownNews log={view.log} voteHistory={view.voteHistory} round={view.round} players={view.players} />
      <NoticeCard view={view} />
      <SilencedNote view={view} />
      <InspectHistory view={view} />
      <DetectionHistory view={view} />
      {view.config.chat !== false && <ChatPanel view={view} send={send} />}
      <PlayerList players={view.players} youId={view.you.id} showPresence={isHost} />
      <RolesInPlay roleIds={view.possibleRoles} wolves={view.wolfCount} />
      {isHost && (
        <button className="primary full lg" onClick={() => send({ type: "startVote" })}>
          Call a vote
        </button>
      )}
      {!isHost && (
        <p className="muted center small">
          {view.players.find((p) => p.isHost)?.name ?? "The host"} calls the vote when the talking's done.
        </p>
      )}
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
  const silentAndDead = !view.you.alive && view.chat.length === 0;
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

  // The dead can read the talk, but there's no point showing them an empty box.
  if (silentAndDead) return null;

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
 * Voting, one at a time in the day's order: each vote is public the moment
 * it's cast, so later voters know exactly where the earlier ones landed.
 */
export function VoteAction({ view, send }: { view: PlayerView; send: Send }) {
  const alive = view.players.filter((p) => p.alive && p.id !== view.you.id);
  const name = (id: string) => view.players.find((p) => p.id === id)?.name ?? "someone";
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
      {myTurn ? (
        <>
          <TargetGrid view={view} ids={alive.map((p) => p.id)} selected={null} onPick={(id) => send({ type: "castVote", targetId: id })} />
          <button className="ghost full" onClick={() => send({ type: "castVote", targetId: null })}>
            Abstain
          </button>
        </>
      ) : null}
      <VoteOrder view={view} name={name} />
      {view.config.chat !== false && <ChatPanel view={view} send={send} />}
    </div>
  );
}

/**
 * The whole vote in one list: the order, who's up, each vote as it's cast,
 * and a one-line standing at the top (a tie eliminates nobody — a wasted day).
 */
function VoteOrder({ view, name }: { view: PlayerView; name: (id: string) => string }) {
  if (view.voteOrder.length === 0) return null;
  const standing = Object.entries(view.voteTally)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1]);
  const most = standing[0]?.[1] ?? 0;
  const leaders = standing.filter(([, n]) => n === most).map(([id]) => name(id));
  return (
    <div className="card tight stack" style={{ gap: 8 }}>
      <div className="spread small">
        <b>Voting order</b>
        {most > 0 && (
          <span className="pill">
            {leaders.length > 1 ? `Tied at ${most}: ${leaders.join(", ")}` : `${leaders[0]} leads with ${most}`}
          </span>
        )}
      </div>
      {view.voteOrder.map((id, i) => {
        const done = id in view.votes;
        const up = id === view.voteTurn;
        return (
          <div key={id} className="spread small" style={{ opacity: done ? 0.7 : 1 }}>
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

/** Public banner: who's getting the cold shoulder today (the Gossip's mark). */
export function SilencedNote({ view }: { view: PlayerView }) {
  if (view.silencedIds.length === 0) return null;
  const names = view.silencedIds.map((id) => view.players.find((p) => p.id === id)?.name ?? "someone");
  return (
    <div className="card tight small">
      🗣️ The rumor mill has been busy. Getting the cold shoulder today — no talking, no vote: <b>{names.join(", ")}</b>
    </div>
  );
}

export function PlayerList({
  players,
  youId,
  showPresence = false,
}: {
  players: PublicPlayer[];
  youId: string;
  showPresence?: boolean;
}) {
  return (
    <div className="players grid">
      {players.map((p) => (
        <PlayerChip key={p.id} player={p} you={p.id === youId} showPresence={showPresence} />
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
  // Roles can move mid-game (swaps, infections); a player's final role decides their side.
  const won = (p: PublicPlayer) =>
    view.winner === "solo" ? p.id === view.soloWinnerId : !!p.roleId && ROLES[p.roleId]?.team === view.winner;
  return (
    <div className="stack">
      <div className="phase-banner">
        <div className="big">{emoji}</div>
        <h1>{headline}</h1>
      </div>
      <RevealGroup title="🏆 Won" players={view.players.filter(won)} />
      <RevealGroup title="Lost" players={view.players.filter((p) => !won(p))} />
      {onPlayAgain ? (
        <button className="primary full lg" onClick={onPlayAgain}>
          Deal another game
        </button>
      ) : (
        <p className="center muted">{view.players.find((p) => p.isHost)?.name ?? "The host"} can deal another game.</p>
      )}
      <button className="ghost full" onClick={onExit}>
        Leave
      </button>
    </div>
  );
}
