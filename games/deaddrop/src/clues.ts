import type { Answer, Clue, ClueBody, Dossier, Points, Requirement, Secret, Subject } from "./types.js";
import type { Space } from "./space.js";

/** Is a clue consistent with candidate `i`? */
export function holds(space: Space, clue: ClueBody, i: number): boolean {
  const d = space.dossier;
  const agent = space.agent[i];
  const room = space.room[i];
  const visited = space.visitSets[space.visits[i]];
  switch (clue.kind) {
    case "visited":
      // Only says something about the mole's evening if this is the mole.
      return agent !== clue.agent || visited.includes(clue.room) === clue.is;
    case "never":
      return d.agents[agent].traits[clue.trait] !== clue.value || !visited.includes(clue.room);
    case "moleTrait":
      return (d.agents[agent].traits[clue.trait] === clue.value) === clue.is;
    case "handoffFeature":
      return d.rooms[room].features.includes(clue.feature) === clue.is;
    case "notRoom":
      return room !== clue.room;
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
  const value = (trait: string, v: string) =>
    d.traits.find((t) => t.id === trait)!.values.find((x) => x.id === v)!;
  const feature = (id: string) => d.features.find((f) => f.id === id)!;
  switch (clue.kind) {
    case "visited": {
      const r = d.rooms[clue.room];
      return clue.is
        ? `${agent(clue.agent)} was seen ${r.preposition} ${room(clue.room)}.`
        : `${agent(clue.agent)} never set foot ${r.preposition} ${room(clue.room)}.`;
    }
    case "never":
      return `Nobody who ${value(clue.trait, clue.value).pastPhrase} set foot ${d.rooms[clue.room].preposition} ${room(
        clue.room
      )} all evening.`;
    case "moleTrait": {
      const v = value(clue.trait, clue.value);
      return `The mole ${clue.is ? v.phrase : v.negPhrase}.`;
    }
    case "handoffFeature": {
      const f = feature(clue.feature);
      return `The handoff happened somewhere ${clue.is ? f.phrase : f.negPhrase}.`;
    }
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
    case "visited":
      return [
        { kind: "agent", id: clue.agent },
        { kind: "room", id: clue.room },
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

export function subjectText(d: Dossier, s: Subject): string {
  switch (s.kind) {
    case "agent":
      return d.agents[s.id].name;
    case "room":
      return `the ${d.rooms[s.id].name}`;
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
    ...d.traits.map((t): Subject => ({ kind: "trait", id: t.id })),
    ...d.features.map((f): Subject => ({ kind: "feature", id: f.id })),
  ];
}

/**
 * Every true statement of each kind about a scenario. Not all are useful; the
 * generator measures them and decides which go into play.
 */
export function trueClues(d: Dossier, secret: Secret): ClueBody[] {
  const { answer, visits } = secret;
  const out: ClueBody[] = [];
  const mole = d.agents[answer.agent];

  for (const a of d.agents)
    for (const r of d.rooms) out.push({ kind: "visited", agent: a.id, room: r.id, is: visits[a.id].includes(r.id) });

  for (const t of d.traits)
    for (const v of t.values)
      for (const r of d.rooms) {
        const wearers = d.agents.filter((a) => a.traits[t.id] === v.id);
        if (wearers.length && wearers.every((a) => !visits[a.id].includes(r.id)))
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

  for (const r of d.rooms) if (r.id !== answer.room) out.push({ kind: "notRoom", room: r.id });
  for (const x of d.devices) if (x.id !== answer.device) out.push({ kind: "notDevice", device: x.id });
  for (const a of d.agents) if (a.id !== answer.agent) out.push({ kind: "notAgent", agent: a.id });
  return out;
}

/**
 * Number the clues and price them. A clue's points come from how much it cuts
 * on its own (`bits`, measured against the dossier), split into thirds within
 * the case so every game has a spread of 1s, 2s and 3s.
 */
export function withIds(bodies: ClueBody[], bits: number[]): Clue[] {
  const order = bits.map((b, i) => ({ b, i })).sort((x, y) => x.b - y.b || x.i - y.i);
  const points = new Array<Points>(bodies.length);
  order.forEach(({ i }, rank) => {
    points[i] = rank < bodies.length / 3 ? 1 : rank < (2 * bodies.length) / 3 ? 2 : 3;
  });
  return bodies.map((b, id) => ({ ...b, id, points: points[id] }));
}

/** A device's requirement, as the dossier states it. */
export function requirementText(d: Dossier, r: Requirement): string {
  if (r.kind === "feature") {
    const f = d.features.find((x) => x.id === r.feature)!;
    return `The handoff must be somewhere ${r.is ? f.phrase : f.negPhrase}.`;
  }
  const t = d.traits.find((x) => x.id === r.trait)!;
  const values = r.values.map((v) => t.values.find((x) => x.id === v)!);
  if (values.length === 1) return `The courier ${values[0].phrase}.`; // "The courier wears gloves."
  return `The courier's ${t.label.toLowerCase()} must be ${values.map((v) => v.label.toLowerCase()).join(" or ")}.`;
}

/** "Dr. Moreau, with the umbrella, on the Terrace." */
export function answerText(d: Dossier, a: Answer): string {
  const room = d.rooms[a.room];
  return `${d.agents[a.agent].name}, with the ${d.devices[a.device].name.toLowerCase()}, ${room.preposition} the ${room.name}`;
}
