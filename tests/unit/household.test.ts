/**
 * Covers the household model: one day of indoor air plus every member's dose, and the weekly CO2
 * footprint by source (travel billed per vehicle for cars, per rider otherwise).
 */
import { describe, expect, it } from 'vitest';
import { householdDay, weeklyFootprint } from '../../src/domain/household.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';
import { activityWith, cleanProfile, flat, memberWith, profileWith } from '../support/profiles.js';

describe('householdDay', () => {
  const outdoor = flat(150);

  it('has one exposure per member and a total that is their sum', () => {
    const day = householdDay(SAMPLE_PROFILE, outdoor);
    expect(day.members).toHaveLength(SAMPLE_PROFILE.members.length);
    expect(day.totalDoseUg).toBeCloseTo(day.members.reduce((s, m) => s + m.doseUg, 0));
    expect(day.indoor.hourly).toHaveLength(24);
  });

  it('feeds the model indoor air, so indoor-heavy members breathe less than outdoors', () => {
    const day = householdDay(cleanProfile(), outdoor);
    expect(day.members[0]?.meanExposure).toBeLessThan(150);
  });

  it('lets the airing hours override the window habit', () => {
    const usual = householdDay(SAMPLE_PROFILE, outdoor);
    const shut = householdDay(SAMPLE_PROFILE, outdoor, []);
    expect(shut.indoor.mean).toBeLessThan(usual.indoor.mean);
  });
});

describe('weeklyFootprint', () => {
  it('adds up the sample household by source', () => {
    const foot = weeklyFootprint(SAMPLE_PROFILE);
    // Two car commutes of 14 km (one vehicle each, 5 days), plus an auto-rickshaw for two riders.
    expect(foot.co2Kg.travel).toBeCloseTo(2 * 0.164 * 14 * 5 + 0.06 * 3 * 2 * 6);
    expect(foot.co2Kg.cooking).toBeCloseTo(0.6 * 3 * 7);
    expect(foot.co2Kg.heating).toBeCloseTo(1.44 * 4 * 7);
    expect(foot.co2Kg.purifier).toBe(0);
    expect(foot.totalCo2Kg).toBeCloseTo(
      foot.co2Kg.travel + foot.co2Kg.cooking + foot.co2Kg.heating + foot.co2Kg.purifier,
    );
    expect(foot.outdoorPmG).toBeCloseTo(19.6);
  });

  it('bills a car per vehicle and a bus per passenger', () => {
    const members = [memberWith(), memberWith({ id: 'm2' })];
    const trip = { memberIds: ['m1', 'm2'], distanceKm: 10, daysPerWeek: 5 };
    const car = weeklyFootprint(
      profileWith({ members, activities: [activityWith({ ...trip, mode: 'car-recirculation' })] }),
    );
    const bus = weeklyFootprint(
      profileWith({ members, activities: [activityWith({ ...trip, mode: 'bus' })] }),
    );
    expect(car.co2Kg.travel).toBeCloseTo(0.164 * 10 * 5);
    expect(bus.co2Kg.travel).toBeCloseTo(0.102 * 10 * 5 * 2);
  });

  it('counts the purifier electricity on the grid factor', () => {
    const foot = weeklyFootprint(cleanProfile([], { purifier: 'medium' }));
    expect(foot.co2Kg.purifier).toBeCloseTo(0.05 * 24 * 0.716 * 7);
  });

  it('is zero outdoors PM and free of heating for a clean home', () => {
    const foot = weeklyFootprint(cleanProfile());
    expect(foot.outdoorPmG).toBe(0);
    expect(foot.co2Kg.heating).toBe(0);
    expect(foot.co2Kg.travel).toBe(0);
  });
});
