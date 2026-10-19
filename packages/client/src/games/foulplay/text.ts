import { answerText, atPlace, clueText, placeName, type Clue, type Dossier, type LogEntry, type Part, type PlayerView } from "@party/foulplay";

export function nameOf(view: PlayerView, id: string): string {
  if (id === view.you.id) return "you";
  return view.players.find((p) => p.id === id)?.name ?? "someone";
}

/** "Sam (Dr. Moreau)": a player and the guest they're playing. */
export function seatName(view: PlayerView, seat: number): string {
  const p = view.players[seat];
  const who = p.id === view.you.id ? "You" : p.name;
  return `${who} (${view.dossier.agents[seat].name})`;
}

/** Capitalise the first letter, for names that may be "you". */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const cards = (n: number) => `${n} card${n === 1 ? "" : "s"}`;

export const PART_LABEL: Record<Part, string> = { agent: "who", device: "with what", room: "where" };

export function optionName(d: Dossier, part: Part, value: number): string {
  if (part === "agent") return d.agents[value].name;
  if (part === "device") return d.devices[value].name;
  return d.rooms[value].name;
}

/** Where a card you've seen came from, and how you know it. */
export function sourceText(view: PlayerView, id: number): string {
  const d = view.dossier;
  const rec = view.record.find((r) => r.clue === id);
  if (rec) {
    const who = cap(nameOf(view, rec.by));
    if (rec.how === "witnessed") return `Found ${atPlace(d, rec.place!)} by ${who}, with others watching · round ${rec.round}`;
    if (rec.how === "body") return `Found on a body ${atPlace(d, rec.place!)}`;
    return `Testified by ${who} · round ${rec.round}`;
  }
  const how = view.you.how[id];
  if (!how) return "";
  if (how.via === "memory") return "Your own memory";
  if (how.via === "found") return `You found it ${atPlace(d, how.place)}, alone · round ${how.round}`;
  return "";
}

/** One public log entry, as the table would say it. */
export function logText(view: PlayerView, e: LogEntry): string {
  const d = view.dossier;
  const n = (id: string) => cap(nameOf(view, id));
  switch (e.t) {
    case "move":
      return e.joined
        ? `${n(e.who)} joined ${nameOf(view, e.joined)} ${atPlace(d, e.to)}.`
        : `${n(e.who)} ${e.who === view.you.id ? "are" : "is"} ${atPlace(d, e.to)}.`;
    case "search":
      return e.found === "public"
        ? `${n(e.who)} searched ${placeName(d, e.place)} in company: the find went on the record.`
        : e.found === "private"
          ? `${n(e.who)} searched ${placeName(d, e.place)} alone, and took something.`
          : `${n(e.who)} searched ${placeName(d, e.place)}: nothing left there.`;
    case "watch":
      return `${n(e.who)} kept watch ${atPlace(d, e.place)}.`;
    case "testify":
      return `${n(e.who)} testified.`;
    case "night":
      return `🌙 Night falls after round ${e.round}.`;
    case "murder": {
      const seat = view.players.findIndex((p) => p.id === e.who);
      return `☠️ ${d.agents[seat].name} (${nameOf(view, e.who)}) was found dead ${atPlace(d, e.place)}.`;
    }
    case "quiet":
      return "☀️ Morning. Everyone survived the night.";
    case "dawn":
      return "🌅 Dawn. The inspector has arrived, and the table must vote.";
    case "accuse":
      return `🕯️ ${n(e.who)} called the Reconstruction: ${answerText(d, e.answer)}.`;
    case "verdict": {
      const said = (ids: string[]) => (ids.length ? ids.map((id) => cap(nameOf(view, id))).join(", ") : "nobody");
      return e.accepted
        ? `The table agreed (yes: ${said(e.yes)}; no: ${said(e.no)}).`
        : `The table wasn't convinced (yes: ${said(e.yes)}; no: ${said(e.no)}). Play goes on.`;
    }
    case "voted": {
      const tally = e.tally.map(([v, n]) => `${optionName(d, e.part, v)} ${n}`).join(", ");
      if (e.value === null) return `The vote on ${PART_LABEL[e.part]} was tied (${tally}). Vote again between them.`;
      const settled = optionName(d, e.part, e.value);
      return e.inspector
        ? `Tied again (${tally}), so the inspector chose ${PART_LABEL[e.part]}: ${settled}.`
        : `The table settled ${PART_LABEL[e.part]}: ${settled} (${tally}).`;
    }
  }
}

/** "Fedora, black coat, tall, …": a guest's look in a few words. */
export function looks(d: Dossier, agentId: number): string {
  const a = d.agents[agentId];
  return d.traits
    .map((t) => {
      const v = t.values.find((x) => x.id === a.traits[t.id])!;
      return t.id === "coat" ? `${v.label.toLowerCase()} coat` : v.label.toLowerCase();
    })
    .join(", ");
}

/** A card's text, or for what your role tells you (negative ids), how you know. */
export function cardText(view: PlayerView, c: Clue): string {
  if (c.id >= 0) return clueText(view.dossier, c);
  if (view.you.role === "innocent") return "You know it wasn't you.";
  if (view.you.role === "accomplice") return "You know who did it.";
  return "You know: you did it.";
}

/** What sort of card this is, so its job is plain at a glance. */
export function cardKind(c: Clue): { icon: string; label: string; tone: "clear" | "point" | "plain" } {
  switch (c.kind) {
    case "notAgent":
      return { icon: "🛡️", label: "Alibi", tone: "clear" };
    case "notRoom":
      return { icon: "🚪", label: "Room cleared", tone: "clear" };
    case "notDevice":
      return { icon: "🔪", label: "Weapon cleared", tone: "clear" };
    case "seen":
      return { icon: "👁️", label: "Sighting", tone: "point" };
    case "visitors":
      return { icon: "📋", label: "Staff record", tone: "plain" };
    case "whereabouts":
      return { icon: "🕰️", label: "A guest's evening", tone: "plain" };
    case "visited":
    case "never":
      return { icon: "💭", label: "Memory", tone: "plain" };
    case "moleTrait":
    case "handoffFeature":
      return { icon: "⚰️", label: "From the body", tone: "plain" };
    case "isRoom":
      return { icon: "🩸", label: "The scene", tone: "point" };
    case "isDevice":
      return { icon: "🩸", label: "The weapon", tone: "point" };
  }
}
