/**
 * Covers the day plan end to end on the sample household and forecast: dates, per-person
 * before/after doses, the worst hour, and the degenerate empty forecast. Its wording as facts is
 * covered in facts.test.ts.
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
});

describe('buildDayPlan edge cases', () => {
  it('does not throw and gives an empty date for a forecast with no hours', () => {
    const empty: Forecast = { source: 'sample', timezone: 'Asia/Kolkata', hours: [] };
    const plan = buildDayPlan(SAMPLE_PROFILE, empty, 0);
    expect(plan.date).toBe('');
    expect(plan.worst).toEqual({ hour: 0, pm25: 0 });
    expect(plan.day.value).toBe(0);
  });

  it('keeps the earliest hour as worst on a tie and reports no airing saving when windows are closed', () => {
    const plan = buildDayPlan(profileWith({ home: { windows: 'closed' } }), flatForecast(80), 0);
    expect(plan.worst).toEqual({ hour: 0, pm25: 80 });
    expect(plan.airing.savedUg).toBe(0);
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
