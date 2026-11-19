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

/** What every part of one outing's card receives: its field id prefix, its value and its errors. */
interface PartProps {
  /** The id prefix for this outing's fields, `f-activities-<index>`, matching the error keys. */
  readonly id: string;
  readonly activity: Activity;
  readonly errors: Readonly<Record<string, string>>;
  /** Applies a change to this outing. */
  readonly update: (patch: Partial<Activity>) => void;
}

/** What the outing is and how they travel. */
function KindAndMode({ id, activity, update }: PartProps): ReactElement {
  return (
    <div className="row">
      <SelectField
        id={`${id}-kind`}
        label="What is it?"
        value={activity.kind}
        values={ACTIVITY_KINDS}
        labels={KIND_LABELS}
        onChange={(kind) => {
          update({ kind });
        }}
      />
      <SelectField
        id={`${id}-mode`}
        label="How do they get there?"
        value={activity.mode}
        values={MODES}
        labels={MODE_LABELS}
        onChange={(mode) => {
          update({ mode });
        }}
      />
    </div>
  );
}

/** Who goes: one checkbox per household member. */
function WhoGoes(props: PartProps & { readonly members: readonly Member[] }): ReactElement {
  const { id, activity, errors, update, members } = props;
  return (
    <fieldset id={`${id}-memberIds`} className="group group--inline">
      <legend>Who goes?</legend>
      {members.map((m) => (
        <CheckField
          key={m.id}
          id={`${id}-who-${m.id}`}
          label={m.name || m.id}
          checked={activity.memberIds.includes(m.id)}
          onChange={(on) => {
            update({ memberIds: toggle(activity.memberIds, m.id, on) });
          }}
        />
      ))}
      <FieldError id={`${id}-memberIds`} error={errors[`${id}-memberIds`]} />
    </fieldset>
  );
}

/** The number fields of an outing: name, limits and step, in display order. */
const TIMING_FIELDS = [
  { key: 'startHour', label: 'Starts at (hour, 0–23)', min: 0, max: 23 },
  {
    key: 'durationMinutes',
    label: 'Minutes',
    min: P.durationMinMinutes,
    max: P.durationMaxMinutes,
  },
  { key: 'distanceKm', label: 'One-way distance (km)', min: 0, max: P.distanceMaxKm, step: 0.5 },
  { key: 'daysPerWeek', label: 'Days a week', min: 1, max: P.daysPerWeekMax },
] as const satisfies readonly {
  key: keyof Activity;
  label: string;
  min: number;
  max: number;
  step?: number;
}[];

/** When it starts, how long it lasts, how far it goes and how often. */
function Timing({ id, activity, errors, update }: PartProps): ReactElement {
  return (
    <div className="row">
      {TIMING_FIELDS.map((field) => (
        <NumberField
          key={field.key}
          id={`${id}-${field.key}`}
          label={field.label}
          value={activity[field.key]}
          min={field.min}
          max={field.max}
          {...('step' in field ? { step: field.step } : {})}
          error={errors[`${id}-${field.key}`]}
          onChange={(value) => {
            update({ [field.key]: value });
          }}
        />
      ))}
    </div>
  );
}

/** Whether the outing could move, and between which hours. */
function FlexibleWindow({ id, activity, errors, update }: PartProps): ReactElement {
  const flex = activity.window;
  return (
    <div id={`${id}-window`}>
      <CheckField
        id={`${id}-flexible`}
        label="Flexible: it could happen at another time"
        checked={flex !== null}
        onChange={(on) => {
          update({ window: on ? { earliest: 6, latest: 18 } : null });
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
              update({ window: { earliest, latest: flex.latest } });
            }}
          />
          <NumberField
            id={`${id}-latest`}
            label="and (hour)"
            value={flex.latest}
            min={0}
            max={23}
            onChange={(latest) => {
              update({ window: { earliest: flex.earliest, latest } });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** One outing's card: every field, and the button that removes it. */
function ActivityCard(
  props: PartProps & {
    readonly index: number;
    readonly members: readonly Member[];
    readonly onRemove: () => void;
  },
): ReactElement {
  const { index, activity, onRemove } = props;
  const name = KIND_LABELS[activity.kind];
  return (
    <div className="card">
      <h3>
        {name} {index + 1}
      </h3>
      <KindAndMode {...props} />
      <WhoGoes {...props} />
      <Timing {...props} />
      <FlexibleWindow {...props} />
      <button type="button" className="btn btn--quiet" onClick={onRemove}>
        Remove {name.toLowerCase()} {index + 1}
      </button>
    </div>
  );
}

/** The editor for the household's outings. */
export function ActivitiesEditor(props: {
  readonly activities: readonly Activity[];
  readonly members: readonly Member[];
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (activities: readonly Activity[]) => void;
}): ReactElement {
  const { activities, members, errors, onChange } = props;
  return (
    <fieldset id="f-activities" className="group">
      <legend>Daily outings and trips</legend>
      <p className="field__hint">
        Commutes, school runs, walks and play. Clearday suggests cleaner times and cleaner ways to
        travel for each.
      </p>
      <FieldError id="f-activities" error={errors['f-activities']} />
      {activities.map((activity, i) => (
        <ActivityCard
          key={activity.id}
          id={`f-activities-${i}`}
          index={i}
          activity={activity}
          members={members}
          errors={errors}
          update={(patch) => {
            onChange(patchAt(activities, i, patch));
          }}
          onRemove={() => {
            onChange(removeAt(activities, i));
          }}
        />
      ))}
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
