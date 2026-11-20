/**
 * The dashboard: the day's air and what it means for this household, laid out as sections of one
 * page with an in-page menu.
 * Does: compose the header band, hero, air ribbon, people, re-planned day, what-if, ledger, AI
 * advice, questions and the AI-at-work panel from one plan, and own the AI results and last call
 * metadata the panels share.
 * Never does: build the plan (the household state does) or call the AI by itself.
 */
import { useMemo, useState, type ReactElement } from 'react';
import { factsFor } from '../../ai/facts.js';
import type { DayIndex, DayPlan } from '../../domain/plan.js';
import type { AiMeta, Forecast, Home, Profile } from '../../shared/schema.js';
import '../../styles/dashboard.css';
import { AdvicePanel } from './advice-panel.js';
import { AiAtWork } from './ai-at-work.js';
import { AirRibbon } from './air-ribbon.js';
import { AskPanel } from './ask-panel.js';
import { DayPlanSection } from './day-plan.js';
import { HeaderBand } from './header-band.js';
import { Hero } from './hero.js';
import { Ledger } from './ledger.js';
import { People } from './people.js';
import { useAdvice, useAsk } from './use-ai.js';
import { WhatIf } from './what-if.js';

const MENU = [
  ['ribbon-title', 'Air'],
  ['people-title', 'People'],
  ['day-title', 'Your day'],
  ['whatif-title', 'What-if'],
  ['ledger-title', 'Choices'],
  ['advice-title', 'Advice'],
  ['ask-title', 'Ask'],
] as const;

/** Everything the dashboard needs. */
export interface DashboardProps {
  readonly profile: Profile;
  readonly forecast: Forecast;
  readonly plan: DayPlan;
  readonly onDay: (day: DayIndex) => void;
  readonly onEdit: () => void;
  /** Save a changed household (the what-if's "keep" and the language choice). */
  readonly onSave: (profile: Profile) => void;
}

/** The dashboard page. */
export default function Dashboard(props: DashboardProps): ReactElement {
  const { profile, forecast, plan, onDay, onEdit, onSave } = props;
  const [meta, setMeta] = useState<AiMeta | null>(null);
  // The facts the AI cites, worded once per plan for both panels.
  const facts = useMemo(() => factsFor(plan, profile), [plan, profile]);
  const input = { profile, forecast, plan };
  const advice = useAdvice(input, setMeta);
  const ask = useAsk(input, setMeta);
  const keep = (home: Home): void => {
    onSave({ ...profile, home });
  };
  return (
    <div className={`dash cat-${plan.day.category}`}>
      <HeaderBand
        place={profile.place.name}
        plan={plan}
        fetchedAt={forecast.fetchedAt}
        onDay={onDay}
        onEdit={onEdit}
      />
      <nav className="menu" aria-label="On this page">
        <ul>
          {MENU.map(([id, label]) => (
            <li key={id}>
              <a href={`#${id}`}>{label}</a>
            </li>
          ))}
        </ul>
      </nav>
      <Hero
        plan={plan}
        members={profile.members}
        language={profile.language}
        summary={advice.advice?.summary ?? null}
      />
      <AirRibbon plan={plan} />
      <People plan={plan} />
      <div className="pair">
        <DayPlanSection plan={plan} members={profile.members} />
        <WhatIf
          key={JSON.stringify(profile.home)}
          profile={profile}
          forecast={forecast}
          plan={plan}
          onKeep={keep}
        />
      </div>
      <Ledger key={plan.dayIndex} plan={plan} members={profile.members} />
      <div className="pair">
        <AdvicePanel
          facts={facts}
          language={profile.language}
          advice={advice.advice}
          loading={advice.loading}
          error={advice.error}
          onLanguage={(language) => {
            onSave({ ...profile, language });
          }}
          onFetch={advice.fetchAdvice}
        />
        <AskPanel
          profile={profile}
          plan={plan}
          facts={facts}
          exchanges={ask.exchanges}
          loading={ask.loading}
          error={ask.error}
          onAsk={ask.ask}
        />
      </div>
      <AiAtWork plan={plan} profile={profile} meta={meta} />
    </div>
  );
}
