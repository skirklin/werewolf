import { useState } from "react";

/** The change log, newest first. Add a release at the top when you ship something players will notice. */
const CHANGELOG: { date: string; changes: string[] }[] = [
  {
    date: "2026-10-24",
    changes: [
      "🔄 Card seen, or a question gave a role away? Until the first dawn, the host can redeal everyone's roles.",
      "🍺 The Drunk can now believe they're the Hunter, Prince, Cursed, Tanner, Poisoner — or a Werewolf, hunting with a pack it imagines. The real pack never knows.",
      "🍄 The Poisoner plays for themself now: they win if they're alive at the end, whoever wins.",
      "🦠 The Infector's curse costs them: they die passing it on.",
      "🃏 Deals are mostly special roles; Villagers only fill the gaps. The wolf count varies, but never so high that one death hands them the game.",
      "🎲 Deals are picked at random among the balanced ones, so games vary. Roles join automatically as the table grows; the host can switch any of them On or Off.",
      "🤫 Nobody is told how many wolves there are.",
      "⚖️ When the wolves tie the village, the game goes on while someone still holds a power that could break the tie.",
      "🗳️ The vote order is random each game (then rotates each day), so whoever joined last doesn't always vote last.",
    ],
  },
  {
    date: "2026-10-22",
    changes: [
      "👑 New: Prince — spared (and revealed) the first time the town votes them out.",
      "🔭 New: Apprentice Seer — becomes the Seer once there's no Seer left.",
      "😈 New: Cursed — bitten by the wolves, they turn into one instead of dying.",
      "🍄 New: Poisoner — each night, someone's power quietly fails the following night.",
    ],
  },
  {
    date: "2026-10-21",
    changes: [
      "⚖️ Deals balance themselves: every role is worth points, and the host picks Wolves favored, Even or Village favored.",
      "🌅 Every night ends with a dawn announcement, plus a private note if something changed for you.",
      "🏹 The Hunter picks a target every night; if they die, the shot fires on its own.",
      "🗣️ The Silencer is now the Gossip: whoever gets the cold shoulder can't speak or vote that day.",
      "🧪 The Witch's heal saves whoever the wolves attack, without her learning who.",
      "🔀 The Troublemaker and Infector each get one use, on a night of their choosing.",
      "✅ Night falls once everyone has tapped \"I know my role\". Each vote ends with a result screen.",
      "🏷️ Nicknames show next to real names.",
    ],
  },
  {
    date: "2026-10-20",
    changes: [
      "🗳️ Votes are cast one at a time, in order, and are final.",
      "🤐 Everyone gets something to tap at night, so a busy phone gives nothing away.",
      "💾 Games in progress survive server restarts.",
    ],
  },
];

const SEEN_KEY = "werewolf.whatsNewSeen";

function lastSeen(): string | null {
  try {
    return localStorage.getItem(SEEN_KEY);
  } catch {
    return null;
  }
}

/** A collapsed "What's new" card for the lobby, marked New until opened. */
export function WhatsNew() {
  const [open, setOpen] = useState(false);
  const [isNew, setIsNew] = useState(() => lastSeen() !== CHANGELOG[0].date);
  const show = () => {
    setOpen(true);
    setIsNew(false);
    try {
      localStorage.setItem(SEEN_KEY, CHANGELOG[0].date);
    } catch {
      /* private mode: it'll just say New again next time */
    }
  };
  if (!open)
    return (
      <button className="card tight spread roles-summary" onClick={show}>
        <span className="small"><b>✨ What's new</b></span>
        {isNew ? <span className="pill">New</span> : <span className="muted small">Show</span>}
      </button>
    );
  return (
    <div className="card tight stack">
      <div className="spread">
        <b className="small">✨ What's new</b>
        <button className="ghost small" onClick={() => setOpen(false)}>Hide</button>
      </div>
      {CHANGELOG.map((release) => (
        <div key={release.date} className="stack" style={{ gap: 4 }}>
          <div className="section-title">{formatDate(release.date)}</div>
          {release.changes.map((c) => (
            <div key={c} className="small">{c}</div>
          ))}
        </div>
      ))}
    </div>
  );
}

const formatDate = (iso: string) =>
  new Date(`${iso}T12:00:00`).toLocaleDateString(undefined, { month: "long", day: "numeric" });
