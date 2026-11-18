/**
 * The daily outings editor: what each outing is, who goes, when, for how long, how they travel, how
 * far, how often, and optionally the hours it could move to.
 * Does: add and remove outings, show each field's error and report every change as a new list.
 * Never does: validate; the setup form does, with the whole draft.
 */
import type { ReactElement } from 'react';
import { LIMITS } from '../../shared/limits.js';
import { ACTIVITY_KINDS, MODES, type Activity, type Member } from '../../shared/schema.js';
import { CheckField, FieldError, NumberField, SelectField } from '../../ui/fields.js';
import { KIND_LABELS, MODE_LABELS } from '../../ui/labels.js';
import { newActivity, patchAt, removeAt, toggle } from './draft.js';

const P = LIMITS.profile;

/** The editor for the household's outings. */
export function ActivitiesEditor(props: {
  readonly activities: readonly Activity[];
  readonly members: readonly Member[];
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (activities: readonly Activity[]) => void;
}): ReactElement {
  const { activities, members, errors, onChange } = props;
  const update = (i: number, patch: Partial<Activity>): void => {
    onChange(patchAt(activities, i, patch));
  };
  return (
    <fieldset id="f-activities" className="group">
      <legend>Daily outings and trips</legend>
      <p className="field__hint">
        Commutes, school runs, walks and play. Clearday suggests cleaner times and cleaner ways to
        travel for each.
      </p>
      <FieldError id="f-activities" error={errors['f-activities']} />
      {activities.map((a, i) => {
        const id = `f-activities-${i}`;
        const flex = a.window;
        return (
          <div className="card" key={a.id}>
            <h3>
              {KIND_LABELS[a.kind]} {i + 1}
            </h3>
            <div className="row">
              <SelectField
                id={`${id}-kind`}
                label="What is it?"
                value={a.kind}
                values={ACTIVITY_KINDS}
                labels={KIND_LABELS}
                onChange={(kind) => {
                  update(i, { kind });
                }}
              />
              <SelectField
                id={`${id}-mode`}
                label="How do they get there?"
                value={a.mode}
                values={MODES}
                labels={MODE_LABELS}
                onChange={(mode) => {
                  update(i, { mode });
                }}
              />
            </div>
            <fieldset id={`${id}-memberIds`} className="group group--inline">
              <legend>Who goes?</legend>
              {members.map((m) => (
                <CheckField
                  key={m.id}
                  id={`${id}-who-${m.id}`}
                  label={m.name || m.id}
                  checked={a.memberIds.includes(m.id)}
                  onChange={(on) => {
                    update(i, { memberIds: toggle(a.memberIds, m.id, on) });
                  }}
                />
              ))}
              <FieldError id={`${id}-memberIds`} error={errors[`${id}-memberIds`]} />
            </fieldset>
            <div className="row">
              <NumberField
                id={`${id}-startHour`}
                label="Starts at (hour, 0–23)"
                value={a.startHour}
                min={0}
                max={23}
                error={errors[`${id}-startHour`]}
                onChange={(startHour) => {
                  update(i, { startHour });
                }}
              />
              <NumberField
                id={`${id}-durationMinutes`}
                label="Minutes"
                value={a.durationMinutes}
                min={P.durationMinMinutes}
                max={P.durationMaxMinutes}
                error={errors[`${id}-durationMinutes`]}
                onChange={(durationMinutes) => {
                  update(i, { durationMinutes });
                }}
              />
              <NumberField
                id={`${id}-distanceKm`}
                label="One-way distance (km)"
                value={a.distanceKm}
                min={0}
                max={P.distanceMaxKm}
                step={0.5}
                error={errors[`${id}-distanceKm`]}
                onChange={(distanceKm) => {
                  update(i, { distanceKm });
                }}
              />
              <NumberField
                id={`${id}-daysPerWeek`}
                label="Days a week"
                value={a.daysPerWeek}
                min={1}
                max={P.daysPerWeekMax}
                error={errors[`${id}-daysPerWeek`]}
                onChange={(daysPerWeek) => {
                  update(i, { daysPerWeek });
                }}
              />
            </div>
            <div id={`${id}-window`}>
              <CheckField
                id={`${id}-flexible`}
                label="Flexible: it could happen at another time"
                checked={flex !== null}
                onChange={(on) => {
                  update(i, { window: on ? { earliest: 6, latest: 18 } : null });
                }}
              />
              {flex ? (
                <div className="row">
                  <NumberField
                    id={`${id}-earliest`}
                    label="Flexible between (hour)"
                    value={flex.earliest}
                    min={0}
                    max={23}
                    error={errors[`${id}-earliest`]}
                    onChange={(earliest) => {
                      update(i, { window: { earliest, latest: flex.latest } });
                    }}
                  />
                  <NumberField
                    id={`${id}-latest`}
                    label="and (hour)"
                    value={flex.latest}
                    min={0}
                    max={23}
                    onChange={(latest) => {
                      update(i, { window: { earliest: flex.earliest, latest } });
                    }}
                  />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn--quiet"
              onClick={() => {
                onChange(removeAt(activities, i));
              }}
            >
              Remove {KIND_LABELS[a.kind].toLowerCase()} {i + 1}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="btn"
        disabled={activities.length >= P.activitiesMax}
        onClick={() => {
          onChange([...activities, newActivity(members, activities)]);
        }}
      >
        Add an outing
      </button>
    </fieldset>
  );
}
