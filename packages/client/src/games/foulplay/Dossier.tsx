import { requirementText, type PlayerView } from "@party/foulplay";
import { looks, nameOf } from "./text.js";

/** The case file: everything every player knows from the start. */
export function Dossier({ view }: { view: PlayerView }) {
  const d = view.dossier;
  return (
    <div className="stack">
      <p className="muted small">{d.theme.story}</p>
      <p className="muted small">
        The murder happened in a room the killer visited, and the killer also visited the room the weapon was taken
        from.
      </p>

      <div className="muted small group-label">🕴️ The guests</div>
      <div className="stack" style={{ gap: 6 }}>
        {d.agents.map((a) => {
          const p = view.players[a.id];
          return (
            <div key={a.id} className="clue">
              <b>
                {p.alive ? "" : "☠️ "}
                {a.name}
              </b>{" "}
              <span className="muted small">played by {nameOf(view, p.id)}</span>
              <div>{looks(d, a.id)}</div>
              <span className="src">{a.motive}</span>
            </div>
          );
        })}
      </div>

      <div className="muted small group-label">🔪 Weapons</div>
      <div className="stack" style={{ gap: 6 }}>
        {d.devices.map((x) => {
          const room = d.rooms[x.location];
          return (
            <div key={x.id} className="clue">
              <b>{x.name}</b> <span className="muted small">kept {room.preposition} the {room.name}</span>
              <div>{x.blurb}</div>
              <span className="src">{requirementText(d, x.requirement)}</span>
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
