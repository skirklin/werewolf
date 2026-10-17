import {
  answerText,
  clueText,
  type Clue,
  leadDone,
  leadText,
  type Dossier,
  type How,
  type LogEntry,
  type Origin,
  type Part,
  type PlayerView,
} from "@party/foulplay";

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

/** Where a card came from, as printed on it. */
export function originText(view: PlayerView, o: Origin | undefined): string {
  if (!o) return "";
  const d = view.dossier;
  const guest = (id: string) => d.agents[view.players.findIndex((p) => p.id === id)]?.name ?? "someone";
  switch (o.via) {
    case "memory":
      return `${guest(o.who)}'s memory`;
    case "lead":
      return `${leadText(d, o.lead)} · found by ${nameOf(view, o.by)}, round ${o.round}`;
    case "victim":
      return `Found on ${guest(o.who)}'s body`;
  }
}

/** How you came to see a card. */
export function howText(view: PlayerView, h: How | undefined): string {
  if (!h) return "";
  switch (h.via) {
    case "dealt":
      return "your memory";
    case "drew":
      return "you found it";
    case "shown":
      return `${nameOf(view, h.by)} showed you`;
    case "record":
      return `on the record, from ${nameOf(view, h.by)}`;
  }
}

/** One public log entry, as the table would say it. */
export function logText(view: PlayerView, e: LogEntry): string {
  const d = view.dossier;
  const n = (id: string) => cap(nameOf(view, id));
  switch (e.t) {
    case "investigate":
      return `${n(e.who)} ${leadDone(d, e.lead)}.`;
    case "confer":
      return `${n(e.who)} conferred with ${nameOf(view, e.with)}.`;
    case "testify":
      return `${n(e.who)} testified.`;
    case "burn":
      return `${n(e.who)} burned a card.`;
    case "inquest":
      return `${n(e.who)} called an inquest: ${answerText(d, e.answer)}.`;
    case "inquestFailed":
      return `The inquest failed, ${e.yes} to ${e.no}.`;
    case "inquestPassed":
      return `The inquest's verdict stands, ${e.yes} to ${e.no}.`;
    case "death": {
      const seat = view.players.findIndex((p) => p.id === e.who);
      return `☠️ ${d.agents[seat].name} (${nameOf(view, e.who)}) was found dead.`;
    }
    case "round":
      return `Round ${e.round} is over.`;
    case "dawn":
      return "🌅 Dawn. The inspector has arrived.";
    case "voted":
      return e.value === null
        ? `The vote on ${PART_LABEL[e.part]} was tied${e.revote ? " again" : ""}.`
        : `The table settled ${PART_LABEL[e.part]}: ${optionName(d, e.part, e.value)}.`;
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
