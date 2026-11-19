/**
 * The first screen: what Clearday does, a one-click sample family, and the household form.
 * Does: show the landing text, hold the draft household, validate the whole draft with
 * `profileSchema` on submit, list every problem in an error summary whose links move focus to the
 * field, and hand a valid household to the page; the same form edits a saved household.
 * Never does: fetch air data or call the AI (the page does that once a household is saved).
 */
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type SyntheticEvent,
  type ReactElement,
} from 'react';
import { LANGUAGE_NAMES } from '../../ai/prompt.js';
import { SAMPLE_PROFILE } from '../../shared/samples.js';
import { LANGUAGES, type Profile } from '../../shared/schema.js';
import { SelectField } from '../../ui/fields.js';
import '../../styles/setup.css';
import { ActivitiesEditor } from './activities-editor.js';
import { draftOf, validate, withoutMember, type Draft, type FieldError } from './draft.js';
import { HomeEditor } from './home-editor.js';
import { MembersEditor } from './members-editor.js';
import { PlaceSearch } from './place-search.js';

const CONTROLS = 'input, select, textarea, button';

/** Moves focus to the control behind `id`, or the first control inside it. */
function focusField(id: string): void {
  const el = document.getElementById(id);
  const target = el?.matches(CONTROLS) ? el : el?.querySelector<HTMLElement>(CONTROLS);
  target?.focus();
}

/** The list of problems, with a link to each field. */
function ErrorSummary({ errors }: { errors: readonly FieldError[] }): ReactElement | null {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (errors.length > 0) ref.current?.focus();
  }, [errors]);
  if (errors.length === 0) return null;
  return (
    <div className="summary" ref={ref} tabIndex={-1} role="alert" aria-labelledby="summary-title">
      <h2 id="summary-title">
        {errors.length === 1
          ? 'There is 1 thing to fix'
          : `There are ${errors.length} things to fix`}
      </h2>
      <ul>
        {errors.map((e) => (
          <li key={e.id}>
            <a
              href={`#${e.id}`}
              onClick={(ev) => {
                ev.preventDefault();
                focusField(e.id);
              }}
            >
              {e.message}
            </a>
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The landing text and the one-click sample family; editing a saved household shows a title only. */
function Landing(props: {
  readonly editing: boolean;
  readonly onSample: () => void;
}): ReactElement {
  const { editing, onSample } = props;
  return (
    <section className="landing" aria-labelledby="landing-title">
      <h1 id="landing-title">
        {editing ? 'Edit your household' : 'Breathe easier through smog season'}
      </h1>
      {editing ? null : (
        <>
          <p className="landing__lead">
            Clearday turns the day&apos;s air forecast into a plan for your family: low-emission
            routines, indoor air hacks and sustainable alternatives for where you live and how you
            live, and what each choice changes for your lungs and the climate.
          </p>
          <ul className="landing__points">
            <li>See who in your home breathes the most, hour by hour.</li>
            <li>Move walks, play and trips to the cleaner hours of the day.</li>
            <li>Try home changes and see the effect before you spend a rupee.</li>
          </ul>
          <button type="button" className="btn btn--primary" onClick={onSample}>
            See the sample family
          </button>
          <p className="field__hint">
            Or describe your own household below. It stays on this device.
          </p>
        </>
      )}
    </section>
  );
}

/** Submit, and Cancel when editing a saved household. */
function FormActions(props: {
  readonly editing: boolean;
  readonly onCancel: () => void;
}): ReactElement {
  const { editing, onCancel } = props;
  return (
    <div className="actions">
      <button type="submit" className="btn btn--primary">
        {editing ? 'Save household' : 'Show my plan'}
      </button>
      {editing ? (
        <button type="button" className="btn" onClick={onCancel}>
          Cancel
        </button>
      ) : null}
    </div>
  );
}

/** The household draft being edited, its validation errors, and the submit that saves it. */
function useDraftForm(saved: Profile | null, onSave: (profile: Profile) => void) {
  const [draft, setDraft] = useState<Draft>(() => draftOf(saved));
  const [errors, setErrors] = useState<readonly FieldError[]>([]);
  const messages = useMemo(
    () => Object.fromEntries(errors.map((e) => [e.id, e.message])),
    [errors],
  );

  const change = (patch: Partial<Draft>): void => {
    setDraft({ ...draft, ...patch });
  };
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    const result = validate(draft);
    if ('profile' in result) onSave(result.profile);
    else setErrors(result.errors);
  };
  return { draft, setDraft, change, errors, messages, submit };
}

/** The landing text and household form. */
export function SetupPage(props: {
  readonly saved: Profile | null;
  readonly editing: boolean;
  readonly onSave: (profile: Profile) => void;
  readonly onCancel: () => void;
}): ReactElement {
  const { saved, editing, onSave, onCancel } = props;
  const { draft, setDraft, change, errors, messages, submit } = useDraftForm(saved, onSave);

  return (
    <div className="setup">
      <Landing
        editing={editing}
        onSample={() => {
          onSave(SAMPLE_PROFILE);
        }}
      />
      <form className="form" noValidate onSubmit={submit} aria-labelledby="form-title">
        <h2 id="form-title">Your household</h2>
        <ErrorSummary errors={errors} />
        <PlaceSearch
          id="f-place"
          place={draft.place}
          error={messages['f-place']}
          onPick={(place) => {
            change({ place });
          }}
        />
        <MembersEditor
          members={draft.members}
          errors={messages}
          onChange={(members) => {
            change({ members });
          }}
          onRemove={(i) => {
            setDraft(withoutMember(draft, i));
          }}
        />
        <HomeEditor
          home={draft.home}
          errors={messages}
          onChange={(patch) => {
            change({ home: { ...draft.home, ...patch } });
          }}
        />
        <ActivitiesEditor
          activities={draft.activities}
          members={draft.members}
          errors={messages}
          onChange={(activities) => {
            change({ activities });
          }}
        />
        <SelectField
          id="f-language"
          label="Language for AI advice"
          value={draft.language}
          values={LANGUAGES}
          labels={LANGUAGE_NAMES}
          onChange={(language) => {
            change({ language });
          }}
        />
        <FormActions editing={editing} onCancel={onCancel} />
      </form>
    </div>
  );
}
