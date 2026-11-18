/**
 * One card per household member: who they are, the PM2.5 they breathe today and with the plan (as
 * micrograms, cigarette equivalents and a before/after bar) and their precautions in plain words.
 * Never does: diagnose; the precautions come from the engine's guidance table, worded in labels.
 */
import type { ReactElement } from 'react';
import type { DayPlan, Person } from '../../domain/plan.js';
import { cigarettes, micrograms } from '../../ui/format.js';
import { AGE_LABELS, CONDITION_LABELS, GUIDANCE_TEXT } from '../../ui/labels.js';

/** Two bars on one scale: the dose now and with the plan. */
function DoseBars({ person, scale }: { person: Person; scale: number }): ReactElement {
  const width = (dose: number): number => Math.max(1, (dose / scale) * 100);
  return (
    <svg className="dose" viewBox="0 0 100 14" preserveAspectRatio="none" aria-hidden="true">
      <rect
        className="dose__before"
        x={0}
        y={0}
        width={width(person.before.doseUg)}
        height={6}
        rx={1.5}
      />
      <rect
        className="dose__after"
        x={0}
        y={8}
        width={width(person.after.doseUg)}
        height={6}
        rx={1.5}
      />
    </svg>
  );
}

/** The people section. */
export function People({ plan }: { readonly plan: DayPlan }): ReactElement {
  const scale = Math.max(1, ...plan.people.map((p) => p.before.doseUg));
  return (
    <section aria-labelledby="people-title">
      <h2 id="people-title">Who breathes what today</h2>
      <ul className="cards">
        {plan.people.map((p) => (
          <li className="card" key={p.member.id}>
            <h3>{p.member.name}</h3>
            <ul className="chips" aria-label={`About ${p.member.name}`}>
              <li>{AGE_LABELS[p.member.age]}</li>
              {p.member.conditions.map((c) => (
                <li key={c}>{CONDITION_LABELS[c]}</li>
              ))}
            </ul>
            <p>
              Breathes <strong>{micrograms(p.before.doseUg)}</strong> of PM2.5 today, with the plan{' '}
              <strong>{micrograms(p.after.doseUg)}</strong>.
            </p>
            <DoseBars person={p} scale={scale} />
            <p className="muted">
              Like smoking {cigarettes(p.before.cigarettes)} now, {cigarettes(p.after.cigarettes)}{' '}
              with the plan.
            </p>
            <h4>Precautions</h4>
            <ul className="plain">
              {p.actions.map((a) => (
                <li key={a}>{GUIDANCE_TEXT[a]}</li>
              ))}
            </ul>
          </li>
        ))}
      </ul>
    </section>
  );
}
