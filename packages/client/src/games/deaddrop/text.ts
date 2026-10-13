import {
  answerText,
  categoryOf,
  subjectText,
  type Dossier,
  type LogEntry,
  type PlayerView,
  type Subject,
} from "@party/deaddrop";

export const CATEGORY_LABEL = { people: "people", places: "places", times: "times", devices: "devices" } as const;

export function nameOf(view: PlayerView, id: string): string {
  if (id === view.you.id) return "you";
  return view.players.find((p) => p.id === id)?.name ?? "someone";
}

/** Capitalise the first letter, for names that may be "you". */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** One public log entry, as the table would say it. */
export function logText(view: PlayerView, e: LogEntry): string {
  const d = view.dossier;
  const n = (id: string) => nameOf(view, id);
  switch (e.t) {
    case "ask":
      return `${cap(n(e.from))} asked ${n(e.to)} about ${subjectText(d, e.subject)}.`;
    case "gave":
      return e.fallback
        ? `${cap(n(e.from))} had nothing on ${subjectText(d, e.subject)}, so gave ${n(e.to)} something about ${
            CATEGORY_LABEL[categoryOf(e.subject)]
          }.`
        : `${cap(n(e.from))} gave ${n(e.to)} a clue about ${subjectText(d, e.subject)}.`;
    case "nothing":
      return `${cap(n(e.from))} had nothing new for ${n(e.to)}.`;
    case "declined":
      return `${cap(n(e.who))} didn't ask anything back.`;
    case "accuse":
      return `${cap(n(e.who))} accused ${answerText(d, e.answer)} — ${e.correct ? "correct!" : "wrong."}`;
  }
}

export interface SubjectGroup {
  label: string;
  subjects: { subject: Subject; label: string }[];
}

/** Every askable subject, grouped the way the picker shows them. */
export function subjectGroups(d: Dossier): SubjectGroup[] {
  return [
    { label: "Suspects", subjects: d.agents.map((a) => ({ subject: { kind: "agent", id: a.id }, label: a.name })) },
    { label: "Looks", subjects: d.traits.map((t) => ({ subject: { kind: "trait", id: t.id }, label: t.label })) },
    { label: "Rooms", subjects: d.rooms.map((r) => ({ subject: { kind: "room", id: r.id }, label: r.name })) },
    {
      label: "Room features",
      subjects: d.features.map((f) => ({ subject: { kind: "feature", id: f.id }, label: f.label })),
    },
    { label: "Hours", subjects: d.hours.map((h, i) => ({ subject: { kind: "hour", id: i }, label: h })) },
    { label: "Devices", subjects: d.devices.map((x) => ({ subject: { kind: "device", id: x.id }, label: x.name })) },
  ];
}

/** "Fedora, black coat, tall, …" — an agent's look in a few words. */
export function looks(d: Dossier, agentId: number): string {
  const a = d.agents[agentId];
  return d.traits
    .map((t) => {
      const v = t.values.find((x) => x.id === a.traits[t.id])!;
      return t.id === "coat" ? `${v.label.toLowerCase()} coat` : v.label.toLowerCase();
    })
    .join(", ");
}
