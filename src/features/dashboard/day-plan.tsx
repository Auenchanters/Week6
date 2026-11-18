/**
 * "Your day, re-planned": each activity the engine would move to a cleaner hour, and the best time
 * to air the home.
 * Never does: move anything itself; it only reports the engine's suggestion and what it saves.
 */
import type { ReactElement } from 'react';
import type { DayPlan } from '../../domain/plan.js';
import type { Member } from '../../shared/schema.js';
import { clock, hourSpan, micrograms, whole } from '../../ui/format.js';
import { KIND_LABELS, whoIs } from '../../ui/labels.js';

/** The re-planned day section. */
export function DayPlanSection(props: {
  readonly plan: DayPlan;
  readonly members: readonly Member[];
}): ReactElement {
  const { plan, members } = props;
  const { airing } = plan;
  return (
    <section aria-labelledby="day-title">
      <h2 id="day-title">Your day, re-planned</h2>
      {plan.moves.length > 0 ? (
        <ul className="plain moves">
          {plan.moves.map((m) => (
            <li key={m.activity.id}>
              <strong>
                {whoIs(m.activity.memberIds, members)}&apos;s{' '}
                {KIND_LABELS[m.activity.kind].toLowerCase()}
              </strong>{' '}
              {clock(m.fromHour)} → {clock(m.toHour)} · saves {micrograms(m.savedUg)}
            </li>
          ))}
        </ul>
      ) : (
        <p>
          Nothing to move today. Mark an outing as flexible in your household and Clearday will look
          for a cleaner hour.
        </p>
      )}
      <p>
        <strong>Open the windows at {hourSpan(...airing.hours)}</strong>, when outdoor PM2.5 is
        lowest (about {whole(airing.outdoorMean)} µg/m³).
        {airing.savedUg > 0
          ? ` Doing so instead of your usual habit saves ${micrograms(airing.savedUg)}.`
          : ''}
      </p>
      <p className="muted">
        With every move, the household breathes {micrograms(plan.before.totalDoseUg)} →{' '}
        {micrograms(plan.after.totalDoseUg)} of PM2.5 today.
      </p>
    </section>
  );
}
