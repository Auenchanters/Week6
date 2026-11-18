/**
 * Covers the routine planner: moving flexible activities to the cleanest allowed hour (ties,
 * fixed activities, no-gain cases, sequential application) and finding the best airing time.
 */
import { describe, expect, it } from 'vitest';
import { householdDay } from '../../src/domain/household.js';
import { bestAiring, planRoutine } from '../../src/domain/routine.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';
import { sampleForecast } from '../../server/sample-forecast.js';
import {
  activityWith,
  cleanProfile,
  flat,
  flatWith,
  memberWith,
  profileWith,
} from '../support/profiles.js';
import { CLEAN_HOME } from '../support/profiles.js';

/** A member who is away all day, so every hour of an activity displaces the same kind of air. */
const away = memberWith({ away: { from: 0, to: 24 } });
const awayProfile = (...activities: ReturnType<typeof activityWith>[]) =>
  profileWith({ home: CLEAN_HOME, members: [away], activities });

describe('planRoutine', () => {
  it('moves a flexible activity to the cleanest window hour', () => {
    const profile = cleanProfile([
      activityWith({ startHour: 8, window: { earliest: 6, latest: 17 } }),
    ]);
    const plan = planRoutine(profile, flatWith(200, { 14: 10 }));
    expect(plan.moves).toHaveLength(1);
    expect(plan.moves[0]).toMatchObject({ fromHour: 8, toHour: 14 });
    expect(plan.moves[0]?.savedUg).toBeGreaterThan(0);
    expect(plan.profile.activities[0]?.startHour).toBe(14);
  });

  it('never moves an activity without a window', () => {
    const profile = cleanProfile([activityWith({ startHour: 8, window: null })]);
    const plan = planRoutine(profile, flatWith(200, { 14: 10 }));
    expect(plan.moves).toEqual([]);
    expect(plan.profile.activities[0]?.startHour).toBe(8);
  });

  it('reports no move when the window holds only the current hour', () => {
    const profile = awayProfile(activityWith({ startHour: 8, window: { earliest: 8, latest: 8 } }));
    expect(planRoutine(profile, flatWith(100, { 8: 300 })).moves).toEqual([]);
  });

  it('reports no move when the activity is already at the cleanest hour', () => {
    const profile = cleanProfile([
      activityWith({ startHour: 14, window: { earliest: 10, latest: 16 } }),
    ]);
    expect(planRoutine(profile, flatWith(200, { 14: 10 })).moves).toEqual([]);
  });

  it('reports no move when air is flat and the member is away throughout', () => {
    const profile = awayProfile(
      activityWith({ startHour: 10, window: { earliest: 8, latest: 14 } }),
    );
    expect(planRoutine(profile, flat(100)).moves).toEqual([]);
  });

  it('breaks a tie toward the hour nearest the usual start', () => {
    const profile = awayProfile(
      activityWith({ startHour: 15, window: { earliest: 8, latest: 17 } }),
    );
    const outdoor = flatWith(100, { 8: 10, 9: 10, 10: 10, 11: 10 });
    expect(planRoutine(profile, outdoor).moves[0]?.toHour).toBe(11);
  });

  it('breaks a distance tie toward the earlier hour', () => {
    const profile = awayProfile(
      activityWith({ startHour: 9, window: { earliest: 6, latest: 12 } }),
    );
    const outdoor = flatWith(100, { 8: 10, 10: 10 });
    expect(planRoutine(profile, outdoor).moves[0]?.toHour).toBe(8);
  });

  it('applies moves in order, each on top of the earlier ones', () => {
    const window = { earliest: 8, latest: 9 };
    const profile = awayProfile(
      activityWith({ id: 'a1', startHour: 15, window }),
      activityWith({ id: 'a2', startHour: 16, window }),
    );
    const outdoor = flatWith(100, { 8: 10, 9: 10 });
    const plan = planRoutine(profile, outdoor);
    expect(plan.moves.map((m) => m.activity.id)).toEqual(['a1', 'a2']);
    expect(plan.moves[0]?.fromHour).toBe(15);
    expect(plan.moves[1]?.fromHour).toBe(16);
    // The second saving is measured from the profile after the first move.
    const afterFirst = planRoutine(
      awayProfile(
        activityWith({ id: 'a1', startHour: plan.moves[0]?.toHour ?? 0, window }),
        activityWith({ id: 'a2', startHour: 16, window }),
      ),
      outdoor,
    );
    expect(afterFirst.moves[0]?.savedUg).toBeCloseTo(plan.moves[1]?.savedUg ?? NaN);
    const total =
      householdDay(profile, outdoor).totalDoseUg - householdDay(plan.profile, outdoor).totalDoseUg;
    expect(total).toBeCloseTo((plan.moves[0]?.savedUg ?? 0) + (plan.moves[1]?.savedUg ?? 0));
  });

  it('keeps every move inside its window on the sample forecast', () => {
    const outdoor = sampleForecast('2026-11-18', '2026-11-19')
      .hours.slice(0, 24)
      .map((h) => h.pm25);
    const plan = planRoutine(SAMPLE_PROFILE, outdoor);
    for (const move of plan.moves) {
      expect(move.toHour).toBeGreaterThanOrEqual(move.activity.window?.earliest ?? 99);
      expect(move.toHour).toBeLessThanOrEqual(move.activity.window?.latest ?? -1);
      expect(move.savedUg).toBeGreaterThan(0);
    }
    expect(plan.moves.length).toBeGreaterThan(0);
  });
});

describe('bestAiring', () => {
  it('picks the lowest consecutive pair between 07 and 21', () => {
    const airing = bestAiring(SAMPLE_PROFILE, flatWith(200, { 13: 20, 14: 30 }));
    expect(airing.hours).toEqual([13, 14]);
    expect(airing.outdoorMean).toBeCloseTo(25);
  });

  it('takes the earliest pair on a tie', () => {
    expect(bestAiring(SAMPLE_PROFILE, flat(100)).hours).toEqual([7, 8]);
  });

  it('ignores clean hours outside the daytime range', () => {
    expect(bestAiring(SAMPLE_PROFILE, flatWith(100, { 3: 0, 4: 0, 22: 0, 23: 0 })).hours).toEqual([
      7, 8,
    ]);
  });

  it('can end the pair at 21:00', () => {
    expect(bestAiring(SAMPLE_PROFILE, flatWith(100, { 20: 5, 21: 5 })).hours).toEqual([20, 21]);
  });

  it('saves nothing when the windows habit is closed', () => {
    const profile = profileWith({ home: { windows: 'closed' } });
    const airing = bestAiring(profile, flatWith(200, { 13: 20, 14: 30 }));
    expect(airing.savedUg).toBe(0);
    expect(airing.hours).toEqual([13, 14]);
  });

  it('saves dose for the sample family by airing at the cleanest time', () => {
    const outdoor = sampleForecast('2026-11-18', '2026-11-19')
      .hours.slice(0, 24)
      .map((h) => h.pm25);
    const airing = bestAiring(SAMPLE_PROFILE, outdoor);
    expect(airing.hours).toEqual([14, 15]);
    expect(airing.savedUg).toBeGreaterThan(0);
  });

  it('never reports a negative saving', () => {
    // Usual habit (morning) already is the cleanest pair.
    const airing = bestAiring(SAMPLE_PROFILE, flatWith(200, { 7: 5, 8: 5 }));
    expect(airing.hours).toEqual([7, 8]);
    expect(airing.savedUg).toBe(0);
  });
});
