/**
 * Covers the indoor PM2.5 model: hour-by-hour conditions from a home, the analytic steady state,
 * the outdoor/indoor split, and monotonicity properties for sources and purifiers.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  CEILING_M,
  DEPOSITION_PER_H,
  INFILTRATION_ACH,
  PENETRATION,
  PURIFIER_CADR_M3_PER_H,
} from '../../src/domain/coefficients.js';
import {
  heaterHourSet,
  homeConditions,
  indoorDay,
  type HourConditions,
} from '../../src/domain/indoor.js';
import { PURIFIERS, TIGHTNESS } from '../../src/shared/schema.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';
import { CLEAN_HOME, flat } from '../support/profiles.js';

const QUIET: HourConditions[] = Array.from({ length: 24 }, () => ({
  windowsOpen: 0,
  emissionsMg: 0,
  exhaustAch: 0,
}));

const outdoorArray = fc.array(fc.double({ min: 0, max: 500, noNaN: true }), {
  minLength: 24,
  maxLength: 24,
});

describe('heaterHourSet', () => {
  it('is the last N hours up to 22:00', () => {
    expect([...heaterHourSet(4)].sort((a, b) => a - b)).toEqual([19, 20, 21, 22]);
  });

  it('is empty for zero hours', () => {
    expect(heaterHourSet(0).size).toBe(0);
  });
});

describe('homeConditions', () => {
  const home = { ...SAMPLE_PROFILE.home };
  const conditions = homeConditions(home);

  it('covers 24 hours', () => {
    expect(conditions).toHaveLength(24);
  });

  it('opens windows in the morning habit hours only', () => {
    expect(conditions.flatMap((c, h) => (c.windowsOpen === 1 ? [h] : []))).toEqual([7, 8]);
  });

  it('adds up cooking, incense and heater emissions per hour', () => {
    expect(conditions[7]?.emissionsMg).toBe(4); // lpg breakfast
    expect(conditions[6]?.emissionsMg).toBe(10); // morning incense, half an hour
    expect(conditions[19]?.emissionsMg).toBe(10 + 60); // incense + coal heater
    expect(conditions[20]?.emissionsMg).toBe(4 + 60); // dinner + heater
    expect(conditions[3]?.emissionsMg).toBe(0);
  });

  it('runs the exhaust fan only while cooking', () => {
    const fan = homeConditions({ ...home, exhaustFan: true });
    expect(fan.flatMap((c, h) => (c.exhaustAch > 0 ? [h] : []))).toEqual([7, 13, 20]);
    expect(conditions.every((c) => c.exhaustAch === 0)).toBe(true);
  });

  it('adds cigarettes in smoking hours when smoking indoors', () => {
    const smoky = homeConditions({ ...CLEAN_HOME, smokingIndoors: true });
    expect(smoky[8]?.emissionsMg).toBe(12);
    expect(smoky[9]?.emissionsMg).toBe(0);
  });

  it('ignores heaterHours when there is no heater', () => {
    const none = homeConditions({ ...home, heater: 'none', heaterHours: 4, incense: false });
    expect(none[19]?.emissionsMg).toBe(0);
  });

  it('lets the caller override the airing hours', () => {
    const aired = homeConditions(home, [12, 13]);
    expect(aired.flatMap((c, h) => (c.windowsOpen === 1 ? [h] : []))).toEqual([12, 13]);
  });
});

describe('indoorDay physics', () => {
  it.each(TIGHTNESS.flatMap((t) => PURIFIERS.map((p) => [t, p] as const)))(
    'converges to the analytic steady state (%s home, %s purifier)',
    (tightness, purifier) => {
      const home = { ...CLEAN_HOME, tightness, purifier };
      const outdoor = 120;
      const a = INFILTRATION_ACH[tightness];
      const cadrPerVolume = PURIFIER_CADR_M3_PER_H[purifier] / (home.areaM2 * CEILING_M);
      const steady = (PENETRATION * a * outdoor) / (a + DEPOSITION_PER_H + cadrPerVolume);
      const day = indoorDay(home, flat(outdoor), QUIET);
      expect(day.mean).toBeCloseTo(steady, 2);
      for (const hour of day.hourly) expect(hour).toBeCloseTo(steady, 2);
    },
  );

  it('reports an outdoor share of 1 when the home has no sources', () => {
    const day = indoorDay(CLEAN_HOME, flat(80), QUIET);
    expect(day.outdoorShare).toBeCloseTo(1, 10);
    expect(day.fromOutdoors).toEqual(day.hourly);
  });

  it('reports a share below 1 when the home makes its own PM2.5', () => {
    const day = indoorDay(SAMPLE_PROFILE.home, flat(80));
    expect(day.outdoorShare).toBeGreaterThan(0);
    expect(day.outdoorShare).toBeLessThan(1);
    expect(day.conditions).toHaveLength(24);
  });

  it('gives mean 0 and share 1 for zero outdoor air and no sources', () => {
    const day = indoorDay(CLEAN_HOME, flat(0), QUIET);
    expect(day.mean).toBe(0);
    expect(day.outdoorShare).toBe(1);
  });

  it('treats hours missing from the conditions list as quiet', () => {
    const short = indoorDay(CLEAN_HOME, flat(50), []);
    const quiet = indoorDay(CLEAN_HOME, flat(50), QUIET);
    expect(short.hourly).toEqual(quiet.hourly);
  });

  it('open windows bring more outdoor air in', () => {
    const open = QUIET.map((c) => ({ ...c, windowsOpen: 1 }));
    expect(indoorDay(CLEAN_HOME, flat(100), open).mean).toBeGreaterThan(
      indoorDay(CLEAN_HOME, flat(100), QUIET).mean,
    );
  });

  it('an exhaust fan with clean outdoor air removes indoor smoke faster', () => {
    const smoky = QUIET.map((c) => ({ ...c, emissionsMg: 50 }));
    const fan = smoky.map((c) => ({ ...c, exhaustAch: 2 }));
    expect(indoorDay(CLEAN_HOME, flat(0), fan).mean).toBeLessThan(
      indoorDay(CLEAN_HOME, flat(0), smoky).mean,
    );
  });
});

describe('indoorDay properties', () => {
  it('without sources the indoor level never exceeds the highest outdoor level', () => {
    fc.assert(
      fc.property(outdoorArray, fc.constantFrom(...PURIFIERS), fc.boolean(), (outdoor, p, open) => {
        const conditions = QUIET.map((c) => ({ ...c, windowsOpen: open ? 1 : 0 }));
        const day = indoorDay({ ...CLEAN_HOME, purifier: p }, outdoor, conditions);
        const max = Math.max(...outdoor);
        for (const level of day.hourly) expect(level).toBeLessThanOrEqual(max + 1e-9);
      }),
    );
  });

  it('adding an indoor source never lowers indoor PM2.5', () => {
    fc.assert(
      fc.property(
        outdoorArray,
        fc.integer({ min: 0, max: 23 }),
        fc.double({ min: 0, max: 500, noNaN: true }),
        (outdoor, hour, emission) => {
          const withSource = QUIET.map((c, h) =>
            h === hour ? { ...c, emissionsMg: emission } : c,
          );
          const base = indoorDay(CLEAN_HOME, outdoor, QUIET);
          const more = indoorDay(CLEAN_HOME, outdoor, withSource);
          expect(more.mean).toBeGreaterThanOrEqual(base.mean - 1e-9);
          more.hourly.forEach((level, h) =>
            expect(level).toBeGreaterThanOrEqual((base.hourly[h] ?? 0) - 1e-9),
          );
        },
      ),
    );
  });

  it('a bigger purifier never raises indoor PM2.5', () => {
    fc.assert(
      fc.property(outdoorArray, (outdoor) => {
        const means = PURIFIERS.map(
          (purifier) => indoorDay({ ...SAMPLE_PROFILE.home, purifier }, outdoor).mean,
        );
        for (let i = 1; i < means.length; i += 1)
          expect(means[i] ?? 0).toBeLessThanOrEqual((means[i - 1] ?? 0) + 1e-9);
      }),
    );
  });
});
