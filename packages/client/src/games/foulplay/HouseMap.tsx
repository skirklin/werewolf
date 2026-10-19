import { useState } from "react";
import { clueText, hallOf, type Action, type PlayerView } from "@party/foulplay";
import { cap, cardKind, cards } from "./text.js";

type Act = (a: Action) => void;

/** Where each room sits on the floor plan, by name. Anything unknown is laid out after. */
const AREAS: Record<string, string> = {
  Ballroom: "ballroom",
  Bar: "bar",
  Library: "library",
  Hall: "hall",
  Study: "study",
  Terrace: "terrace",
  Garden: "garden",
};

const FEATURE_ICON: Record<string, string> = {
  outdoors: "🌳",
  crowded: "👥",
  quiet: "🤫",
  dark: "🌑",
  seating: "🪑",
};

/** A colour per seat, so a guest is the same dot everywhere. */
export const SEAT_COLORS = ["#f2a65a", "#6cc5e8", "#b48cf2", "#7ed492", "#f27a9b", "#e8d36c", "#8ea6ff", "#e89a6c"];

/**
 * The house as a floor plan: every room, who's in it, how much evidence is
 * left, and (when you've chosen to show your secrets) what ties each room to
 * you. Tap a room for the details, and on your move, to go there or join
 * someone in it. Nothing is decided for you.
 */
export function HouseMap({ view, act, secrets }: { view: PlayerView; act: Act | null; secrets: boolean }) {
  const d = view.dossier;
  const hall = hallOf(d);
  const me = view.you.seat;
  const mine = view.players[me].place;
  const [selected, setSelected] = useState<number | null>(null);
  const active = "active" in view.phase ? view.phase.active : -1;
  const places = [...d.rooms.map((r) => r.id), hall];
  const story = view.you.story;
  const storyWeaponRoom = d.devices[story.device].location;
  const g = view.guilty;
  const nameOf = (place: number) => (place === hall ? "Hall" : d.rooms[place].name);

  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="spread">
        <b>🏚️ Ashcombe Manor</b>
        <span className="muted small">
          {view.phase.kind === "vote" || view.phase.kind === "over" ? "Dawn" : `Round ${view.round} of ${view.rounds}`}
        </span>
      </div>
      <div className="manor">
        {places.map((place) => {
          const here = view.players.map((p, i) => ({ p, i })).filter(({ p }) => p.alive && p.place === place);
          const room = place === hall ? null : d.rooms[place];
          const kept = d.devices.filter((x) => x.location === place);
          const area = AREAS[nameOf(place)];
          const isStoryRoom = secrets && place === story.room;
          const isStoryWeapon = secrets && place === storyWeaponRoom;
          const went = secrets && view.you.evening.includes(place);
          return (
            <button
              key={place}
              className={`room ${area ?? ""} ${room?.features.includes("outdoors") ? "outdoors" : ""} ${place === mine ? "mine" : ""} ${selected === place ? "selected" : ""}`}
              style={area ? { gridArea: area } : undefined}
              onClick={() => setSelected(selected === place ? null : place)}
            >
              <span className="room-head">
                <b>{nameOf(place)}</b>
                <Pile n={view.counts[place]} />
              </span>
              <span className="room-tags">
                {room?.features.map((f) => (
                  <span key={f} title={f}>{FEATURE_ICON[f] ?? "·"}</span>
                ))}
                {place === hall && <span title="The body">⚰️</span>}
                {kept.map((x) => (
                  <span key={x.id} className="kept">{x.name}</span>
                ))}
              </span>
              {(isStoryRoom || isStoryWeapon || went) && (
                <span className="room-marks">
                  {isStoryRoom && <span className="mark story">📌 {g ? "the real scene" : "your story's room"}</span>}
                  {isStoryWeapon && <span className="mark story">🗡️ {g ? "the real weapon's home" : "your story's weapon"}</span>}
                  {went && <span className="mark went">👣 you went here</span>}
                </span>
              )}
              <span className="tokens">
                {here.map(({ p, i }) => (
                  <span key={p.id} className={`token ${i === me ? "you" : ""} ${i === active ? "active" : ""}`}>
                    <span className="dot" style={{ background: SEAT_COLORS[i % SEAT_COLORS.length] }} />
                    {i === me ? "You" : p.name}
                  </span>
                ))}
              </span>
            </button>
          );
        })}
      </div>
      {selected === null ? (
        <p className="muted small center" style={{ margin: 0 }}>
          {act ? "Your move: tap a room to go there, or to join someone in it." : "Tap a room for details."}
          {secrets ? " 📌 🗡️ 👣 are only on your screen." : ""}
        </p>
      ) : (
        <RoomDetail view={view} place={selected} act={act} secrets={secrets} onDone={() => setSelected(null)} />
      )}
    </div>
  );
}

/** A little face-down pile: one card back per card, up to six. */
function Pile({ n }: { n: number }) {
  return (
    <span className="pile" title={`${cards(n)} left`}>
      {Array.from({ length: Math.min(n, 6) }, (_, i) => (
        <span key={i} className="back" />
      ))}
      <span className="n">{n}</span>
    </span>
  );
}

function RoomDetail({
  view,
  place,
  act,
  secrets,
  onDone,
}: {
  view: PlayerView;
  place: number;
  act: Act | null;
  secrets: boolean;
  onDone: () => void;
}) {
  const d = view.dossier;
  const hall = hallOf(d);
  const me = view.you.seat;
  const room = place === hall ? null : d.rooms[place];
  const here = view.players.map((p, i) => ({ p, i })).filter(({ p, i }) => p.alive && p.place === place && i !== me);
  const mine = view.players[me].place === place;
  const kept = d.devices.filter((x) => x.location === place);
  const story = view.you.story;
  const g = view.guilty;
  const name = place === hall ? "the Hall" : `the ${room!.name}`;
  const go = (a: Action) => {
    act?.(a);
    onDone();
  };

  const ties: string[] = [];
  if (secrets && place === story.room) ties.push(g ? "📌 The real scene." : "📌 Your story's room.");
  if (secrets && kept.some((x) => x.id === story.device)) ties.push(g ? "🗡️ The real weapon is kept here." : "🗡️ Your story's weapon is kept here.");
  if (secrets && view.you.evening.includes(place)) ties.push("👣 You went in here this evening.");

  return (
    <div className="card tight stack room-detail" style={{ gap: 6 }}>
      <div className="spread">
        <b>{cap(name)}</b>
        <button className="ghost mini" onClick={onDone}>Close</button>
      </div>
      <span className="muted small">
        {room ? room.features.map((f) => `${FEATURE_ICON[f] ?? ""} ${d.features.find((x) => x.id === f)!.label.toLowerCase()}`).join(" · ") : "⚰️ Where the body was found. Never the scene."}
        {kept.length > 0 && ` · kept here: ${kept.map((x) => x.name.toLowerCase()).join(", ")}`}
      </span>
      <span className="small">
        {cards(view.counts[place])} left.{" "}
        {here.length ? `Here: ${here.map(({ p }) => p.name).join(", ")}.` : "Nobody else is here."}
        {mine ? " You're here." : ""}
      </span>
      {ties.map((t) => (
        <span key={t} className="small tie">{t}</span>
      ))}
      {g?.stacks && secrets && (
        <div className="stack" style={{ gap: 4 }}>
          <span className="muted small">What&apos;s here, top first (only the killer sees this):</span>
          {g.stacks[place].length === 0 && <span className="muted small">Nothing.</span>}
          {g.stacks[place].map((c, i) => (
            <div key={c.id} className="small">
              {i === 0 ? "▶ " : "· "}
              <b>{cardKind(c).label}:</b> {clueText(d, c)}
            </div>
          ))}
        </div>
      )}
      {act && (
        <div className="btn-row">
          <button className="primary" onClick={() => go(mine ? { type: "stay" } : { type: "move", to: place })}>
            {mine ? "Stay here" : `Go to ${name}`}
          </button>
          {here.map(({ p }) => (
            <button key={p.id} onClick={() => go({ type: "join", who: p.id })}>
              Join {p.name}
            </button>
          ))}
        </div>
      )}
      {act && here.length > 0 && (
        <span className="muted small">
          With company here, whatever anyone finds in this room goes straight on the record: yours, and theirs.
        </span>
      )}
    </div>
  );
}
