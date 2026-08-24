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
  /**
   * What every player at the table knows. This must include how the other side
   * behaves: at a real table, "wolves blend in and cast doubt on the innocent"
   * is public knowledge, not a wolf secret.
   *
   * Scoping that line to wolves only — which seemed tidy — took away the
   * villagers' guide to the opposition and dropped their lynch accuracy from
   * twice chance to chance. Private tactics belong in `byRole`; knowledge of
   * the game belongs here.
   */
  everyone?: string;
  /**
   * The instruction attached to a speaking turn. Kept here rather than
   * hardcoded because changing it silently once already cost the village its
   * ability to find wolves — see `guarded`.
   */
  speech?: string;
  /** Advice per roleId. Falls back to `village` / `werewolf` by team. */
  byRole?: Record<string, string>;
  village?: string;
  werewolf?: string;
}

/** Format-only speaking instruction: says how to answer, never what to think. */
const PLAIN_SPEECH =
  "It is your turn to speak to the town. Say one or two short sentences and finish " +
  "them — anything longer gets cut off, and a sentence that stops halfway reads to " +
  "everyone else as if you are dodging. Give only the words you would say out loud: " +
  "no notes, no narration.";

/**
 * The original prompt, kept as the control so later variants have a fixed line
 * to beat. It says "blend in" to wolves and nothing about counter-claiming.
 */
export const BASELINE: Playbook = {
  name: "baseline",
  about: "The original prompt: generic advice, no role-specific guidance.",
  speech: PLAIN_SPEECH,
  everyone:
    "Werewolves blend in: they sound like villagers, cast doubt on the innocent, and never " +
    "give up a packmate. Watch for it. Be specific about who you suspect and why. Silence is " +
    "suspicious, but so is talking too much.",
  werewolf: "Blend in, and never reveal your packmates.",
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
  speech: PLAIN_SPEECH,
  everyone:
    "Werewolves blend in: they sound like villagers, cast doubt on the innocent, and never " +
    "give up a packmate. A wolf caught out may claim a power role it does not have, so weigh " +
    "claims against behaviour rather than counting them. Talk like a person at a table, not " +
    "an analyst. Commit to a name rather than describing how you will decide.",
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
  speech: PLAIN_SPEECH,
  everyone:
    (SPECIALIST.everyone ?? "") +
    " A day that ends in a tie is a day the wolves won for free. Name one specific player you " +
    "want voted out, in your first sentence, every single day. Never say you are 'still " +
    "gathering information' — say a name. If someone else has made a case you cannot beat, " +
    "back it publicly rather than splitting the vote.",
  byRole: SPECIALIST.byRole,
  village: SPECIALIST.village,
  werewolf: SPECIALIST.werewolf,
};

/**
 * Baseline, but with the speaking turn reminding the speaker that the wolves
 * are listening. Added while fixing scratchpad leaks, without an A/B — and the
 * village's lynch accuracy fell from 56% to about chance, because a Seer told
 * its enemies are listening decides to sit on what it knows. Kept as a named
 * variant so the cost of that warning stays measurable instead of hypothetical.
 */
export const GUARDED: Playbook = {
  ...BASELINE,
  name: "guarded",
  about: "Baseline, but the speaking turn warns that the werewolves are listening.",
  speech:
    "It is your turn to speak to the town. Everyone hears this, including the " +
    "werewolves. Say one or two sentences, in your own voice — just the words you " +
    "would say out loud, nothing else.",
};

export const PLAYBOOKS: Record<string, Playbook> = {
  baseline: BASELINE,
  guarded: GUARDED,
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
