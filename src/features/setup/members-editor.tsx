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

/** What every part of one person's card receives: its field id prefix, its value and its errors. */
interface PartProps {
  /** The id prefix for this person's fields, `f-members-<index>`, matching the error keys. */
  readonly id: string;
  readonly member: Member;
  readonly errors: Readonly<Record<string, string>>;
  /** Applies a change to this person. */
  readonly update: (patch: Partial<Member>) => void;
}

/** The person's name and age band. */
function NameAndAge({ id, member, errors, update }: PartProps): ReactElement {
  return (
    <div className="row">
      <TextField
        id={`${id}-name`}
        label="Name"
        value={member.name}
        maxLength={LIMITS.profile.memberNameMax}
        error={errors[`${id}-name`]}
        onChange={(name) => {
          update({ name });
        }}
      />
      <SelectField
        id={`${id}-age`}
        label="Age"
        value={member.age}
        values={AGE_BANDS}
        labels={AGE_LABELS}
        onChange={(age) => {
          update({ age });
        }}
      />
    </div>
  );
}

/** One checkbox per health condition that changes the guidance. */
function Conditions({ id, member, update }: PartProps): ReactElement {
  return (
    <fieldset className="group group--inline">
      <legend>Health conditions</legend>
      {CONDITIONS.map((c) => (
        <CheckField
          key={c}
          id={`${id}-cond-${c}`}
          label={CONDITION_LABELS[c]}
          checked={member.conditions.includes(c)}
          onChange={(on) => {
            update({ conditions: toggle(member.conditions, c, on) });
          }}
        />
      ))}
    </fieldset>
  );
}

/** Whether the person is away for part of the day, and between which hours. */
function AwayHours({ id, member, errors, update }: PartProps): ReactElement {
  const { away } = member;
  return (
    <div id={`${id}-away`}>
      <CheckField
        id={`${id}-awayOn`}
        label="Away from home for part of the day (school or work)"
        checked={away !== null}
        onChange={(on) => {
          update({ away: on ? { from: 9, to: 17 } : null });
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
              update({ away: { from, to: away.to } });
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
              update({ away: { from: away.from, to } });
            }}
          />
        </div>
      ) : null}
    </div>
  );
}

/** One person's card: every field, and the button that removes them (never the last person). */
function MemberCard(
  props: PartProps & {
    readonly index: number;
    readonly canRemove: boolean;
    readonly onRemove: () => void;
  },
): ReactElement {
  const { index, member, canRemove, onRemove } = props;
  return (
    <div className="card">
      <h3>{member.name || `Person ${index + 1}`}</h3>
      <NameAndAge {...props} />
      <Conditions {...props} />
      <AwayHours {...props} />
      <button type="button" className="btn btn--quiet" disabled={!canRemove} onClick={onRemove}>
        Remove {member.name || `person ${index + 1}`}
      </button>
    </div>
  );
}

/** The editor for the people in the household. */
export function MembersEditor(props: {
  readonly members: readonly Member[];
  readonly errors: Readonly<Record<string, string>>;
  readonly onChange: (members: readonly Member[]) => void;
  readonly onRemove: (index: number) => void;
}): ReactElement {
  const { members, errors, onChange, onRemove } = props;
  return (
    <fieldset id="f-members" className="group">
      <legend>Who lives in the household?</legend>
      <FieldError id="f-members" error={errors['f-members']} />
      {members.map((member, i) => (
        <MemberCard
          key={member.id}
          id={`f-members-${i}`}
          index={i}
          member={member}
          errors={errors}
          canRemove={members.length > LIMITS.profile.membersMin}
          update={(patch) => {
            onChange(patchAt(members, i, patch));
          }}
          onRemove={() => {
            onRemove(i);
          }}
        />
      ))}
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
