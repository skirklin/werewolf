import { useState, type ReactNode } from "react";
import {
  assignableSpecialRoles,
  poolEligibleRoles,
  recommendedConfig,
  validateConfig,
  previewComposition,
  werewolfRange,
  DEFAULT_WEREWOLF_RATIO,
  type GameConfig,
  type RoleSelection,
  type RoleDef,
} from "@party/werewolf";

const RATIO_PRESETS: { label: string; value: number }[] = [
  { label: "Light", value: 0.2 },
  { label: "Standard", value: DEFAULT_WEREWOLF_RATIO },
  { label: "Heavy", value: 0.38 },
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
  const seats = Math.max(playerCount, 0);
  const wolfRange = werewolfRange(sel, seats);
  const comp = previewComposition(config, seats, wolfRange.min);
  // With a secret wolf count, one more wolf means one fewer villager or special.
  const most = previewComposition(config, seats, wolfRange.max);
  const span = (a: number, b: number) => (a === b ? `${a}` : `${Math.min(a, b)}–${Math.max(a, b)}`);

  const setSelection = (selection: RoleSelection) => onChange({ ...config, selection });

  const switchMode = (mode: "exact" | "pool") => {
    if (mode === sel.mode) return;
    if (mode === "pool") setSelection(recommendedConfig(playerCount).selection);
    else setSelection({ mode: "exact", roleCounts: { werewolf: Math.max(1, comp.werewolves), seer: 1 } });
  };

  return (
    <div className="stack loose">
      <div className="stack" style={{ gap: 8 }}>
        <div className="spread">
          <div className="section-title">Roles</div>
          {/* Exact counts are for the few who want them; the pool suits nearly every table. */}
          <button className="ghost small" onClick={() => switchMode(sel.mode === "pool" ? "exact" : "pool")}>
            {sel.mode === "pool" ? "Advanced: exact counts" : "Back to a role pool"}
          </button>
        </div>
        {sel.mode === "pool" ? (
          <PoolEditor sel={sel} onChange={setSelection} />
        ) : (
          <ExactEditor sel={sel} onChange={setSelection} />
        )}
      </div>

      <div className="stack" style={{ gap: 8 }}>
        <div className="section-title">House rules</div>
        <SharedToggles config={config} onChange={onChange} online={online} />
      </div>

      <div className="card tight stack" style={{ gap: 6 }}>
        <div className="spread"><b>Tonight's cast · {playerCount} players</b></div>
        <div className="spread small"><span>🐺 Werewolves</span><b>{span(comp.werewolves, most.werewolves)}</b></div>
        <div className="spread small"><span>✨ Village specials</span><b>{span(comp.villageSpecials, most.villageSpecials)}</b></div>
        <div className="spread small"><span>🧑‍🌾 Villagers</span><b>{span(comp.villagers, most.villagers)}</b></div>
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

/** One house rule: a single line, with its explanation behind an ⓘ. */
function Rule({
  icon,
  label,
  help,
  checked,
  onChange,
}: {
  icon: string;
  label: string;
  help: string;
  checked: boolean;
  onChange: (on: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rule">
      <label className="rule-row">
        <span aria-hidden>{icon}</span>
        <span className="grow">{label}</span>
        <button
          type="button"
          className="ghost info"
          aria-label={`About ${label}`}
          aria-expanded={open}
          onClick={(e) => {
            e.preventDefault();
            setOpen((v) => !v);
          }}
        >
          ⓘ
        </button>
        <input type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      </label>
      {open && <div className="muted small rule-help">{help}</div>}
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
    <div className="card tight rules">
      {config.selection.mode === "pool" && (
        <Rule
          icon="🎲"
          label="Secret wolf count"
          help="Deal one extra wolf half the time (say, 2 or 3), so nobody can be sure the last wolf is gone."
          checked={!!config.selection.wolfCountVaries}
          onChange={(on) =>
            config.selection.mode === "pool" &&
            onChange({ ...config, selection: { ...config.selection, wolfCountVaries: on } })
          }
        />
      )}
      <Rule
        icon="🕊️"
        label="Peaceful first night"
        help="No killing on night one: the wolves don't hunt and the Witch sleeps, so nobody's out before the town has spoken."
        checked={config.peacefulFirstNight}
        onChange={(on) => onChange({ ...config, peacefulFirstNight: on })}
      />
      <Rule
        icon="💀"
        label="Reveal roles on death"
        help="Off keeps everyone guessing (spookier)."
        checked={config.revealRoleOnDeath}
        onChange={(on) => onChange({ ...config, revealRoleOnDeath: on })}
      />
      <Rule
        icon="📢"
        label="Announce saves"
        help={'Tilts the game toward the villagers: a protected kill is announced, instead of a vague "quiet night".'}
        checked={config.nightSummary === "detailed"}
        onChange={(on) => onChange({ ...config, nightSummary: on ? "detailed" : "discreet" })}
      />
      {online && (
        <Rule
          icon="💬"
          label="In-app chat"
          help="Turn it off when you're all in the same room and talking out loud."
          checked={config.chat !== false}
          onChange={(on) => onChange({ ...config, chat: on })}
        />
      )}
    </div>
  );
}
