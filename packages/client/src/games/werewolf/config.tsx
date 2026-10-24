import { useState, type ReactNode } from "react";
import {
  assignableSpecialRoles,
  poolEligibleRoles,
  rolePool,
  recommendedConfig,
  validateConfig,
  dealPreview,
  type Balance,
  type GameConfig,
  type RoleSelection,
  type RoleDef,
} from "@party/werewolf";

const BALANCE_PRESETS: { value: Balance; label: string; hint: string }[] = [
  { value: "wolves", label: "🐺 Wolves", hint: "favored" },
  { value: "even", label: "⚖️ Even", hint: "fair fight" },
  { value: "village", label: "🏡 Village", hint: "favored" },
];

/** "+3", "−2", "0". */
const signed = (n: number) => (n > 0 ? `+${n}` : n < 0 ? `−${-n}` : "0");
/** "3", or "2–3" for a range. */
const span = ({ min, max }: { min: number; max: number }) => (min === max ? `${min}` : `${min}–${max}`);
/** "+1", or "−1 to +2" for a range. */
const signedSpan = ({ min, max }: { min: number; max: number }) =>
  min === max ? signed(min) : `${signed(min)} to ${signed(max)}`;

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
  const deal = dealPreview(config, Math.max(playerCount, 0));

  const setSelection = (selection: RoleSelection) => onChange({ ...config, selection });

  const switchMode = (mode: "exact" | "pool") => {
    if (mode === sel.mode) return;
    if (mode === "pool") setSelection(recommendedConfig(playerCount).selection);
    else setSelection({ mode: "exact", roleCounts: { werewolf: Math.max(1, deal.werewolves.min), seer: 1 } });
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
          <PoolEditor sel={sel} playerCount={playerCount} onChange={setSelection} />
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
        <div className="spread small"><span>🐺 Werewolves</span><b>{span(deal.werewolves)}</b></div>
        <div className="spread small"><span>✨ Special roles</span><b>{span(deal.specials)}</b></div>
        <div className="spread small"><span>🧑‍🌾 Villagers</span><b>{span(deal.villagers)}</b></div>
        <div className="spread small">
          <span>⚖️ Balance</span>
          <b>{signedSpan(deal.balance)}</b>
        </div>
        <div className="muted small">
          {deal.target === null
            ? "Balance points: above zero favors the village, below favors the wolves."
            : `Each game deals a different mix of your roles, picked so the balance lands near ${signed(deal.target)} (above zero favors the village).`}
        </div>
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
  playerCount,
  onChange,
}: {
  sel: Extract<RoleSelection, { mode: "pool" }>;
  playerCount: number;
  onChange: (s: RoleSelection) => void;
}) {
  // The last role tapped, so its description shows without crowding the grid.
  const [shown, setShown] = useState<string | null>(null);
  const shownRole = poolEligibleRoles().find((r) => r.id === shown);
  const inPool = new Set(rolePool(sel, playerCount));
  // Each tap moves a role along: automatic -> always -> never -> automatic.
  const cycle = (roleId: string) => {
    const { [roleId]: current, ...rest } = sel.overrides;
    const next = current === undefined ? true : current ? false : undefined;
    onChange({ ...sel, overrides: next === undefined ? rest : { ...rest, [roleId]: next } });
  };
  const setting = (role: RoleDef) =>
    sel.overrides[role.id] === true ? "Always" : sel.overrides[role.id] === false ? "Never" : role.autoFrom > 3 ? `Auto · ${role.autoFrom}+` : "Auto";

  return (
    <div className="stack">
      <div>
        <div className="muted small" style={{ marginBottom: 8 }}>
          Who should the deal favor? The dealer picks how many wolves (about a quarter to a third of your group) and which roles, to match.
        </div>
        <div className="btn-row">
          {BALANCE_PRESETS.map((p) => (
            <button
              key={p.value}
              className={(sel.balance ?? "even") === p.value ? "primary" : ""}
              onClick={() => onChange({ ...sel, balance: p.value })}
            >
              {p.label}
              <div className="small" style={{ fontWeight: 400, opacity: 0.8 }}>
                {p.hint}
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="spread">
        <div className="muted small">
          Roles join the pool automatically as your group grows. Tap one to set it to always or never.
        </div>
        {Object.keys(sel.overrides).length > 0 && (
          <button className="ghost small" onClick={() => onChange({ ...sel, overrides: {} })}>
            All auto
          </button>
        )}
      </div>
      <TeamGroups
        grid
        roles={poolEligibleRoles()}
        render={(role) => {
          const on = inPool.has(role.id);
          return (
            <button
              key={role.id}
              className={`role-toggle ${on ? "on" : ""}`}
              aria-pressed={on}
              onClick={() => {
                cycle(role.id);
                setShown(role.id);
              }}
            >
              <span className="avatar">{role.emoji}</span>
              <span className="role-toggle-text">
                <span className="clamp-1">{role.name}</span>
                <span className="small muted">{setting(role)}</span>
              </span>
              {on && <span className="check">✓</span>}
            </button>
          );
        }}
      />
      {shownRole && (
        <div className="role-detail">
          {shownRole.emoji} <b>{shownRole.name}</b> — {shownRole.blurb}{" "}
          <span className="muted">
            Balance {signed(shownRole.weight)}.{shownRole.autoFrom > 3 && ` In automatically from ${shownRole.autoFrom} players.`}
          </span>
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
