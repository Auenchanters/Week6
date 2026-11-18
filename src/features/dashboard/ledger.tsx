/**
 * The choices and impact ledger: every change the engine measured, with what it does for lungs,
 * climate and street air, what it costs, and a plain note on what the numbers mean.
 * Does: sort by lungs or by climate, filter by kind of change, and show a change that adds CO2 as
 * "+x kg more" in a warning tone, never netted away.
 * Never does: hide a trade-off or present an estimate as a medical finding.
 */
import { useState, type ReactElement } from 'react';
import type { DayPlan } from '../../domain/plan.js';
import type { Swap, SwapCategory } from '../../domain/swaps.js';
import type { Member } from '../../shared/schema.js';
import { SelectField } from '../../ui/fields.js';
import { cigarettes, micrograms, tenths, whole } from '../../ui/format.js';
import { COST_LABELS, SWAP_CATEGORY_LABELS, swapTitle } from '../../ui/labels.js';

const SORTS = ['lungs', 'climate'] as const;
type Sort = (typeof SORTS)[number];
const SORT_LABELS: Readonly<Record<Sort, string>> = {
  lungs: 'Most lung benefit',
  climate: 'Most climate benefit',
};

/** The climate line: CO2 saved, or an honest "more" when the change adds CO2. */
function Climate({ kg }: { kg: number }): ReactElement {
  return kg < 0 ? (
    <span className="warn">Climate: +{tenths(-kg)} kg more CO₂ a week</span>
  ) : (
    <span>Climate: {tenths(kg)} kg less CO₂ a week</span>
  );
}

/** Below this many µg a day a change is reported as no measurable change for lungs. */
const NOTICEABLE_UG = 1;
/** Cigarette equivalents are shown only from a twentieth of one upward. */
const NOTICEABLE_CIGARETTES = 0.05;

/**
 * The lung effect of a change. More dose is shown as a warning without cigarettes: those follow
 * the air a person is in, which a more active trip can lower while the breathing raises the dose.
 */
function Lungs({
  saved,
  cigarettesSaved,
}: {
  saved: number;
  cigarettesSaved: number;
}): ReactElement {
  if (Math.abs(saved) < NOTICEABLE_UG) return <span>Lungs: no measurable change</span>;
  if (saved < 0) return <span className="warn">Lungs: +{micrograms(-saved)} more a day</span>;
  const cigs =
    cigarettesSaved >= NOTICEABLE_CIGARETTES ? ` (${cigarettes(cigarettesSaved)} fewer)` : '';
  return (
    <span>
      Lungs: {micrograms(saved)} less a day{cigs}
    </span>
  );
}

/** One measured change. */
function Row({ swap, members }: { swap: Swap; members: readonly Member[] }): ReactElement {
  return (
    <li className="card ledger__row">
      <h3>{swapTitle(swap, members)}</h3>
      <p className="ledger__nums">
        <Lungs saved={swap.doseSavedUg} cigarettesSaved={swap.cigarettesSaved} />
        <Climate kg={swap.co2SavedKg} />
        {swap.streetPmSavedG > 0 ? (
          <span>Street: {whole(swap.streetPmSavedG)} g less PM2.5 a week</span>
        ) : null}
      </p>
      <p className="chips">
        <span className="chip">{SWAP_CATEGORY_LABELS[swap.category]}</span>
        <span className="chip">{COST_LABELS[swap.cost]}</span>
      </p>
    </li>
  );
}

/** The ledger section. */
export function Ledger(props: {
  readonly plan: DayPlan;
  readonly members: readonly Member[];
}): ReactElement {
  const { plan, members } = props;
  const [sort, setSort] = useState<Sort>('lungs');
  const [filter, setFilter] = useState<SwapCategory | 'all'>('all');
  const kinds = [...new Set(plan.swaps.map((s) => s.category))];
  const rows = plan.swaps
    .filter((s) => filter === 'all' || s.category === filter)
    .sort((a, b) =>
      sort === 'lungs' ? b.doseSavedUg - a.doseSavedUg : b.co2SavedKg - a.co2SavedKg,
    );
  return (
    <section aria-labelledby="ledger-title">
      <h2 id="ledger-title">Choices and their impact</h2>
      <div className="toolbar">
        <SelectField
          id="ledger-sort"
          label="Sort by"
          value={sort}
          values={SORTS}
          labels={SORT_LABELS}
          onChange={setSort}
        />
        <div className="chips" role="group" aria-label="Show changes for">
          {(['all', ...kinds] as const).map((k) => (
            <button
              key={k}
              type="button"
              className="chip chip--button"
              aria-pressed={filter === k}
              onClick={() => {
                setFilter(k);
              }}
            >
              {k === 'all' ? 'All' : SWAP_CATEGORY_LABELS[k]}
            </button>
          ))}
        </div>
      </div>
      <p role="status" className="muted">
        {rows.length} {rows.length === 1 ? 'choice' : 'choices'} shown.
      </p>
      <ul className="cards ledger">
        {rows.map((s) => (
          <Row key={s.id} swap={s} members={members} />
        ))}
      </ul>
      <p className="footnote">
        µg is a microgram, a millionth of a gram: the fine dust (PM2.5) your lungs take in over a
        day. A cigarette equivalent is a rule of thumb: a day in air with 22 µg/m³ of PM2.5 carries
        about the health risk of one cigarette. These are estimates for a typical home, not medical
        advice.
      </p>
    </section>
  );
}
