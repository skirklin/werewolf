import {
  assignableSpecialRoles,
  poolEligibleRoles,
  recommendedConfig,
  validateConfig,
  previewComposition,
  DEFAULT_WEREWOLF_RATIO,
  type GameConfig,
  type RoleSelection,
} from "@werewolf/shared";

const RATIO_PRESETS: { label: string; value: number }[] = [
  { label: "Light", value: 0.2 },
  { label: "Standard", value: DEFAULT_WEREWOLF_RATIO },
  { label: "Heavy", value: 0.34 },
];

export function RoleConfigEditor({
  config,
  playerCount,
  onChange,
}: {
  config: GameConfig;
  playerCount: number;
  onChange: (c: GameConfig) => void;
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
    <div className="stack">
      <div className="btn-row">
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

      <SharedToggles config={config} onChange={onChange} />

      <div className="card tight">
        <div className="spread"><b>This game ({playerCount} players)</b></div>
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
        <div className="muted small" style={{ marginBottom: 6 }}>Werewolf density (scales with player count)</div>
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

      <div className="muted small">Roles allowed in the pool (may exceed player count — drawn at random)</div>
      {poolEligibleRoles().map((role) => {
        const on = sel.pool.includes(role.id);
        return (
          <button
            key={role.id}
            className={`chip ${on ? "" : ""}`}
            style={{ borderColor: on ? "var(--accent-2)" : undefined, textAlign: "left" }}
            onClick={() => toggle(role.id)}
          >
            <span className="avatar">{role.emoji}</span>
            <div className="grow">
              <div className="name">{role.name}</div>
              <div className="muted small">{role.blurb}</div>
            </div>
            <span className="pill">{on ? "✓ in pool" : "add"}</span>
          </button>
        );
      })}
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
      {assignableSpecialRoles().map((role) => (
        <div key={role.id} className="chip">
          <span className="avatar">{role.emoji}</span>
          <div className="grow">
            <div className="name">{role.name}</div>
            <div className="muted small">{role.blurb}</div>
          </div>
          <div className="btn-row" style={{ width: 128 }}>
            <button onClick={() => setCount(role.id, (sel.roleCounts[role.id] ?? 0) - 1)}>–</button>
            <span className="count" style={{ minWidth: 24, textAlign: "center", alignSelf: "center" }}>
              {sel.roleCounts[role.id] ?? 0}
            </span>
            <button onClick={() => setCount(role.id, (sel.roleCounts[role.id] ?? 0) + 1)}>+</button>
          </div>
        </div>
      ))}
    </div>
  );
}

function SharedToggles({
  config,
  onChange,
}: {
  config: GameConfig;
  onChange: (c: GameConfig) => void;
}) {
  return (
    <>
      <label className="chip" style={{ cursor: "pointer" }}>
        <span className="avatar">💀</span>
        <div className="grow"><div className="name">Reveal role on death</div></div>
        <input
          type="checkbox"
          style={{ width: 24, minHeight: 24 }}
          checked={config.revealRoleOnDeath}
          onChange={(e) => onChange({ ...config, revealRoleOnDeath: e.target.checked })}
        />
      </label>
      <label className="chip" style={{ cursor: "pointer" }}>
        <span className="avatar">📢</span>
        <div className="grow">
          <div className="name">Detailed night recap</div>
          <div className="muted small">
            Off = a protected kill just reads "quiet night" (hides the doctor). On = announces saves.
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
