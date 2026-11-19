/**
 * The hero: the day's India AQI as a big number with its category and main pollutant, the US AQI
 * beside it, the cigarette-equivalent headline for the most exposed person, and one takeaway line.
 * Does: show the AI's summary (labelled, in the household's language) when it has been fetched,
 * otherwise the engine's own biggest change.
 * Never does: round the engine's numbers beyond one decimal, or rely on colour alone (the category
 * is always named).
 */
import type { ReactElement } from 'react';
import type { DayPlan } from '../../domain/plan.js';
import type { Language, Member } from '../../shared/schema.js';
import { cigarettes, micrograms } from '../../ui/format.js';
import { CATEGORY_LABELS, POLLUTANT_LABELS, swapTitle } from '../../ui/labels.js';

/** The hero section; `summary` is the AI's summary, when there is one. */
export function Hero(props: {
  readonly plan: DayPlan;
  readonly members: readonly Member[];
  readonly language: Language;
  readonly summary: string | null;
}): ReactElement {
  const { plan, members, language, summary } = props;
  const worst = plan.people.reduce((a, b) => (b.before.cigarettes > a.before.cigarettes ? b : a));
  const top = plan.swaps[0];
  const day = plan.dayIndex === 0 ? 'Today' : 'Tomorrow';
  return (
    <section className="hero" aria-labelledby="hero-title">
      <div className="hero__aqi">
        <p className="hero__label">India AQI</p>
        <p className="hero__value">{plan.day.value}</p>
        <p className="hero__category">{CATEGORY_LABELS[plan.day.category]}</p>
        <p className="hero__small">
          Mainly {POLLUTANT_LABELS[plan.day.dominant]} · US AQI (PM2.5) {plan.usAqi}
        </p>
      </div>
      <div className="hero__text">
        <h2 id="hero-title">
          {day}&apos;s air is like smoking {cigarettes(worst.before.cigarettes)} for{' '}
          {worst.member.name}
        </h2>
        {summary ? (
          <p lang={language} dir="auto">
            <span className="tag tag--ai">AI · personalized</span> {summary}
          </p>
        ) : top ? (
          <p>
            Biggest single change: {swapTitle(top, members)}. It saves your household about{' '}
            {micrograms(top.doseSavedUg)} of PM2.5 a day.
          </p>
        ) : (
          <p>Your routine already keeps exposure about as low as the engine can find.</p>
        )}
      </div>
    </section>
  );
}
