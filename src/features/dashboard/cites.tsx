/**
 * The "where does this come from" chips under every piece of AI text.
 * Does: show one button per cited fact; pressing it reveals the engine's sentence for that fact, so
 * every number in AI text can be traced to the plan.
 * Never does: show a fact the plan does not hold (unknown ids are skipped).
 */
import { useState, type ReactElement } from 'react';
import type { Fact } from '../../ai/facts.js';

/** The cited facts of one AI text, as expandable chips. */
export function Cites(props: {
  readonly ids: readonly string[];
  readonly facts: readonly Fact[];
}): ReactElement {
  const { ids, facts } = props;
  const [open, setOpen] = useState<string | null>(null);
  const cited = facts.flatMap((f, i) => (ids.includes(f.id) ? [{ fact: f, n: i + 1 }] : []));
  const shown = cited.find(({ fact }) => fact.id === open);
  return (
    <div className="cites">
      <ul className="chips" aria-label="Facts this is based on">
        {cited.map(({ fact, n }) => (
          <li key={fact.id}>
            <button
              type="button"
              className="chip chip--button"
              aria-expanded={open === fact.id}
              onClick={() => {
                setOpen(open === fact.id ? null : fact.id);
              }}
            >
              Fact {n}
            </button>
          </li>
        ))}
      </ul>
      {shown ? (
        <p className="cites__fact">
          <strong>Fact {shown.n}:</strong> {shown.fact.text}
        </p>
      ) : null}
    </div>
  );
}
