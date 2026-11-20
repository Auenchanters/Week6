/**
 * "Ask Clearday": a question box with three suggested questions built from this household, and the
 * answers with their cited facts.
 * Does: send one question per submit (disabled while it runs), keep the conversation in a polite
 * live region, and label answers as AI, in the household's language.
 * Never does: ask on its own; suggestions only fill the box.
 */
import { useState, type SyntheticEvent, type ReactElement } from 'react';
import type { Fact } from '../../ai/facts.js';
import type { DayPlan } from '../../domain/plan.js';
import { LIMITS } from '../../shared/limits.js';
import type { Profile } from '../../shared/schema.js';
import { clock } from '../../ui/format.js';
import { AI_TAG, KIND_LABELS } from '../../ui/labels.js';
import { Cites } from './cites.js';
import type { Exchange } from './use-ai.js';

/** Three questions this household could ask, from its own people and outings. */
function suggestionsFor(profile: Profile, plan: DayPlan): string[] {
  const activity = profile.activities.find((a) => a.kind === 'play') ?? profile.activities[0];
  const owner = profile.members.find((m) => m.id === activity?.memberIds[0]) ?? profile.members[0];
  const name = String(owner?.name);
  const worst = plan.people.reduce((a, b) => (b.before.doseUg > a.before.doseUg ? b : a));
  return [
    activity
      ? `Is ${clock(activity.startHour)} OK for ${name}'s ${KIND_LABELS[activity.kind].toLowerCase()}?`
      : `Is it safe for ${name} to go outside today?`,
    `What is the single best change for ${worst.member.name}?`,
    'When should we open the windows today?',
  ];
}

/** The ask panel. */
export function AskPanel(props: {
  readonly profile: Profile;
  readonly plan: DayPlan;
  /** The plan's facts, which every answer cites. */
  readonly facts: readonly Fact[];
  readonly exchanges: readonly Exchange[];
  readonly loading: boolean;
  readonly error: string;
  readonly onAsk: (question: string) => void;
}): ReactElement {
  const { profile, plan, facts, exchanges, loading, error, onAsk } = props;
  const [question, setQuestion] = useState('');
  const submit = (event: SyntheticEvent): void => {
    event.preventDefault();
    if (question.trim().length < 2) return;
    onAsk(question.trim());
    setQuestion('');
  };
  return (
    <section aria-labelledby="ask-title">
      <h2 id="ask-title">Ask Clearday</h2>
      <ul className="chips" aria-label="Suggested questions">
        {suggestionsFor(profile, plan).map((s) => (
          <li key={s}>
            <button
              type="button"
              className="chip chip--button"
              onClick={() => {
                setQuestion(s);
              }}
            >
              {s}
            </button>
          </li>
        ))}
      </ul>
      <form onSubmit={submit} className="ask">
        <label htmlFor="ask-input">Your question about this day</label>
        <input
          id="ask-input"
          type="text"
          value={question}
          maxLength={LIMITS.ai.questionMax}
          onChange={(e) => {
            setQuestion(e.target.value);
          }}
        />
        <button type="submit" className="btn btn--primary" disabled={loading}>
          {loading ? 'Thinking…' : 'Ask'}
        </button>
      </form>
      <div aria-live="polite" className="status">
        {error ? <p className="field__error">{error}</p> : null}
        {exchanges.map((x, i) => (
          <div className="exchange" key={`${i}-${x.question}`}>
            <p>
              <strong>You asked:</strong> {x.question}
            </p>
            <p lang={profile.language} dir="auto">
              <span className="tag tag--ai">{AI_TAG}</span> {x.answer.answer}
            </p>
            <Cites ids={x.answer.cites} facts={facts} />
          </div>
        ))}
      </div>
    </section>
  );
}
