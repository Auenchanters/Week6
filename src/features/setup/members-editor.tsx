/**
 * The household members editor: name, age band, health conditions and, optionally, the hours each
 * person is away from home (school or work).
 * Does: add and remove people (at least one stays), show each field's error, and report every
 * change as a new member list.
 * Never does: validate; the setup form does, with the whole draft.
 */
import type { ReactElement } from 'react';
import { LIMITS } from '../../shared/limits.js';
import { AGE_BANDS, CONDITIONS, type Member } from '../../shared/schema.js';
import { CheckField, FieldError, NumberField, SelectField, TextField } from '../../ui/fields.js';
import { AGE_LABELS, CONDITION_LABELS } from '../../ui/labels.js';
import { newMember, patchAt, toggle } from './draft.js';

/** The editor for the people in the household. */
export function MembersEditor(props: {
  readonly members: readonly Member[];
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (members: readonly Member[]) => void;
  readonly onRemove: (index: number) => void;
}): ReactElement {
  const { members, errors, onChange, onRemove } = props;
  const update = (i: number, patch: Partial<Member>): void => {
    onChange(patchAt(members, i, patch));
  };
  return (
    <fieldset id="f-members" className="group">
      <legend>Who lives in the household?</legend>
      <FieldError id="f-members" error={errors['f-members']} />
      {members.map((m, i) => {
        const id = `f-members-${i}`;
        const { away } = m;
        return (
          <div className="card" key={m.id}>
            <h3>{m.name || `Person ${i + 1}`}</h3>
            <div className="row">
              <TextField
                id={`${id}-name`}
                label="Name"
                value={m.name}
                maxLength={LIMITS.profile.memberNameMax}
                error={errors[`${id}-name`]}
                onChange={(name) => {
                  update(i, { name });
                }}
              />
              <SelectField
                id={`${id}-age`}
                label="Age"
                value={m.age}
                values={AGE_BANDS}
                labels={AGE_LABELS}
                onChange={(age) => {
                  update(i, { age });
                }}
              />
            </div>
            <fieldset className="group group--inline">
              <legend>Health conditions</legend>
              {CONDITIONS.map((c) => (
                <CheckField
                  key={c}
                  id={`${id}-cond-${c}`}
                  label={CONDITION_LABELS[c]}
                  checked={m.conditions.includes(c)}
                  onChange={(on) => {
                    update(i, { conditions: toggle(m.conditions, c, on) });
                  }}
                />
              ))}
            </fieldset>
            <div id={`${id}-away`}>
              <CheckField
                id={`${id}-awayOn`}
                label="Away from home for part of the day (school or work)"
                checked={away !== null}
                onChange={(on) => {
                  update(i, { away: on ? { from: 9, to: 17 } : null });
                }}
              />
              {away ? (
                <div className="row">
                  <NumberField
                    id={`${id}-away-from`}
                    label="Leaves at (hour, 0–23)"
                    value={away.from}
                    min={0}
                    max={23}
                    error={errors[`${id}-away-from`]}
                    onChange={(from) => {
                      update(i, { away: { from, to: away.to } });
                    }}
                  />
                  <NumberField
                    id={`${id}-away-to`}
                    label="Back at (hour, 1–24)"
                    value={away.to}
                    min={1}
                    max={24}
                    error={errors[`${id}-away-to`]}
                    onChange={(to) => {
                      update(i, { away: { from: away.from, to } });
                    }}
                  />
                </div>
              ) : null}
            </div>
            <button
              type="button"
              className="btn btn--quiet"
              disabled={members.length <= LIMITS.profile.membersMin}
              onClick={() => {
                onRemove(i);
              }}
            >
              Remove {m.name || `person ${i + 1}`}
            </button>
          </div>
        );
      })}
      <button
        type="button"
        className="btn"
        disabled={members.length >= LIMITS.profile.membersMax}
        onClick={() => {
          onChange([...members, newMember(members)]);
        }}
      >
        Add a person
      </button>
    </fieldset>
  );
}
