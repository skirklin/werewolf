import { requirementText, type PlayerView } from "@party/deaddrop";
import { looks } from "./text.js";

/** The public dossier: everything every player knows from the start. */
export function Dossier({ view }: { view: PlayerView }) {
  const d = view.dossier;
  return (
    <div className="stack">
      <p className="muted small">
        During {d.title.replace(/^The /, "the ")}, a mole handed secrets to their handler. Each hour a guest stays put
        or walks to a neighbouring room, and the mole had to pass the device&apos;s hiding place at or before the
        handoff.
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

      <div className="muted small group-label">🧳 Devices</div>
      <div className="stack" style={{ gap: 6 }}>
        {d.devices.map((x) => {
          const room = d.rooms[x.location];
          return (
            <div key={x.id} className="clue">
              <b>{x.name}</b> — hidden {room.preposition} the {room.name}
              <div>{requirementText(d, x.requirement)}</div>
              <span className="src">{x.blurb}</span>
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
            <span className="src">Leads to {r.adjacent.map((n) => d.rooms[n].name).join(", ")}</span>
          </div>
        ))}
      </div>

      <div className="muted small group-label">🕰️ Hours</div>
      <p className="small">{d.hours.join(" · ")}</p>
    </div>
  );
}
