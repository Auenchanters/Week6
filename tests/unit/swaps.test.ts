/**
 * Covers the swap catalog: mode alternatives, purifier sizing, which candidates apply to a home,
 * and measuring, filtering and ranking them (including trade-offs and street PM).
 */
import { describe, expect, it } from 'vitest';
import { candidates, measureSwaps, modeAlternatives, purifierFor } from '../../src/domain/swaps.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';
import { sampleForecast } from '../../server/sample-forecast.js';
import { activityWith, cleanProfile, flat, profileWith } from '../support/profiles.js';

const sampleOutdoor = sampleForecast('2026-11-18', '2026-11-19')
  .hours.slice(0, 24)
  .map((h) => h.pm25);

describe('modeAlternatives', () => {
  it.each([
    [10, 'car-windows-open', ['metro', 'bus', 'car-recirculation']],
    [2, 'car-windows-open', ['walk', 'cycle', 'car-recirculation']],
    [3, 'two-wheeler', ['metro', 'bus', 'walk', 'cycle']],
    [10, 'metro', ['bus']],
    [2, 'walk', ['cycle']],
    [10, 'car-recirculation', ['metro', 'bus']],
    [10, 'bus', ['metro']],
  ] as const)('%f km by %s offers %j', (distanceKm, mode, expected) => {
    expect(modeAlternatives(activityWith({ distanceKm, mode }))).toEqual(expected);
  });

  it('never offers the current mode', () => {
    for (const mode of ['walk', 'cycle', 'bus', 'metro', 'car-windows-open'] as const)
      expect(modeAlternatives(activityWith({ distanceKm: 3, mode }))).not.toContain(mode);
  });
});

describe('purifierFor', () => {
  it.each([
    [10, 'small'],
    [12, 'small'],
    [13, 'medium'],
    [24, 'medium'],
    [25, 'large'],
    [36, 'large'],
    [37, 'large'],
    [200, 'large'],
  ] as const)('%i m² gets a %s purifier', (area, size) => {
    expect(purifierFor(area)).toBe(size);
  });
});

describe('candidates', () => {
  const ids = (p: Parameters<typeof candidates>[0]): string[] => candidates(p).map((c) => c.id);

  it('lists every applicable change for the sample household', () => {
    expect(ids(SAMPLE_PROFILE)).toEqual(
      expect.arrayContaining([
        'travel.ravi-to-work.metro',
        'travel.ravi-to-work.bus',
        'travel.ravi-to-work.car-recirculation',
        'travel.school-run.walk',
        'home.purifier.large',
        'home.exhaust-fan',
        'cooking.induction',
        'heating.electric',
        'heating.fewer-hours',
        'protection.n95',
        'home.no-incense',
        'community.compost',
      ]),
    );
    expect(ids(SAMPLE_PROFILE)).not.toContain('cooking.lpg');
    expect(ids(SAMPLE_PROFILE)).not.toContain('home.smoke-free');
  });

  it('lists nothing for a household that has already made every change', () => {
    const done = cleanProfile([], { purifier: 'small', exhaustFan: true, n95Outdoors: true });
    expect(candidates(done)).toEqual([]);
  });

  it('suggests no purifier when one exists and sizes the suggestion otherwise', () => {
    expect(ids(cleanProfile([], { purifier: 'small' }))).not.toContain('home.purifier.small');
    expect(ids(cleanProfile([], { areaM2: 20 }))).toContain('home.purifier.medium');
  });

  it('prices a small purifier as medium cost and larger ones as high', () => {
    const cost = (areaM2: number): string | undefined =>
      candidates(cleanProfile([], { areaM2 })).find((c) => c.id.startsWith('home.purifier.'))?.cost;
    expect(cost(10)).toBe('medium');
    expect(cost(60)).toBe('high');
  });

  it('only suggests LPG over kerosene or biomass, and an exhaust fan only for fuel cooking', () => {
    expect(ids(cleanProfile([], { cookingFuel: 'biomass' }))).toEqual(
      expect.arrayContaining(['cooking.lpg', 'cooking.induction', 'home.exhaust-fan']),
    );
    expect(ids(cleanProfile([], { cookingFuel: 'kerosene' }))).toContain('cooking.lpg');
    expect(ids(cleanProfile([], { cookingFuel: 'lpg' }))).not.toContain('cooking.lpg');
    expect(ids(cleanProfile([], { cookingFuel: 'induction' }))).not.toContain('home.exhaust-fan');
    expect(ids(cleanProfile([], { cookingFuel: 'lpg', exhaustFan: true }))).not.toContain(
      'home.exhaust-fan',
    );
  });

  it('suggests heater changes by heater and hours', () => {
    expect(ids(cleanProfile([], { heater: 'kerosene', heaterHours: 3 }))).toEqual(
      expect.arrayContaining(['heating.electric', 'heating.fewer-hours']),
    );
    const electric = ids(cleanProfile([], { heater: 'electric', heaterHours: 2 }));
    expect(electric).not.toContain('heating.electric');
    expect(electric).not.toContain('heating.fewer-hours');
    expect(ids(cleanProfile())).not.toContain('heating.electric');
  });

  it('suggests N95s only when there are activities and none are worn', () => {
    expect(ids(cleanProfile([]))).not.toContain('protection.n95');
    expect(ids(cleanProfile([activityWith()]))).toContain('protection.n95');
    expect(ids(cleanProfile([activityWith()], { n95Outdoors: true }))).not.toContain(
      'protection.n95',
    );
  });

  it('suggests smoke-free and no-incense homes when those habits exist', () => {
    expect(ids(cleanProfile([], { smokingIndoors: true, incense: true }))).toEqual(
      expect.arrayContaining(['home.smoke-free', 'home.no-incense']),
    );
  });

  it('skips travel changes for activities with no distance', () => {
    expect(
      ids(cleanProfile([activityWith({ distanceKm: 0 })])).some((i) => i.startsWith('travel.')),
    ).toBe(false);
  });

  it('applies a change without touching the original profile', () => {
    const fan = candidates(SAMPLE_PROFILE).find((c) => c.id === 'home.exhaust-fan');
    expect(fan?.apply(SAMPLE_PROFILE).home.exhaustFan).toBe(true);
    expect(SAMPLE_PROFILE.home.exhaustFan).toBe(false);
    const trip = candidates(SAMPLE_PROFILE).find((c) => c.id === 'travel.school-run.walk');
    expect(trip?.apply(SAMPLE_PROFILE).activities.find((a) => a.id === 'school-run')?.mode).toBe(
      'walk',
    );
    expect(trip?.trip).toMatchObject({ from: 'auto-rickshaw', to: 'walk' });
  });
});

describe('the home rules', () => {
  // A home with every habit the catalog can change, so every rule applies once.
  const worst = cleanProfile([activityWith({ distanceKm: 0 })], {
    purifier: 'small',
    cookingFuel: 'biomass',
    heater: 'coal-wood',
    heaterHours: 5,
    incense: true,
    smokingIndoors: true,
    burnsWaste: true,
  });

  it.each([
    [
      'home.exhaust-fan',
      'home',
      'low',
      'Running a kitchen exhaust fan while cooking',
      { exhaustFan: true },
    ],
    ['cooking.lpg', 'cooking', 'medium', 'Cooking on LPG instead', { cookingFuel: 'lpg' }],
    [
      'cooking.induction',
      'cooking',
      'medium',
      'Cooking on induction instead',
      { cookingFuel: 'induction' },
    ],
    [
      'heating.electric',
      'heating',
      'medium',
      'Heating with an electric heater instead of burning fuel',
      { heater: 'electric' },
    ],
    [
      'heating.fewer-hours',
      'heating',
      'low',
      'Running the heater 2 hours less (draught-proofing, warmer layers)',
      { heaterHours: 3 },
    ],
    [
      'protection.n95',
      'protection',
      'low',
      'Wearing a fitted N95 mask outdoors',
      { n95Outdoors: true },
    ],
    ['home.no-incense', 'home', 'free', 'Not burning incense indoors', { incense: false }],
    ['home.smoke-free', 'home', 'free', 'Keeping the home smoke-free', { smokingIndoors: false }],
    [
      'community.compost',
      'community',
      'free',
      'Composting garden and kitchen waste instead of burning it',
      { burnsWaste: false },
    ],
  ] as const)(
    '%s is a %s change at %s cost that applies exactly its patch',
    (id, category, cost, label, patch) => {
      const rule = candidates(worst).find((c) => c.id === id);
      expect(rule).toMatchObject({ category, cost, label });
      expect(rule?.apply(worst).home).toEqual({ ...worst.home, ...patch });
    },
  );

  it('suggests fewer heater hours only when a heater is used', () => {
    const noHeater = cleanProfile([], { heater: 'none', heaterHours: 5 });
    expect(candidates(noHeater).map((c) => c.id)).not.toContain('heating.fewer-hours');
  });
});

describe('measureSwaps', () => {
  const swaps = measureSwaps(SAMPLE_PROFILE, sampleOutdoor);

  it('ranks by dose saved, then CO2 saved, then id', () => {
    for (let i = 1; i < swaps.length; i += 1) {
      const a = swaps[i - 1];
      const b = swaps[i];
      if (a === undefined || b === undefined) throw new Error('missing swap');
      const order =
        b.doseSavedUg - a.doseSavedUg || b.co2SavedKg - a.co2SavedKg || a.id.localeCompare(b.id);
      expect(order).toBeLessThanOrEqual(0);
    }
  });

  it('breaks exact ties in dose by CO2 and then id', () => {
    // On zero outdoor air several swaps save the same (zero) outdoor-driven dose.
    const zero = measureSwaps(profileWith({ home: { burnsWaste: true, incense: false } }), flat(0));
    for (let i = 1; i < zero.length; i += 1) {
      const a = zero[i - 1];
      const b = zero[i];
      if (a === undefined || b === undefined) throw new Error('missing swap');
      if (a.doseSavedUg === b.doseSavedUg && a.co2SavedKg === b.co2SavedKg)
        expect(a.id.localeCompare(b.id)).toBeLessThan(0);
    }
  });

  it('keeps trade-offs: a purifier saves dose but costs CO2', () => {
    const purifier = swaps.find((s) => s.id === 'home.purifier.large');
    expect(purifier?.doseSavedUg).toBeGreaterThan(0);
    expect(purifier?.co2SavedKg).toBeLessThan(0);
    expect(purifier?.co2SavedKg).toBeCloseTo(-(0.07 * 24 * 0.716 * 7));
    expect(purifier?.cost).toBe('high');
    expect(purifier?.category).toBe('home');
  });

  it('reports composting as street PM saved: 9.8 g/kg x 2 kg', () => {
    const compost = swaps.find((s) => s.id === 'community.compost');
    expect(compost?.streetPmSavedG).toBeCloseTo(9.8 * 2);
    expect(compost?.category).toBe('community');
  });

  it('measures cigarettes saved alongside dose', () => {
    const incense = swaps.find((s) => s.id === 'home.no-incense');
    expect(incense?.cigarettesSaved).toBeGreaterThan(0);
  });

  it('carries the trip for travel changes', () => {
    const trip = swaps.find((s) => s.id === 'travel.ravi-to-work.metro');
    expect(trip?.trip?.activity.id).toBe('ravi-to-work');
    expect(trip?.co2SavedKg).toBeGreaterThan(0);
  });

  it('drops changes that help nothing', () => {
    // With no outdoor PM2.5 an N95 saves no dose, no CO2 and no street PM.
    const clean = measureSwaps(SAMPLE_PROFILE, flat(0));
    expect(clean.map((s) => s.id)).not.toContain('protection.n95');
    for (const s of swaps)
      expect(s.doseSavedUg >= 1 || s.co2SavedKg >= 0.1 || s.streetPmSavedG > 0).toBe(true);
  });

  it('is empty when nothing applies', () => {
    expect(
      measureSwaps(cleanProfile([], { purifier: 'small', exhaustFan: true }), flat(100)),
    ).toEqual([]);
  });
});
