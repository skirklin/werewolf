import type { Answer, ClueBody, Dossier, Lead, Requirement, Secret } from "./types.js";
import type { Space } from "./space.js";

/** Is a clue consistent with candidate `i`? */
export function holds(space: Space, clue: ClueBody, i: number): boolean {
  const d = space.dossier;
  const agent = space.agent[i];
  const room = space.room[i];
  const visited = space.visitSets[space.visits[i]];
  switch (clue.kind) {
    case "visited":
      // Only says something about the culprit's evening if this is the culprit.
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
    case "visitors":
      // Only the culprit's evening is part of a candidate world.
      return clue.agents.includes(agent) === visited.includes(clue.room);
    case "whereabouts":
      return agent !== clue.agent || sameRooms(visited, clue.rooms);
    case "isRoom":
      return room === clue.room;
    case "isDevice":
      return space.device[i] === clue.device;
  }
}

function sameRooms(a: readonly number[], b: readonly number[]): boolean {
  return a.length === b.length && a.every((r) => b.includes(r));
}

/** The clue as the players read it. */
export function clueText(d: Dossier, clue: ClueBody): string {
  const { culprit, act, item } = d.theme;
  const agent = (id: number) => d.agents[id].name;
  const at = (id: number) => `${d.rooms[id].preposition} the ${d.rooms[id].name}`;
  const value = (trait: string, v: string) =>
    d.traits.find((t) => t.id === trait)!.values.find((x) => x.id === v)!;
  const feature = (id: string) => d.features.find((f) => f.id === id)!;
  switch (clue.kind) {
    // Sightings are guests' own memories, so they're in the first person; the
    // card's origin says whose memory it is.
    case "visited":
      return clue.is
        ? `"I saw ${agent(clue.agent)} ${at(clue.room)}."`
        : `"I'd swear ${agent(clue.agent)} never set foot ${at(clue.room)}."`;
    case "never": {
      const t = d.traits.find((x) => x.id === clue.trait)!;
      // "Nobody who wore no glasses" is a mouthful: say it the positive way round.
      if (clue.value === "no" && t.values.length === 2) {
        const other = t.values.find((v) => v.id !== clue.value)!;
        return `"Everyone who set foot ${at(clue.room)} ${other.pastPhrase}, I'd swear to it."`;
      }
      return `"Nobody who ${value(clue.trait, clue.value).pastPhrase} set foot ${at(clue.room)}, I'd swear to it."`;
    }
    case "moleTrait": {
      const v = value(clue.trait, clue.value);
      return clue.is ? v.evidence : `A witness is sure ${culprit} ${v.negPhrase}.`;
    }
    case "handoffFeature": {
      const f = feature(clue.feature);
      return clue.is ? f.evidence : f.notEvidence;
    }
    case "notRoom":
      return `${cap(at(clue.room).replace(/^(in|on) /, ""))} was searched top to bottom: ${act} didn't happen there.`;
    case "notDevice":
      return `No trace on the ${d.devices[clue.device].name.toLowerCase()}: not the ${item}.`;
    case "notAgent":
      return `${agent(clue.agent)} has a solid alibi: not ${culprit}.`;
    case "visitors": {
      const names = clue.agents.map(agent);
      const room = `${d.rooms[clue.room].preposition} the ${d.rooms[clue.room].name}`;
      return names.length
        ? `The staff swear the only guests ${room} all evening were ${list(names)}.`
        : `The staff swear no guest set foot ${room} all evening.`;
    }
    case "whereabouts": {
      const rooms = clue.rooms.map((r) => `the ${d.rooms[r].name}`);
      return `${agent(clue.agent)} spent the evening in ${list(rooms)}, and went nowhere else.`;
    }
    case "isRoom":
      return `Signs of a struggle ${at(clue.room)}: this is where ${act} happened.`;
    case "isDevice": {
      const x = d.devices[clue.device];
      return `The ${x.name.toLowerCase()} is missing from ${at(x.location).replace(/^(in|on) /, "")}: it's the ${item}.`;
    }
  }
}

/** "A, B and C". */
function list(xs: string[]): string {
  return xs.length <= 1 ? (xs[0] ?? "") : `${xs.slice(0, -1).join(", ")} and ${xs[xs.length - 1]}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** A stable key for a lead, used to index its stack. */
export function leadKey(l: Lead): string {
  switch (l.kind) {
    case "staff":
    case "search":
      return `${l.kind}:${l.room}`;
    case "alibi":
      return `alibi:${l.agent}`;
    case "body":
    case "body2":
      return l.kind;
  }
}

export function leadOfKey(key: string): Lead | null {
  const [kind, id] = key.split(":");
  const n = Number(id);
  if (kind === "body" || kind === "body2") return id === undefined ? { kind } : null;
  if (!Number.isInteger(n) || n < 0) return null;
  if (kind === "staff" || kind === "search") return { kind, room: n };
  if (kind === "alibi") return { kind, agent: n };
  return null;
}

export function sameLead(a: Lead, b: Lead): boolean {
  return leadKey(a) === leadKey(b);
}

/** "Question the staff about the Library", as a thing to do. */
export function leadText(d: Dossier, l: Lead): string {
  switch (l.kind) {
    case "staff":
      return `Question the staff about the ${d.rooms[l.room].name}`;
    case "alibi":
      return `Check ${d.agents[l.agent].name}'s alibi`;
    case "body":
      return "Examine the body";
    case "search":
      return `Search the ${d.rooms[l.room].name}`;
    case "body2":
      return "Examine the second body";
  }
}

/** "questioned the staff about the Library", as something someone did. */
export function leadDone(d: Dossier, l: Lead): string {
  switch (l.kind) {
    case "staff":
      return `questioned the staff about the ${d.rooms[l.room].name}`;
    case "alibi":
      return `checked ${d.agents[l.agent].name}'s alibi`;
    case "body":
      return "examined the body";
    case "search":
      return `searched the ${d.rooms[l.room].name}`;
    case "body2":
      return "examined the second body";
  }
}

/**
 * The leads a statement could turn up under. A sighting can come from the
 * staff who work that room or from checking that guest's alibi; a weapon
 * ruled out can show on the body or be found still where it was kept.
 */
export function leadsFor(d: Dossier, c: ClueBody): Lead[] {
  switch (c.kind) {
    case "visited":
      return [
        { kind: "staff", room: c.room },
        { kind: "alibi", agent: c.agent },
      ];
    case "never":
      return [{ kind: "staff", room: c.room }];
    case "moleTrait":
    case "handoffFeature":
      return [{ kind: "body" }];
    case "notRoom":
      return [{ kind: "search", room: c.room }];
    case "notDevice":
      return [{ kind: "body" }, { kind: "search", room: d.devices[c.device].location }];
    case "notAgent":
    case "whereabouts":
      return [{ kind: "alibi", agent: c.agent }];
    case "visitors":
      return [{ kind: "staff", room: c.room }];
    case "isRoom":
      return [{ kind: "search", room: c.room }];
    case "isDevice":
      return [{ kind: "search", room: d.devices[c.device].location }];
  }
}

/** Every lead that exists from the start of a case. */
export function allLeads(d: Dossier): Lead[] {
  return [
    { kind: "body" },
    ...d.rooms.map((r): Lead => ({ kind: "staff", room: r.id })),
    ...d.rooms.map((r): Lead => ({ kind: "search", room: r.id })),
    ...d.agents.map((a): Lead => ({ kind: "alibi", agent: a.id })),
  ];
}

/**
 * Every true statement of each kind about a scenario. Not all are useful; the
 * generator measures them and decides which go into play.
 */
export function trueClues(d: Dossier, secret: Secret): ClueBody[] {
  const { answer, visits } = secret;
  const out: ClueBody[] = [];
  const culprit = d.agents[answer.agent];

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
      const is = culprit.traits[t.id] === v.id;
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

/** An item's requirement, as the dossier states it: "Only if the killer is tall." */
export function requirementText(d: Dossier, r: Requirement): string {
  const { culprit, act } = d.theme;
  if (r.kind === "feature") {
    const f = d.features.find((x) => x.id === r.feature)!;
    return `Only if ${act} happened somewhere ${r.is ? f.phrase : f.negPhrase}.`;
  }
  const t = d.traits.find((x) => x.id === r.trait)!;
  const values = r.values.map((v) => t.values.find((x) => x.id === v)!);
  if (values.length === 1) return `Only if ${culprit} ${values[0].phrase}.`;
  // Everything but one value: say it through the one left out ("wears a hat").
  const others = t.values.filter((v) => !r.values.includes(v.id));
  if (others.length === 1) return `Only if ${culprit} ${others[0].negPhrase}.`;
  return `Only if ${culprit}'s ${t.label.toLowerCase()} is ${values.map((v) => v.label.toLowerCase()).join(" or ")}.`;
}

/** "Dr. Moreau, with the candlestick, in the Library." */
export function answerText(d: Dossier, a: Answer): string {
  const room = d.rooms[a.room];
  return `${d.agents[a.agent].name}, with the ${d.devices[a.device].name.toLowerCase()}, ${room.preposition} the ${room.name}`;
}

/**
 * Every statement a card could make, true or not, for the kinds a forger
 * would write. The generator picks forgeries from the false ones.
 */
export function possibleClues(d: Dossier): ClueBody[] {
  const out: ClueBody[] = [];
  for (const a of d.agents) {
    for (const r of d.rooms) {
      out.push({ kind: "visited", agent: a.id, room: r.id, is: true });
      out.push({ kind: "visited", agent: a.id, room: r.id, is: false });
    }
    out.push({ kind: "notAgent", agent: a.id });
  }
  for (const t of d.traits) for (const v of t.values) out.push({ kind: "moleTrait", trait: t.id, value: v.id, is: true });
  for (const f of d.features) for (const is of [true, false]) out.push({ kind: "handoffFeature", feature: f.id, is });
  for (const r of d.rooms) out.push({ kind: "notRoom", room: r.id });
  for (const x of d.devices) out.push({ kind: "notDevice", device: x.id });
  return out;
}
