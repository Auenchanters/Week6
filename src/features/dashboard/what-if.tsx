/**
 * "Home air what-if": try a different purifier, window habit, fan, incense, heater or cooking fuel
 * and see the indoor PM2.5 and the household's dose change at once.
 * Does: keep the changes as a draft, rebuild the whole plan locally with `buildDayPlan` on the
 * draft (no network, no AI), show the difference from the saved home, and save or drop the draft.
 * Never does: change the saved household until "Keep these changes" is pressed.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { buildDayPlan, type DayPlan } from '../../domain/plan.js';
import type { Forecast, Home, Profile } from '../../shared/schema.js';
import { micrograms, tenths } from '../../ui/format.js';
import { HomeSourceFields } from '../../ui/home-fields.js';

/** "3.2 µg/m³ lower" or "3.2 µg/m³ higher" for a change in indoor PM2.5. */
const indoorChange = (delta: number): string =>
  `${tenths(Math.abs(delta))} µg/m³ ${delta <= 0 ? 'lower' : 'higher'}`;

/** "120 µg less" or "120 µg more" for a change in the household's dose. */
const doseChange = (delta: number): string =>
  `${micrograms(Math.abs(delta))} ${delta <= 0 ? 'less' : 'more'}`;

/** The what-if section; remount it (change its `key`) when the saved home changes. */
export function WhatIf(props: {
  readonly profile: Profile;
  readonly forecast: Forecast;
  readonly plan: DayPlan;
  readonly onKeep: (home: Home) => void;
}): ReactElement {
  const { profile, forecast, plan, onKeep } = props;
  const [draft, setDraft] = useState<Home>(profile.home);
  const dirty = JSON.stringify(draft) !== JSON.stringify(profile.home);
  const scenario = useMemo(
    () => (dirty ? buildDayPlan({ ...profile, home: draft }, forecast, plan.dayIndex) : plan),
    [dirty, profile, draft, forecast, plan],
  );
  const indoorDelta = scenario.before.indoor.mean - plan.before.indoor.mean;
  const doseDelta = scenario.before.totalDoseUg - plan.before.totalDoseUg;
  return (
    <section aria-labelledby="whatif-title">
      <h2 id="whatif-title">Home air what-if</h2>
      <p className="muted">
        Change a setting and watch the numbers. Nothing is saved until you keep the changes.
      </p>
      <div className="form-grid">
        <HomeSourceFields
          prefix="wi"
          home={draft}
          onChange={(patch) => {
            setDraft({ ...draft, ...patch });
          }}
        />
      </div>
      <dl className="stats" aria-live="polite">
        <div>
          <dt>Indoor PM2.5, daily average</dt>
          <dd>
            <strong>{tenths(scenario.before.indoor.mean)} µg/m³</strong>
            {dirty ? <span className="delta"> ({indoorChange(indoorDelta)} than now)</span> : null}
          </dd>
        </div>
        <div>
          <dt>Household breathes in a day</dt>
          <dd>
            <strong>{micrograms(scenario.before.totalDoseUg)}</strong>
            {dirty ? <span className="delta"> ({doseChange(doseDelta)} than now)</span> : null}
          </dd>
        </div>
      </dl>
      <div className="actions">
        <button
          type="button"
          className="btn btn--primary"
          disabled={!dirty}
          onClick={() => {
            onKeep(draft);
          }}
        >
          Keep these changes
        </button>
        <button
          type="button"
          className="btn"
          disabled={!dirty}
          onClick={() => {
            setDraft(profile.home);
          }}
        >
          Reset
        </button>
      </div>
    </section>
  );
}
