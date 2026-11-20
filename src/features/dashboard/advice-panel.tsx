/**
 * The AI advice panel: one button, one model call, advice in three sections with cited facts.
 * Does: let the person pick the language, fetch advice on click (disabled while it runs), announce
 * progress and failures politely, and label the AI's text as AI and in its own language.
 * Never does: fetch on its own, or show advice for a plan other than the current one.
 */
import type { ReactElement } from 'react';
import { LANGUAGE_NAMES } from '../../ai/prompt.js';
import type { Fact } from '../../ai/facts.js';
import { LANGUAGES, type Advice, type CitedItem, type Language } from '../../shared/schema.js';
import { SelectField } from '../../ui/fields.js';
import { AI_TAG } from '../../ui/labels.js';
import { Cites } from './cites.js';

const SECTIONS = [
  { key: 'routine', title: 'Routine' },
  { key: 'indoor', title: 'Indoor hacks' },
  { key: 'alternatives', title: 'Sustainable alternatives' },
] as const;

/** One advice section: a heading and its cited items. */
function Section(props: {
  readonly title: string;
  readonly items: readonly CitedItem[];
  readonly facts: readonly Fact[];
}): ReactElement | null {
  if (props.items.length === 0) return null;
  return (
    <div>
      <h3>{props.title}</h3>
      <ul className="plain">
        {props.items.map((item) => (
          <li key={item.text}>
            <p>{item.text}</p>
            <Cites ids={item.cites} facts={props.facts} />
          </li>
        ))}
      </ul>
    </div>
  );
}

/** The advice panel. */
export function AdvicePanel(props: {
  /** The plan's facts, which every advice item cites. */
  readonly facts: readonly Fact[];
  readonly language: Language;
  readonly advice: Advice | null;
  readonly loading: boolean;
  readonly error: string;
  readonly onLanguage: (language: Language) => void;
  readonly onFetch: () => void;
}): ReactElement {
  const { facts, language, advice, loading, error, onLanguage, onFetch } = props;
  return (
    <section aria-labelledby="advice-title">
      <h2 id="advice-title">Personal advice</h2>
      <p className="muted">
        Clearday&apos;s numbers come from the engine. The AI explains them in words for your family
        and cites the facts it used.
      </p>
      <div className="toolbar">
        <SelectField
          id="advice-language"
          label="Language"
          value={language}
          values={LANGUAGES}
          labels={LANGUAGE_NAMES}
          onChange={onLanguage}
        />
        <button type="button" className="btn btn--primary" disabled={loading} onClick={onFetch}>
          {loading ? 'Getting advice…' : 'Get personal advice'}
        </button>
      </div>
      <div aria-live="polite" className="status">
        {loading ? <p>The AI is reading your day…</p> : null}
        {error ? <p className="field__error">{error}</p> : null}
      </div>
      {advice ? (
        <div className="advice" lang={language} dir="auto">
          <p className="tag tag--ai">{AI_TAG}</p>
          <p className="advice__summary">{advice.summary}</p>
          {SECTIONS.map(({ key, title }) => (
            <Section key={key} title={title} items={advice[key]} facts={facts} />
          ))}
        </div>
      ) : null}
    </section>
  );
}
