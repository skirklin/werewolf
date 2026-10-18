import type { Answer, ClueBody, Dossier, Requirement, RoomId, Secret } from "./types.js";
import type { Space } from "./space.js";
import { ALIBIS, SIGHTINGS } from "./content.js";

/** Is a clue consistent with candidate `i`? */
export function holds(space: Space, clue: ClueBody, i: number): boolean {
  return holdsIn(space.dossier, clue, space.answerAt(i), space.visitSets[space.visits[i]]);
}

/**
 * Is a clue consistent with this answer, and this evening for the culprit?
 * `breaks` is the other way round: the card shows the story can't be true.
 */
export function holdsIn(d: Dossier, clue: ClueBody, a: Answer, visited: readonly RoomId[]): boolean {
  const { agent, room, device } = a;
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
      return device !== clue.device;
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
      return device === clue.device;
    case "seen":
      // A sighting: says where the guest went, nothing more.
      return agent !== clue.agent || visited.includes(clue.room);
  }
}

/** Does this card break the story told about a guest who spent the evening in `evening`? */
export function breaks(d: Dossier, clue: ClueBody, story: Answer, evening: readonly RoomId[]): boolean {
  return !holdsIn(d, clue, story, evening);
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
      return clue.say === undefined
        ? `${agent(clue.agent)} has a solid alibi: not ${culprit}.`
        : ALIBIS[clue.say % ALIBIS.length].replace("{who}", agent(clue.agent));
    case "seen": {
      const text = SIGHTINGS[(clue.agent + clue.room) % SIGHTINGS.length];
      return cap(
        text
          .replace("{who}", agent(clue.agent))
          .replace("{at}", at(clue.room))
          .replace("{of}", `of the ${d.rooms[clue.room].name}`)
      );
    }
    case "visitors": {
      const names = clue.agents.map(agent);
      const room = `${d.rooms[clue.room].preposition} the ${d.rooms[clue.room].name}`;
      return names.length
        ? `The staff swear that ${list(names)} set foot ${room} this evening, and no other guest did.`
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

/** The Hall, where the body was found: a place to be, never the scene. */
export function hallOf(d: Dossier): number {
  return d.rooms.length;
}

/** "the Library", "the Hall". */
export function placeName(d: Dossier, place: number): string {
  return place === hallOf(d) ? "the Hall" : `the ${d.rooms[place].name}`;
}

/** "in the Library", "on the Terrace". */
export function atPlace(d: Dossier, place: number): string {
  return place === hallOf(d) ? "in the Hall" : `${d.rooms[place].preposition} the ${d.rooms[place].name}`;
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
