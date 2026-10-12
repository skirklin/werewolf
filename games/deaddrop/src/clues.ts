import type { Clue, ClueBody, Dossier, Secret, Subject } from "./types.js";
import type { Space } from "./space.js";

/** Is a clue consistent with candidate `i`? */
export function holds(space: Space, clue: ClueBody, i: number): boolean {
  const d = space.dossier;
  const agent = space.agent[i];
  const hour = space.hour[i];
  const route = space.paths[space.path[i]];
  switch (clue.kind) {
    case "at":
      // Only says something about the mole's route if this is the mole.
      return agent !== clue.agent || (route[clue.hour] === clue.room) === clue.is;
    case "never":
      return d.agents[agent].traits[clue.trait] !== clue.value || !route.includes(clue.room);
    case "moleTrait":
      return (d.agents[agent].traits[clue.trait] === clue.value) === clue.is;
    case "handoffFeature":
      return d.rooms[route[hour]].features.includes(clue.feature) === clue.is;
    case "handoffHour":
      if (clue.cmp === "before") return hour < clue.hour;
      if (clue.cmp === "after") return hour > clue.hour;
      return hour !== clue.hour;
    case "notRoom":
      return route[hour] !== clue.room;
    case "notDevice":
      return space.device[i] !== clue.device;
    case "notAgent":
      return agent !== clue.agent;
  }
}

/** The clue as the players read it. */
export function clueText(d: Dossier, clue: ClueBody): string {
  const agent = (id: number) => d.agents[id].name;
  const room = (id: number) => `the ${d.rooms[id].name}`;
  const hour = (h: number) => d.hours[h];
  const value = (trait: string, v: string) =>
    d.traits.find((t) => t.id === trait)!.values.find((x) => x.id === v)!;
  const feature = (id: string) => d.features.find((f) => f.id === id)!;
  switch (clue.kind) {
    case "at":
      return `${agent(clue.agent)} was ${clue.is ? "" : "not "}${d.rooms[clue.room].preposition} ${room(clue.room)} at ${hour(clue.hour)}.`;
    case "never":
      return `Nobody who ${value(clue.trait, clue.value).pastPhrase} set foot in ${room(clue.room)} all evening.`;
    case "moleTrait": {
      const v = value(clue.trait, clue.value);
      return `The mole ${clue.is ? v.phrase : v.negPhrase}.`;
    }
    case "handoffFeature": {
      const f = feature(clue.feature);
      return `The handoff happened somewhere ${clue.is ? f.phrase : f.negPhrase}.`;
    }
    case "handoffHour":
      if (clue.cmp === "before") return `The handoff happened before ${hour(clue.hour)}.`;
      if (clue.cmp === "after") return `The handoff happened after ${hour(clue.hour)}.`;
      return `The handoff did not happen at ${hour(clue.hour)}.`;
    case "notRoom":
      return `The handoff did not happen ${d.rooms[clue.room].preposition} ${room(clue.room)}.`;
    case "notDevice":
      return `The ${d.devices[clue.device].name.toLowerCase()} was not used.`;
    case "notAgent":
      return `${agent(clue.agent)} is not the mole.`;
  }
}

/** What a clue is "about" — the subjects someone could ask for it by. */
export function clueSubjects(clue: ClueBody): Subject[] {
  switch (clue.kind) {
    case "at":
      return [
        { kind: "agent", id: clue.agent },
        { kind: "room", id: clue.room },
        { kind: "hour", id: clue.hour },
      ];
    case "never":
      return [
        { kind: "trait", id: clue.trait },
        { kind: "room", id: clue.room },
      ];
    case "moleTrait":
      return [{ kind: "trait", id: clue.trait }];
    case "handoffFeature":
      return [{ kind: "feature", id: clue.feature }];
    case "handoffHour":
      return [{ kind: "hour", id: clue.hour }];
    case "notRoom":
      return [{ kind: "room", id: clue.room }];
    case "notDevice":
      return [{ kind: "device", id: clue.device }];
    case "notAgent":
      return [{ kind: "agent", id: clue.agent }];
  }
}

export function sameSubject(a: Subject, b: Subject): boolean {
  return a.kind === b.kind && a.id === b.id;
}

export function isAbout(clue: ClueBody, subject: Subject): boolean {
  return clueSubjects(clue).some((s) => sameSubject(s, subject));
}

/** Broad groups of subjects, used when nobody holds anything on the exact one. */
export type Category = "people" | "places" | "times" | "devices";

export function categoryOf(s: Subject): Category {
  if (s.kind === "agent" || s.kind === "trait") return "people";
  if (s.kind === "room" || s.kind === "feature") return "places";
  if (s.kind === "hour") return "times";
  return "devices";
}

export function isInCategory(clue: ClueBody, category: Category): boolean {
  return clueSubjects(clue).some((s) => categoryOf(s) === category);
}

export function subjectText(d: Dossier, s: Subject): string {
  switch (s.kind) {
    case "agent":
      return d.agents[s.id].name;
    case "room":
      return `the ${d.rooms[s.id].name}`;
    case "hour":
      return d.hours[s.id];
    case "device":
      return `the ${d.devices[s.id].name.toLowerCase()}`;
    case "trait":
      return d.traits.find((t) => t.id === s.id)!.label.toLowerCase();
    case "feature":
      return `${d.features.find((f) => f.id === s.id)!.label.toLowerCase()} rooms`;
  }
}

/** Every askable subject in a dossier. */
export function allSubjects(d: Dossier): Subject[] {
  return [
    ...d.agents.map((a): Subject => ({ kind: "agent", id: a.id })),
    ...d.devices.map((x): Subject => ({ kind: "device", id: x.id })),
    ...d.rooms.map((r): Subject => ({ kind: "room", id: r.id })),
    ...d.hours.map((_, h): Subject => ({ kind: "hour", id: h })),
    ...d.traits.map((t): Subject => ({ kind: "trait", id: t.id })),
    ...d.features.map((f): Subject => ({ kind: "feature", id: f.id })),
  ];
}

/**
 * Every true statement of each kind about a scenario. Not all are useful; the
 * generator measures them and decides which go into play.
 */
export function trueClues(d: Dossier, secret: Secret): ClueBody[] {
  const { answer, schedule } = secret;
  const out: ClueBody[] = [];
  const mole = d.agents[answer.agent];

  for (const a of d.agents)
    for (let h = 0; h < d.hours.length; h++)
      for (const r of d.rooms)
        out.push({ kind: "at", agent: a.id, room: r.id, hour: h, is: schedule[a.id][h] === r.id });

  for (const t of d.traits)
    for (const v of t.values)
      for (const r of d.rooms) {
        const wearers = d.agents.filter((a) => a.traits[t.id] === v.id);
        if (wearers.length && wearers.every((a) => !schedule[a.id].includes(r.id)))
          out.push({ kind: "never", trait: t.id, value: v.id, room: r.id });
      }

  for (const t of d.traits)
    for (const v of t.values) {
      const is = mole.traits[t.id] === v.id;
      // For a two-valued trait, "not X" is just "Y" said another way.
      if (is || t.values.length > 2) out.push({ kind: "moleTrait", trait: t.id, value: v.id, is });
    }

  const room = d.rooms[answer.room];
  for (const f of d.features)
    out.push({ kind: "handoffFeature", feature: f.id, is: room.features.includes(f.id) });

  for (let h = 0; h < d.hours.length; h++) {
    if (h > answer.hour) out.push({ kind: "handoffHour", cmp: "before", hour: h });
    if (h < answer.hour) out.push({ kind: "handoffHour", cmp: "after", hour: h });
    if (h !== answer.hour) out.push({ kind: "handoffHour", cmp: "not", hour: h });
  }

  for (const r of d.rooms) if (r.id !== answer.room) out.push({ kind: "notRoom", room: r.id });
  for (const x of d.devices) if (x.id !== answer.device) out.push({ kind: "notDevice", device: x.id });
  for (const a of d.agents) if (a.id !== answer.agent) out.push({ kind: "notAgent", agent: a.id });
  return out;
}

export function withIds(bodies: ClueBody[]): Clue[] {
  return bodies.map((b, id) => ({ ...b, id }));
}
