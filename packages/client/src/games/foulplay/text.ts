import { answerText, subjectText, type Dossier, type LogEntry, type PlayerView, type Subject } from "@party/foulplay";

export function nameOf(view: PlayerView, id: string): string {
  if (id === view.you.id) return "you";
  return view.players.find((p) => p.id === id)?.name ?? "someone";
}

/** Capitalise the first letter, for names that may be "you". */
export const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const pts = (n: number) => `${n} point${n === 1 ? "" : "s"}`;
export const cards = (n: number) => `${n} card${n === 1 ? "" : "s"}`;

export function subjectsText(d: Dossier, s: readonly Subject[]): string {
  return s.map((x) => subjectText(d, x)).join(" and ");
}

/** One public log entry, as the table would say it. */
export function logText(view: PlayerView, e: LogEntry): string {
  const d = view.dossier;
  const n = (id: string) => nameOf(view, id);
  switch (e.t) {
    case "ask":
      return `${cap(n(e.who))} asked the table about ${subjectsText(d, e.subjects)}.`;
    case "offers": {
      const made = e.offers.filter((o) => o.cards > 0);
      if (!made.length) return "Nobody offered anything.";
      return `Offers: ${made.map((o) => `${n(o.who)} ${pts(o.points)} on ${cards(o.cards)}`).join("; ")}.`;
    }
    case "deal":
      return `${cap(n(e.asker))} took ${n(e.with)}'s ${pts(e.gotPoints)} and paid back ${pts(e.paidPoints)} on ${cards(
        e.paidCards
      )}.`;
    case "noDeal":
      return `${cap(n(e.asker))} turned every offer down.`;
    case "accuse":
      return `${cap(n(e.who))} accused ${answerText(d, e.answer)}: ${e.correct ? "correct!" : "wrong."}`;
    case "round":
      return `Round ${e.round} is over. Everyone discarded half their hand and drew fresh cards.`;
  }
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
