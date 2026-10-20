import { useState, type ReactNode } from "react";
import {
  assignableSpecialRoles,
  poolEligibleRoles,
  recommendedConfig,
  validateConfig,
  previewComposition,
  DEFAULT_WEREWOLF_RATIO,
  type GameConfig,
  type RoleSelection,
  type RoleDef,
} from "@party/werewolf";

const RATIO_PRESETS: { label: string; value: number }[] = [
  { label: "Light", value: 0.2 },
  { label: "Standard", value: DEFAULT_WEREWOLF_RATIO },
  { label: "Heavy", value: 0.34 },
];

const TEAM_SECTIONS: { team: RoleDef["team"]; label: string }[] = [
  { team: "village", label: "🏡 Village team" },
  { team: "werewolf", label: "🐺 Werewolf team" },
  { team: "solo", label: "🎭 Solo" },
];

/** Render a set of roles grouped under team headers, in a fixed team order. */
function TeamGroups({
  roles,
  render,
  grid = false,
}: {
  roles: RoleDef[];
  render: (r: RoleDef) => ReactNode;
  /** Lay the group out as a two-column grid of compact toggles. */
  grid?: boolean;
}) {
  return (
    <>
      {TEAM_SECTIONS.map(({ team, label }) => {
        const group = roles.filter((r) => r.team === team);
        if (group.length === 0) return null;
        return (
          <div key={team} className="stack" style={{ gap: 8 }}>
            <div className="section-title">{label}</div>
            <div className={grid ? "role-grid" : "stack"} style={grid ? undefined : { gap: 8 }}>
              {group.map(render)}
            </div>
          </div>
        );
      })}
    </>
  );
}

export function RoleConfigEditor({
  config,
  playerCount,
  onChange,
  online = false,
}: {
  config: GameConfig;
  playerCount: number;
  onChange: (c: GameConfig) => void;
  /** Separate devices — the only mode with an in-app chat to switch off. */
  online?: boolean;
}) {
  const sel = config.selection;
  const problems = validateConfig(config, playerCount);
  const comp = previewComposition(config, Math.max(playerCount, 0));

  const setSelection = (selection: RoleSelection) => onChange({ ...config, selection });

  const switchMode = (mode: "exact" | "pool") => {
    if (mode === sel.mode) return;
    if (mode === "pool") setSelection(recommendedConfig(playerCount).selection);
    else setSelection({ mode: "exact", roleCounts: { werewolf: Math.max(1, comp.werewolves), seer: 1 } });
  };

  return (
    <div className="stack loose">
      <div className="section-title">Roles</div>
      <div className="btn-row" style={{ marginTop: -12 }}>
        <button className={sel.mode === "pool" ? "primary" : ""} onClick={() => switchMode("pool")}>
          🎲 Role pool
        </button>
        <button className={sel.mode === "exact" ? "primary" : ""} onClick={() => switchMode("exact")}>
          🔢 Exact counts
        </button>
      </div>

      {sel.mode === "pool" ? (
        <PoolEditor sel={sel} onChange={setSelection} />
      ) : (
        <ExactEditor sel={sel} onChange={setSelection} />
      )}

      <div className="stack" style={{ gap: 8 }}>
        <div className="section-title">House rules</div>
        <SharedToggles config={config} onChange={onChange} online={online} />
      </div>

      <div className="card tight stack" style={{ gap: 6 }}>
        <div className="spread"><b>Tonight's cast · {playerCount} players</b></div>
        <div className="spread small"><span>🐺 Werewolves</span><b>{comp.werewolves}</b></div>
        <div className="spread small"><span>✨ Village specials</span><b>{comp.villageSpecials}</b></div>
        <div className="spread small"><span>🧑‍🌾 Villagers</span><b>{comp.villagers}</b></div>
      </div>

      {problems.length > 0 && (
        <div className="card tight">
          {problems.map((p, i) => (
            <div key={i} className="err">⚠️ {p.message}</div>
          ))}
        </div>
      )}
    </div>
  );
}

function PoolEditor({
  sel,
  onChange,
}: {
  sel: Extract<RoleSelection, { mode: "pool" }>;
  onChange: (s: RoleSelection) => void;
}) {
  // The last role tapped, so its description shows without crowding the grid.
  const [shown, setShown] = useState<string | null>(null);
  const shownRole = poolEligibleRoles().find((r) => r.id === shown);
  const toggle = (roleId: string) =>
    onChange({
      ...sel,
      pool: sel.pool.includes(roleId)
        ? sel.pool.filter((r) => r !== roleId)
        : [...sel.pool, roleId],
    });

  return (
    <div className="stack">
      <div>
        <div className="muted small" style={{ marginBottom: 8 }}>How many wolves? It scales with the size of your group.</div>
        <div className="btn-row">
          {RATIO_PRESETS.map((p) => (
            <button
              key={p.label}
              className={Math.abs(sel.werewolfRatio - p.value) < 0.01 ? "primary" : ""}
              onClick={() => onChange({ ...sel, werewolfRatio: p.value })}
            >
              {p.label}
              <div className="small" style={{ fontWeight: 400, opacity: 0.8 }}>
                {Math.round(p.value * 100)}%
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="muted small">
        Tap the roles that could be dealt. Each game draws from these at random, so you can pick more than there are
        players.
      </div>
      <TeamGroups
        grid
        roles={poolEligibleRoles()}
        render={(role) => {
          const on = sel.pool.includes(role.id);
          return (
            <button
              key={role.id}
              className={`role-toggle ${on ? "on" : ""}`}
              aria-pressed={on}
              onClick={() => {
                toggle(role.id);
                setShown(role.id);
              }}
            >
              <span className="avatar">{role.emoji}</span>
              <span className="clamp-1">{role.name}</span>
              {on && <span className="check">✓</span>}
            </button>
          );
        }}
      />
      {shownRole && (
        <div className="role-detail">
          {shownRole.emoji} <b>{shownRole.name}</b> — {shownRole.blurb}
        </div>
      )}
    </div>
  );
}

function ExactEditor({
  sel,
  onChange,
}: {
  sel: Extract<RoleSelection, { mode: "exact" }>;
  onChange: (s: RoleSelection) => void;
}) {
  const setCount = (roleId: string, count: number) =>
    onChange({ ...sel, roleCounts: { ...sel.roleCounts, [roleId]: Math.max(0, count) } });

  return (
    <div className="stack">
      <div className="muted small">Set exactly how many of each role. Villagers fill the rest.</div>
      <TeamGroups
        roles={assignableSpecialRoles()}
        render={(role) => (
          <div key={role.id} className="chip">
            <span className="avatar">{role.emoji}</span>
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="name">{role.name}</div>
              <div className="muted small clamp-1">{role.blurb}</div>
            </div>
            <div className="btn-row" style={{ width: 128 }}>
              <button onClick={() => setCount(role.id, (sel.roleCounts[role.id] ?? 0) - 1)}>–</button>
              <span className="count" style={{ minWidth: 24, textAlign: "center", alignSelf: "center" }}>
                {sel.roleCounts[role.id] ?? 0}
              </span>
              <button onClick={() => setCount(role.id, (sel.roleCounts[role.id] ?? 0) + 1)}>+</button>
            </div>
          </div>
        )}
      />
    </div>
  );
}

function SharedToggles({
  config,
  onChange,
  online,
}: {
  config: GameConfig;
  onChange: (c: GameConfig) => void;
  online: boolean;
}) {
  return (
    <>
      <label className="chip" style={{ cursor: "pointer" }}>
        <span className="avatar">💀</span>
        <div className="grow"><div className="name">Reveal roles on death</div><div className="muted small">Off = keep everyone guessing (spookier)</div></div>
        <input
          type="checkbox"
          style={{ width: 24, minHeight: 24 }}
          checked={config.revealRoleOnDeath}
          onChange={(e) => onChange({ ...config, revealRoleOnDeath: e.target.checked })}
        />
      </label>
      <label className="chip" style={{ cursor: "pointer" }}>
        <span className="avatar">🕊️</span>
        <div className="grow">
          <div className="name">Peaceful first night</div>
          <div className="muted small">The wolves skip night one, so nobody's out before the town has spoken.</div>
        </div>
        <input
          type="checkbox"
          style={{ width: 24, minHeight: 24 }}
          checked={config.peacefulFirstNight}
          onChange={(e) => onChange({ ...config, peacefulFirstNight: e.target.checked })}
        />
      </label>
      {online && (
      <label className="chip" style={{ cursor: "pointer" }}>
        <span className="avatar">💬</span>
        <div className="grow">
          <div className="name">In-app chat</div>
          <div className="muted small">Turn off when you're all in the same room and just talking out loud.</div>
        </div>
        <input
          type="checkbox"
          style={{ width: 24, minHeight: 24 }}
          checked={config.chat !== false}
          onChange={(e) => onChange({ ...config, chat: e.target.checked })}
        />
      </label>
      )}
      <label className="chip" style={{ cursor: "pointer" }}>
        <span className="avatar">📢</span>
        <div className="grow">
          <div className="name">Reveal more information</div>
          <div className="muted small">
            Tilts the game toward the villagers — announces saves and protected kills instead of a vague "quiet night".
          </div>
        </div>
        <input
          type="checkbox"
          style={{ width: 24, minHeight: 24 }}
          checked={config.nightSummary === "detailed"}
          onChange={(e) =>
            onChange({ ...config, nightSummary: e.target.checked ? "detailed" : "discreet" })
          }
        />
      </label>
    </>
  );
}
