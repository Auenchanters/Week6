/**
 * Covers personal exposure: how activities are laid onto the 24 hours (partial hours, spans,
 * overlaps, midnight), away and N95 handling, trip versus outing air, dose, mean and cigarettes.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  AWAY_INDOOR_RATIO,
  BREATHING_M3_PER_H,
  MODE_EXPOSURE_RATIO,
  N95_REDUCTION,
} from '../../src/domain/coefficients.js';
import { activityAir, memberExposure, memberSlices } from '../../src/domain/exposure.js';
import { CLEAN_HOME, activityWith, flat, flatWith, memberWith } from '../support/profiles.js';

const member = memberWith();
const air = { outdoor: flat(100), indoor: flat(40) };

describe('activityAir', () => {
  it('uses the mode ratio and effort for trips', () => {
    expect(activityAir(activityWith({ kind: 'commute', mode: 'metro' }))).toEqual({
      ratio: MODE_EXPOSURE_RATIO.metro,
      effort: 'light',
    });
    expect(activityAir(activityWith({ kind: 'school-run', mode: 'walk' }))).toEqual({
      ratio: MODE_EXPOSURE_RATIO.walk,
      effort: 'moderate',
    });
  });

  it('uses ratio 1 and the kind effort for outings, whatever the mode', () => {
    expect(activityAir(activityWith({ kind: 'exercise', mode: 'metro' }))).toEqual({
      ratio: 1,
      effort: 'vigorous',
    });
    expect(activityAir(activityWith({ kind: 'errands', mode: 'walk' }))).toEqual({
      ratio: 1,
      effort: 'light',
    });
  });
});

describe('memberSlices', () => {
  it('returns 24 hours', () => {
    expect(memberSlices(member, [], CLEAN_HOME, air)).toHaveLength(24);
  });

  it('gives an activity covering part of an hour that fraction, the rest at home', () => {
    const slices = memberSlices(
      member,
      [activityWith({ startHour: 9, durationMinutes: 30 })],
      CLEAN_HOME,
      air,
    );
    expect(slices[9]).toEqual([
      {
        place: { kind: 'activity', activityId: 'a1' },
        fraction: 0.5,
        concentration: 100,
        effort: 'moderate',
      },
      { place: { kind: 'home' }, fraction: 0.5, concentration: 40, effort: 'rest' },
    ]);
    expect(slices[8]).toEqual([
      { place: { kind: 'home' }, fraction: 1, concentration: 40, effort: 'rest' },
    ]);
  });

  it('spans several hours', () => {
    const slices = memberSlices(
      member,
      [activityWith({ startHour: 8, durationMinutes: 150 })],
      CLEAN_HOME,
      air,
    );
    const fractions = [8, 9, 10].map((h) => slices[h]?.[0]?.fraction);
    expect(fractions).toEqual([1, 1, 0.5]);
    expect(slices[10]?.[0]?.place.kind).toBe('activity');
  });

  it('gives a later overlapping activity only what is left of the hour', () => {
    const first = activityWith({ id: 'first', startHour: 9, durationMinutes: 30 });
    const second = activityWith({ id: 'second', startHour: 9, durationMinutes: 60, kind: 'play' });
    const slices = memberSlices(member, [first, second], CLEAN_HOME, air)[9] ?? [];
    expect(slices.map((s) => s.fraction)).toEqual([0.5, 0.5]);
    expect(slices.map((s) => s.place)).toEqual([
      { kind: 'activity', activityId: 'first' },
      { kind: 'activity', activityId: 'second' },
    ]);
  });

  it('drops an activity with no room left in the hour', () => {
    const first = activityWith({ id: 'first', startHour: 9, durationMinutes: 60 });
    const second = activityWith({ id: 'second', startHour: 9, durationMinutes: 60 });
    const slices = memberSlices(member, [first, second], CLEAN_HOME, air)[9] ?? [];
    expect(slices).toHaveLength(1);
  });

  it('stops an activity at midnight', () => {
    const slices = memberSlices(
      member,
      [activityWith({ startHour: 23, durationMinutes: 180 })],
      CLEAN_HOME,
      air,
    );
    expect(slices).toHaveLength(24);
    expect(slices[23]?.[0]?.fraction).toBe(1);
    expect(slices[0]?.[0]?.place.kind).toBe('home');
  });

  it('ignores activities of other members', () => {
    const other = activityWith({ memberIds: ['someone-else'] });
    expect(memberSlices(member, [other], CLEAN_HOME, air)[9]).toEqual([
      { place: { kind: 'home' }, fraction: 1, concentration: 40, effort: 'rest' },
    ]);
  });

  it('puts away hours at the away ratio of outdoor air, `to` exclusive', () => {
    const away = memberWith({ away: { from: 10, to: 12 } });
    const slices = memberSlices(away, [], CLEAN_HOME, air);
    expect(slices[10]?.[0]).toMatchObject({
      place: { kind: 'away' },
      concentration: 100 * AWAY_INDOOR_RATIO,
    });
    expect(slices[11]?.[0]?.place.kind).toBe('away');
    expect(slices[12]?.[0]?.place.kind).toBe('home');
    expect(slices[9]?.[0]?.place.kind).toBe('home');
  });

  it('an N95 cuts activity air by N95_REDUCTION but not indoor or away air', () => {
    const masked = { ...CLEAN_HOME, n95Outdoors: true };
    const away = memberWith({ away: { from: 0, to: 1 } });
    const slices = memberSlices(away, [activityWith({ startHour: 9 })], masked, air);
    expect(slices[9]?.[0]?.concentration).toBeCloseTo(100 * (1 - N95_REDUCTION));
    expect(slices[0]?.[0]?.concentration).toBeCloseTo(100 * AWAY_INDOOR_RATIO);
    expect(slices[5]?.[0]?.concentration).toBe(40);
  });

  it('scales trip air by the mode ratio and outing air by 1', () => {
    const trip = activityWith({ id: 'trip', kind: 'commute', mode: 'auto-rickshaw', startHour: 9 });
    const outing = activityWith({
      id: 'outing',
      kind: 'play',
      mode: 'auto-rickshaw',
      startHour: 11,
    });
    const slices = memberSlices(member, [trip, outing], CLEAN_HOME, air);
    expect(slices[9]?.[0]?.concentration).toBeCloseTo(100 * MODE_EXPOSURE_RATIO['auto-rickshaw']);
    expect(slices[11]?.[0]?.concentration).toBe(100);
  });

  it('falls back to 0 for hours missing from short air arrays', () => {
    const slices = memberSlices(member, [activityWith({ startHour: 9 })], CLEAN_HOME, {
      outdoor: [],
      indoor: [],
    });
    expect(slices[9]?.[0]?.concentration).toBe(0);
    expect(slices[0]?.[0]?.concentration).toBe(0);
  });
});

describe('memberExposure', () => {
  it('with no activities, breathes indoor air at rest', () => {
    const result = memberExposure(member, [], CLEAN_HOME, { outdoor: flat(100), indoor: flat(22) });
    expect(result.doseUg).toBeCloseTo(22 * BREATHING_M3_PER_H.adult.rest * 24);
    expect(result.meanExposure).toBeCloseTo(22);
    expect(result.cigarettes).toBeCloseTo(1);
    expect(result.memberId).toBe('m1');
    expect(result.hourly).toHaveLength(24);
  });

  it('computes cigarettes as mean exposure over 22', () => {
    const result = memberExposure(member, [], CLEAN_HOME, { outdoor: flat(0), indoor: flat(55) });
    expect(result.cigarettes).toBeCloseTo(result.meanExposure / 22);
  });

  it('splits the dose by place and the parts sum to the total', () => {
    const away = memberWith({ away: { from: 10, to: 14 } });
    const result = memberExposure(
      away,
      [activityWith({ startHour: 8, durationMinutes: 150 })],
      CLEAN_HOME,
      air,
    );
    expect(result.doseBy.home).toBeGreaterThan(0);
    expect(result.doseBy.away).toBeGreaterThan(0);
    expect(result.doseBy.activity).toBeGreaterThan(0);
    expect(result.doseBy.home + result.doseBy.away + result.doseBy.activity).toBeCloseTo(
      result.doseUg,
    );
  });

  it('is zero for short air arrays', () => {
    const result = memberExposure(member, [activityWith()], CLEAN_HOME, {
      outdoor: [],
      indoor: [],
    });
    expect(result.doseUg).toBe(0);
    expect(result.meanExposure).toBe(0);
  });

  it('has a non-negative dose that scales linearly with outdoor and indoor air (property)', () => {
    const away = memberWith({ away: { from: 9, to: 17 } });
    const activities = [activityWith({ startHour: 18, durationMinutes: 90, kind: 'exercise' })];
    fc.assert(
      fc.property(
        fc.array(fc.double({ min: 0, max: 500, noNaN: true }), { minLength: 24, maxLength: 24 }),
        fc.double({ min: 0, max: 10, noNaN: true }),
        (outdoor, k) => {
          const indoor = outdoor.map((c) => c * 0.5);
          const base = memberExposure(away, activities, CLEAN_HOME, { outdoor, indoor });
          const scaled = memberExposure(away, activities, CLEAN_HOME, {
            outdoor: outdoor.map((c) => c * k),
            indoor: indoor.map((c) => c * k),
          });
          expect(base.doseUg).toBeGreaterThanOrEqual(0);
          expect(Math.abs(scaled.doseUg - k * base.doseUg)).toBeLessThanOrEqual(
            1e-6 * (1 + k * base.doseUg),
          );
        },
      ),
    );
  });

  it('hour-level means reflect partial hours', () => {
    const result = memberExposure(
      member,
      [activityWith({ startHour: 9, durationMinutes: 30 })],
      CLEAN_HOME,
      { outdoor: flatWith(100, {}), indoor: flat(40) },
    );
    expect(result.hourly[9]).toBeCloseTo(0.5 * 100 + 0.5 * 40);
  });
});
