/**
 * The plan's wording as facts: stable, unique ids in reading order, one sentence each, and the
 * recorded text for the sample household, so a wording change is a reviewed snapshot change.
 */
import { describe, expect, it } from 'vitest';
import { factsFor } from '../../src/ai/facts.js';
import { buildDayPlan, type DayPlan } from '../../src/domain/plan.js';
import type { Forecast } from '../../src/shared/schema.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';
import { sampleForecast } from '../../server/sample-forecast.js';
import { flatForecast, profileWith } from '../support/profiles.js';

const forecast = sampleForecast('2026-11-18', '2026-11-19');
const today = buildDayPlan(SAMPLE_PROFILE, forecast, 0);
const tomorrow = buildDayPlan(SAMPLE_PROFILE, forecast, 1);
const factsOf = (plan: DayPlan) => factsFor(plan, SAMPLE_PROFILE);

const FACT_ID = /^(air\.|indoor\.|member\.|guidance\.|move\.|airing$|swap\.|footprint$)/u;

describe('factsFor on the sample household', () => {
  it('emits unique fact ids, all with a documented prefix', () => {
    for (const plan of [today, tomorrow]) {
      const ids = factsOf(plan).map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(FACT_ID);
      for (const fact of factsOf(plan)) expect(fact.text.length).toBeGreaterThan(0);
    }
  });

  it('states one member and one guidance fact per person, a footprint and the key air facts', () => {
    const ids = factsOf(today).map((f) => f.id);
    for (const m of SAMPLE_PROFILE.members) {
      expect(ids).toContain(`member.${m.id}`);
      expect(ids).toContain(`guidance.${m.id}`);
    }
    expect(ids).toEqual(
      expect.arrayContaining(['air.day', 'air.cleanest', 'air.worst', 'indoor.mean', 'footprint']),
    );
    expect(ids).toContain('airing');
    expect(ids.some((id) => id.startsWith('move.'))).toBe(true);
    expect(ids.some((id) => id.startsWith('swap.'))).toBe(true);
    expect(ids.at(-1)).toBe('footprint');
  });

  it('matches the recorded facts text', () => {
    expect(factsOf(today).map((f) => `${f.id}: ${f.text}`)).toMatchSnapshot();
  });

  it('words each swap with its direction, cost and street PM', () => {
    const texts = factsOf(today)
      .filter((f) => f.id.startsWith('swap.'))
      .map((f) => f.text);
    expect(texts.some((t) => t.includes('µg less PM2.5 breathed') && t.includes('Cost:'))).toBe(
      true,
    );
    expect(texts.some((t) => t.includes('kg more CO2'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Switching the '))).toBe(true);
    expect(texts.some((t) => t.includes('into the street a week'))).toBe(true);
  });
});

describe('factsFor edge cases', () => {
  it('still states the footprint for a forecast with no hours', () => {
    const empty: Forecast = { source: 'sample', timezone: 'Asia/Kolkata', hours: [] };
    const plan = buildDayPlan(SAMPLE_PROFILE, empty, 0);
    expect(factsOf(plan).map((f) => f.id)).toContain('footprint');
  });

  it('states no airing fact when airing would save nothing', () => {
    const profile = profileWith({ home: { windows: 'closed' } });
    const plan = buildDayPlan(profile, flatForecast(80), 0);
    expect(factsFor(plan, profile).map((f) => f.id)).not.toContain('airing');
  });
});
