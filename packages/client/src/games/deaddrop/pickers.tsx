import type { Dossier, Subject } from "@party/deaddrop";
import { subjectGroups } from "./text.js";

const same = (a: Subject | null, b: Subject) => !!a && a.kind === b.kind && a.id === b.id;

/** Every askable subject as grouped chips. */
export function SubjectPicker({
  dossier,
  value,
  onChange,
}: {
  dossier: Dossier;
  value: Subject | null;
  onChange: (s: Subject) => void;
}) {
  return (
    <div className="stack" style={{ gap: 8 }}>
      {subjectGroups(dossier).map((g) => (
        <div key={g.label}>
          <div className="muted small group-label">{g.label}</div>
          <div className="choices">
            {g.subjects.map(({ subject, label }) => (
              <button
                key={`${subject.kind}:${subject.id}`}
                className={`choice ${same(value, subject) ? "selected" : ""}`}
                onClick={() => onChange(subject)}
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
