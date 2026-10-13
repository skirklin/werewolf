import type { Dossier, Subject } from "@party/deaddrop";
import { subjectGroups } from "./text.js";

const same = (a: Subject, b: Subject) => a.kind === b.kind && a.id === b.id;

/**
 * Every askable subject as grouped chips; pick up to `max`. Tapping a chosen
 * one drops it, and a pick past the limit replaces the oldest.
 */
export function SubjectPicker({
  dossier,
  value,
  onChange,
  max = 2,
}: {
  dossier: Dossier;
  value: Subject[];
  onChange: (s: Subject[]) => void;
  max?: number;
}) {
  const toggle = (s: Subject) =>
    onChange(value.some((v) => same(v, s)) ? value.filter((v) => !same(v, s)) : [...value, s].slice(-max));
  return (
    <div className="stack" style={{ gap: 8 }}>
      {subjectGroups(dossier).map((g) => (
        <div key={g.label}>
          <div className="muted small group-label">{g.label}</div>
          <div className="choices">
            {g.subjects.map(({ subject, label }) => (
              <button
                key={`${subject.kind}:${subject.id}`}
                className={`choice ${value.some((v) => same(v, subject)) ? "selected" : ""}`}
                onClick={() => toggle(subject)}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface Option {
  id: number | string;
  label: string;
  /** Shown struck through: the notebook says it's impossible. */
  ruledOut?: boolean;
}

/** A single choice from a row of chips. */
export function ChoiceRow<T extends number | string>({
  label,
  options,
  value,
  onChange,
}: {
  label?: string;
  options: Option[];
  value: T | null;
  onChange: (v: T) => void;
}) {
  return (
    <div>
      {label && <div className="muted small group-label">{label}</div>}
      <div className="choices">
        {options.map((o) => (
          <button
            key={o.id}
            className={`choice ${value === o.id ? "selected" : ""} ${o.ruledOut ? "ruled-out" : ""}`}
            onClick={() => onChange(o.id as T)}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
