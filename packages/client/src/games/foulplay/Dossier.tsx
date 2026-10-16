import type { PlayerView } from "@party/foulplay";
import { looks } from "./text.js";

/** The public dossier: everything every player knows from the start. */
export function Dossier({ view }: { view: PlayerView }) {
  const d = view.dossier;
  return (
    <div className="stack">
      <p className="muted small">
        {d.theme.story} The murder happened in a room the killer visited, and the killer must also have visited the
        room where the weapon was kept.
      </p>

      <div className="muted small group-label">🕴️ Suspects</div>
      <div className="stack" style={{ gap: 6 }}>
        {d.agents.map((a) => (
          <div key={a.id} className="clue">
            <b>{a.name}</b>
            <span className="src">{looks(d, a.id)}</span>
          </div>
        ))}
      </div>

      <div className="muted small group-label">🔪 Weapons</div>
      <div className="stack" style={{ gap: 6 }}>
        {d.devices.map((x) => {
          const room = d.rooms[x.location];
          return (
            <div key={x.id} className="clue">
              <b>{x.name}</b> <span className="muted small">kept {room.preposition} the {room.name}</span>
              <div>{x.blurb}</div>
            </div>
          );
        })}
      </div>

      <div className="muted small group-label">🚪 The house</div>
      <div className="stack" style={{ gap: 6 }}>
        {d.rooms.map((r) => (
          <div key={r.id} className="clue">
            <b>{r.name}</b>{" "}
            <span className="muted small">
              {r.features.map((f) => d.features.find((x) => x.id === f)!.label.toLowerCase()).join(", ")}
            </span>
          </div>
        ))}
      </div>

    </div>
  );
}
