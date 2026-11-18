/**
 * Covers the day plan end to end on the sample household and forecast: dates, facts with stable
 * ids, per-person before/after doses, the worst hour, and the degenerate empty forecast.
 */
import { describe, expect, it } from 'vitest';
import { buildDayPlan } from '../../src/domain/plan.js';
import type { Forecast } from '../../src/shared/schema.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';
import { sampleForecast } from '../../server/sample-forecast.js';
import { flatForecast, profileWith } from '../support/profiles.js';

const forecast = sampleForecast('2026-11-18', '2026-11-19');
const today = buildDayPlan(SAMPLE_PROFILE, forecast, 0);
const tomorrow = buildDayPlan(SAMPLE_PROFILE, forecast, 1);

const FACT_ID = /^(air\.|indoor\.|member\.|guidance\.|move\.|airing$|swap\.|footprint$)/u;

describe('buildDayPlan on the sample household', () => {
  it('takes the right day from the forecast', () => {
    expect(today.date).toBe('2026-11-18');
    expect(tomorrow.date).toBe('2026-11-19');
    expect(today.dayIndex).toBe(0);
    expect(tomorrow.dayIndex).toBe(1);
    expect(today.source).toBe('sample');
    expect(today.hours).toHaveLength(24);
    expect(today.hourlyNaqi).toHaveLength(24);
  });

  it('indexes the day: severe NAQI driven by PM2.5 and a US AQI of 300 or more', () => {
    expect(today.day.category).toBe('very-poor');
    expect(today.day.dominant).toBe('pm25');
    expect(today.usAqi).toBeGreaterThan(300);
    expect(tomorrow.day.value).toBeGreaterThanOrEqual(today.day.value);
  });

  it('finds the worst hour as the maximum PM2.5', () => {
    const max = Math.max(...today.hours.map((h) => h.pm25));
    expect(today.worst.pm25).toBe(max);
    expect(today.hours[today.worst.hour]?.pm25).toBe(max);
    expect(today.worst.hour).toBe(8);
  });

  it('emits unique fact ids, all with a documented prefix', () => {
    for (const plan of [today, tomorrow]) {
      const ids = plan.facts.map((f) => f.id);
      expect(new Set(ids).size).toBe(ids.length);
      for (const id of ids) expect(id).toMatch(FACT_ID);
      for (const fact of plan.facts) expect(fact.text.length).toBeGreaterThan(0);
    }
  });

  it('states one member and one guidance fact per person, a footprint and the key air facts', () => {
    const ids = today.facts.map((f) => f.id);
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

  it('never makes anyone worse off after the suggested routine', () => {
    for (const person of [...today.people, ...tomorrow.people])
      expect(person.after.doseUg).toBeLessThanOrEqual(person.before.doseUg + 1e-9);
    expect(today.after.totalDoseUg).toBeLessThanOrEqual(today.before.totalDoseUg);
  });

  it('attaches guidance per member', () => {
    const kabir = today.people.find((p) => p.member.id === 'kabir');
    expect(kabir?.actions).toContain('keep-medicines-handy');
    expect(today.people).toHaveLength(4);
  });

  it('matches the recorded facts text', () => {
    expect(today.facts.map((f) => `${f.id}: ${f.text}`)).toMatchSnapshot();
  });
});

describe('buildDayPlan edge cases', () => {
  it('does not throw and gives an empty date for a forecast with no hours', () => {
    const empty: Forecast = { source: 'sample', timezone: 'Asia/Kolkata', hours: [] };
    const plan = buildDayPlan(SAMPLE_PROFILE, empty, 0);
    expect(plan.date).toBe('');
    expect(plan.worst).toEqual({ hour: 0, pm25: 0 });
    expect(plan.day.value).toBe(0);
    expect(plan.facts.map((f) => f.id)).toContain('footprint');
  });

  it('keeps the earliest hour as worst on a tie and reports no airing saving when windows are closed', () => {
    const plan = buildDayPlan(profileWith({ home: { windows: 'closed' } }), flatForecast(80), 0);
    expect(plan.worst).toEqual({ hour: 0, pm25: 80 });
    expect(plan.airing.savedUg).toBe(0);
    expect(plan.facts.map((f) => f.id)).not.toContain('airing');
  });

  it('words each swap with its direction, cost and street PM', () => {
    const texts = today.facts.filter((f) => f.id.startsWith('swap.')).map((f) => f.text);
    expect(texts.some((t) => t.includes('µg less PM2.5 breathed') && t.includes('Cost:'))).toBe(
      true,
    );
    expect(texts.some((t) => t.includes('kg more CO2'))).toBe(true);
    expect(texts.some((t) => t.startsWith('Switching the '))).toBe(true);
    expect(texts.some((t) => t.includes('into the street a week'))).toBe(true);
  });

  it('works for a household with no activities and no conditions', () => {
    const plan = buildDayPlan(
      profileWith({ activities: [], members: SAMPLE_PROFILE.members.slice(1, 2) }),
      flatForecast(10),
      1,
    );
    expect(plan.moves).toEqual([]);
    expect(plan.date).toBe('2026-11-19');
  });
});
