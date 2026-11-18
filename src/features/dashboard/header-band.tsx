/**
 * The top of the dashboard: the place (the page's `h1`), the plan day's date, the data source, the
 * Today/Tomorrow switch and the way back to the household form.
 * Never does: fetch or compute; it only shows what the plan already holds.
 */
import type { ReactElement } from 'react';
import type { DayIndex, DayPlan } from '../../domain/plan.js';
import { dayLabel } from '../../ui/format.js';

const DAYS: readonly { readonly index: DayIndex; readonly label: string }[] = [
  { index: 0, label: 'Today' },
  { index: 1, label: 'Tomorrow' },
];

/** The dashboard's header band. */
export function HeaderBand(props: {
  readonly place: string;
  readonly plan: DayPlan;
  readonly onDay: (day: DayIndex) => void;
  readonly onEdit: () => void;
}): ReactElement {
  const { place, plan, onDay, onEdit } = props;
  return (
    <header className="band">
      <div>
        <h1>{place}</h1>
        <p className="band__meta">
          <time dateTime={plan.date}>{dayLabel(plan.date)}</time>
          <span className="badge" data-source={plan.source}>
            {plan.source === 'sample' ? 'Sample data' : 'Live · Open-Meteo'}
          </span>
        </p>
      </div>
      <div className="band__controls">
        <div className="segmented" role="group" aria-label="Day to plan">
          {DAYS.map(({ index, label }) => (
            <button
              key={index}
              type="button"
              aria-pressed={plan.dayIndex === index}
              onClick={() => {
                onDay(index);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <button type="button" className="btn" onClick={onEdit}>
          Edit household
        </button>
      </div>
    </header>
  );
}
