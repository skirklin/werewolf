import { useState } from "react";

/**
 * The change log, newest first, in the village's own words (no cards, deals or
 * tech talk). Add a release at the top when you ship something players will notice.
 */
const CHANGELOG: { date: string; changes: string[] }[] = [
  {
    date: "2026-10-24",
    changes: [
      "⚰️ New: the Gravedigger. Each night they dig up a grave and learn who was buried there. Sits out games that reveal the dead's roles.",
      "🕯️ New: the Witness. When they die, their last words vouch for one living player: the whole town learns that player is truly on the village's side.",
      "🔄 Someone let their role slip? The host can start the game over, with new roles for everyone, at any point.",
      "🍺 The Village Drunk has wilder dreams: they may believe they're the Hunter, the Prince, the Cursed, the Tanner, the Poisoner — or a Werewolf, prowling with a pack only they can see. The real wolves never know.",
      "🍄 The Poisoner answers to no one now. Stay alive to the end and you win, whoever else does.",
      "🦠 The Infector's curse has a price: passing it on kills them.",
      "🎭 More special roles in every village. Plain Villagers only fill the empty seats.",
      "🎲 Every game is a different mix, chosen to keep it fair. Bigger groups bring more roles, and the host can switch any role on or off.",
      "🤫 Nobody is told how many wolves are out there — and there are never so many that a single death hands them the game.",
      "⚖️ When the wolves draw level with the village, the game isn't over while someone still holds a power that could turn it around.",
      "🗳️ The voting order is shuffled each game, then moves round each day, so nobody is always last.",
    ],
  },
  {
    date: "2026-10-22",
    changes: [
      "👑 New: the Prince. The first time the town votes them out, they reveal their crown and are spared.",
      "🔭 New: the Apprentice Seer. When the Seer is gone, they take up the crystal ball.",
      "😈 New: the Cursed. Bitten by the wolves, they don't die — they join them.",
      "🍄 New: the Poisoner. Each night they spike someone's supper, and that player's power fails the next night.",
    ],
  },
  {
    date: "2026-10-21",
    changes: [
      "⚖️ The host chooses who the game should favor: the wolves, the village, or neither.",
      "🌅 Each morning the village hears what happened in the night — and you hear privately if anything changed for you.",
      "🏹 The Hunter chooses a target every night. If the Hunter dies, the shot goes off.",
      "🗣️ Meet the Gossip: start a rumor at night, and tomorrow the town gives that player the cold shoulder — no talking, no vote.",
      "🧪 The Witch's healing potion saves whoever the wolves attack, though she never learns who.",
      "🔀 The Troublemaker and the Infector each have one use, on a night of their choosing.",
      "✅ Night falls once everyone has said they know their role, and the town hears the verdict after every vote.",
      "🏷️ Nicknames appear next to real names.",
    ],
  },
  {
    date: "2026-10-20",
    changes: [
      "🗳️ The town votes one at a time, in order, and every vote is final.",
      "🤐 Everyone has something to do at night, so a busy phone gives nothing away.",
      "💾 If the game drops out mid-round, it picks up right where you left off.",
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
