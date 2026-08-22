/**
 * Prompt variants, as data.
 *
 * A playbook is the guidance an agent gets on top of the rules: some for
 * everyone, some for the specific role it was dealt. Roles are secret, and a
 * playbook only ever sees the seat's own role, so nothing here can leak.
 *
 * Keeping them named and side by side is the point — the tournament plays them
 * against each other, so a claim like "telling wolves to counter-claim makes
 * them win more" becomes something you measure rather than assert.
 */
export interface Playbook {
  name: string;
  /** One line describing what this variant is trying out. */
  about: string;
  /** Advice for everyone, whatever they were dealt. */
  everyone?: string;
  /** Advice per roleId. Falls back to `village` / `werewolf` by team. */
  byRole?: Record<string, string>;
  village?: string;
  werewolf?: string;
}

/**
 * The original prompt, kept as the control so later variants have a fixed line
 * to beat. It says "blend in" to wolves and nothing about counter-claiming —
 * which is very likely why the first 30-game run produced zero bluffs.
 */
export const BASELINE: Playbook = {
  name: "baseline",
  about: "The original prompt: generic advice, no role-specific guidance.",
  everyone:
    "Be specific about who you suspect and why. Silence is suspicious, but so is talking too much.",
  werewolf:
    "You must blend in: sound like a villager, cast doubt on the innocent, and never reveal your packmates.",
  village:
    "If you have information, think about whether sharing it helps the village more than it paints a target on your back.",
};

/**
 * Teaches each role its actual job — including, for wolves, that lying about
 * your role is a legal and expected move. This is the variant aimed squarely at
 * the missing bluffing.
 */
export const SPECIALIST: Playbook = {
  name: "specialist",
  about: "Role-specific playbooks; wolves are told outright that bluffing is available.",
  everyone:
    "Talk like a person at a table, not an analyst. Commit to a name rather than describing " +
    "how you will decide. Watch who avoids committing.",
  byRole: {
    werewolf:
      "You are lying for a living and you are good at it. Blend in: reason out loud like a " +
      "villager would, and be willing to vote out one of your own if it buys you credibility. " +
      "If a Seer claims to have caught you, do not simply deny it — consider claiming Seer " +
      "yourself and naming someone else, so the town has two stories and no way to tell them " +
      "apart. Never name a packmate, and never sound certain about a night you slept through.",
    infector:
      "You hunt with the pack but you have one bite in reserve. Play the patient villager: " +
      "let others push accusations, agree carefully, and keep your name out of the argument.",
    henchman:
      "You know the wolves and they cannot save you. Build a reputation as a level-headed " +
      "villager early, then spend it defending a wolf once, when it matters most.",
    seer:
      "Your vision is the strongest thing the village has and it makes you the wolves' first " +
      "target. Decide deliberately when to spend it: claiming early wins one vote and probably " +
      "costs you the night, while sitting on it wastes information if you die anyway. If you " +
      "do claim, say exactly who you checked and on which night, and expect a wolf to claim " +
      "Seer against you.",
    doctor:
      "Never claim early — you are only useful while the wolves do not know who you are. " +
      "Protect whoever the village is treating as its Seer. Do not protect the same person " +
      "two nights running; the rules forbid it.",
    villager:
      "You have no powers, so your job is pressure: make people commit to a vote, notice who " +
      "changes their story, and count who benefited from each death.",
    hunter:
      "Your death takes someone with you, which makes you dangerous to kill. Say so, loudly — " +
      "a wolf may leave you alive rather than hand the village a free shot.",
    tanner:
      "You win only by being voted out. Act just guilty enough to be suspected without being " +
      "so obvious that people realise what you are and spare you out of spite.",
    drunk:
      "Play your role straight and share what you see. You have no reason to doubt yourself.",
  },
  village: "Work out who benefits from each death, and get the town to commit to a vote.",
  werewolf: "Blend in, misdirect, and never let the town settle on one of your own.",
};

/**
 * The same role knowledge, but pushed towards decisiveness. Tests whether the
 * village's problem is information or nerve — the first run deadlocked 29% of
 * its days.
 */
export const DECISIVE: Playbook = {
  name: "decisive",
  about: "Specialist advice plus heavy pressure to name a name and commit early.",
  everyone:
    "A day that ends in a tie is a day the wolves won for free. Name one specific player you " +
    "want voted out, in your first sentence, every single day. Never say you are 'still " +
    "gathering information' — say a name. If someone else has made a case you cannot beat, " +
    "back it publicly rather than splitting the vote.",
  byRole: SPECIALIST.byRole,
  village: SPECIALIST.village,
  werewolf: SPECIALIST.werewolf,
};

export const PLAYBOOKS: Record<string, Playbook> = {
  baseline: BASELINE,
  specialist: SPECIALIST,
  decisive: DECISIVE,
};

export function getPlaybook(name: string): Playbook {
  const found = PLAYBOOKS[name];
  if (!found)
    throw new Error(`Unknown playbook "${name}". Known: ${Object.keys(PLAYBOOKS).join(", ")}.`);
  return found;
}

/** The advice this seat should get, given the role it was actually dealt. */
export function adviceFor(playbook: Playbook, roleId: string | null, team: string): string {
  const specific = roleId ? playbook.byRole?.[roleId] : undefined;
  const fallback = team === "werewolf" ? playbook.werewolf : playbook.village;
  return [playbook.everyone, specific ?? fallback].filter(Boolean).join("\n");
}
