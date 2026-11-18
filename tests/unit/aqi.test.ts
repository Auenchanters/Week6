/**
 * Covers the air quality indices: NAQI sub-indices against the CPCB breakpoint table, dominant
 * pollutant and category, the US EPA PM2.5 AQI (2024 breakpoints), and the daily averaging rules.
 */
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  dailyLevels,
  maxRollingMean,
  mean,
  naqi,
  naqiCategory,
  naqiSubIndex,
  POLLUTANTS,
  usAqiPm25,
  type Levels,
  type Pollutant,
} from '../../src/domain/aqi.js';
import { airHour } from '../support/profiles.js';

const EDGES: Readonly<Record<Pollutant, readonly (readonly [number, number])[]>> = {
  pm25: [
    [30, 50],
    [60, 100],
    [90, 200],
    [120, 300],
    [250, 400],
  ],
  pm10: [
    [50, 50],
    [100, 100],
    [250, 200],
    [350, 300],
    [430, 400],
  ],
  no2: [
    [40, 50],
    [80, 100],
    [180, 200],
    [280, 300],
    [400, 400],
  ],
  o3: [
    [50, 50],
    [100, 100],
    [168, 200],
    [208, 300],
    [748, 400],
  ],
  co: [
    [1, 50],
    [2, 100],
    [10, 200],
    [17, 300],
    [34, 400],
  ],
  so2: [
    [40, 50],
    [80, 100],
    [380, 200],
    [800, 300],
    [1600, 400],
  ],
};

const ZERO: Levels = { pm25: 0, pm10: 0, no2: 0, o3: 0, co: 0, so2: 0 };

describe('naqiSubIndex', () => {
  for (const pollutant of POLLUTANTS) {
    it.each(EDGES[pollutant])(`${pollutant}: %f maps to %i`, (concentration, index) => {
      expect(naqiSubIndex(pollutant, concentration)).toBe(index);
    });
  }

  it.each([
    ['pm25', 15, 25],
    ['pm25', 45, 75],
    ['pm25', 315, 450],
    ['pm10', 25, 25],
    ['no2', 230, 250],
    ['o3', 134, 150],
    ['co', 0.5, 25],
    ['so2', 1000, 325],
  ] as const)('%s interior point %f gives %i', (pollutant, concentration, index) => {
    expect(naqiSubIndex(pollutant, concentration)).toBe(index);
  });

  it.each(POLLUTANTS)('%s: zero is 0 and negatives count as 0', (pollutant) => {
    expect(naqiSubIndex(pollutant, 0)).toBe(0);
    expect(naqiSubIndex(pollutant, -5)).toBe(0);
  });

  it.each([
    ['pm25', 380],
    ['pm10', 510],
    ['no2', 520],
    ['o3', 1288],
    ['co', 51],
    ['so2', 2400],
  ] as const)('%s reaches 500 at the extended top and stays there', (pollutant, top) => {
    expect(naqiSubIndex(pollutant, top)).toBe(500);
    expect(naqiSubIndex(pollutant, top * 10)).toBe(500);
  });

  it('is monotone non-decreasing and bounded in [0, 500] (property)', () => {
    const conc = fc.double({ min: 0, max: 5000, noNaN: true });
    fc.assert(
      fc.property(fc.constantFrom(...POLLUTANTS), conc, conc, (pollutant, a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        const low = naqiSubIndex(pollutant, lo);
        const high = naqiSubIndex(pollutant, hi);
        expect(low).toBeLessThanOrEqual(high);
        expect(low).toBeGreaterThanOrEqual(0);
        expect(high).toBeLessThanOrEqual(500);
      }),
    );
  });
});

describe('naqiCategory', () => {
  it.each([
    [0, 'good'],
    [50, 'good'],
    [51, 'satisfactory'],
    [100, 'satisfactory'],
    [101, 'moderate'],
    [200, 'moderate'],
    [201, 'poor'],
    [300, 'poor'],
    [301, 'very-poor'],
    [400, 'very-poor'],
    [401, 'severe'],
    [500, 'severe'],
    [600, 'severe'],
  ] as const)('index %i is %s', (index, category) => {
    expect(naqiCategory(index)).toBe(category);
  });
});

describe('naqi', () => {
  it('picks the pollutant with the highest sub-index and reports every sub-index', () => {
    const result = naqi({ ...ZERO, pm25: 45, pm10: 25, o3: 168 });
    expect(result.dominant).toBe('o3');
    expect(result.value).toBe(200);
    expect(result.category).toBe('moderate');
    expect(result.subIndices).toEqual({ pm25: 75, pm10: 25, no2: 0, o3: 200, co: 0, so2: 0 });
  });

  it('breaks a tie in favour of pm25', () => {
    const result = naqi({ ...ZERO, pm25: 30, pm10: 50, no2: 40 });
    expect(result.dominant).toBe('pm25');
    expect(result.value).toBe(50);
  });

  it('breaks a tie among later pollutants in list order', () => {
    expect(naqi({ ...ZERO, pm10: 100, so2: 80 }).dominant).toBe('pm10');
  });

  it('reports good with pm25 dominant for clean air', () => {
    expect(naqi(ZERO)).toMatchObject({ value: 0, category: 'good', dominant: 'pm25' });
  });
});

describe('usAqiPm25', () => {
  it.each([
    [0, 0],
    [9.0, 50],
    [9.1, 51],
    [12.0, 56],
    [35.4, 100],
    [35.5, 101],
    [55.4, 150],
    [55.5, 151],
    [125.4, 200],
    [125.5, 201],
    [225.4, 300],
    [225.5, 301],
    [325.4, 500],
    [400, 500],
    [-3, 0],
  ])('%f µg/m³ is AQI %i', (concentration, aqi) => {
    expect(usAqiPm25(concentration)).toBe(aqi);
  });

  it('truncates to one decimal rather than rounding', () => {
    expect(usAqiPm25(35.49)).toBe(100);
    expect(usAqiPm25(9.05)).toBe(50);
  });

  it('is monotone non-decreasing and bounded in [0, 500] (property)', () => {
    const conc = fc.double({ min: 0, max: 800, noNaN: true });
    fc.assert(
      fc.property(conc, conc, (a, b) => {
        const [lo, hi] = a <= b ? [a, b] : [b, a];
        expect(usAqiPm25(lo)).toBeLessThanOrEqual(usAqiPm25(hi));
        expect(usAqiPm25(lo)).toBeGreaterThanOrEqual(0);
        expect(usAqiPm25(hi)).toBeLessThanOrEqual(500);
      }),
    );
  });
});

describe('mean and maxRollingMean', () => {
  it('mean of an empty list is 0', () => {
    expect(mean([])).toBe(0);
  });

  it('mean averages', () => {
    expect(mean([1, 2, 6])).toBe(3);
  });

  it('returns the plain mean when the list is no longer than the window', () => {
    expect(maxRollingMean([1, 2, 3], 8)).toBe(2);
    expect(maxRollingMean([1, 2, 3], 3)).toBe(2);
  });

  it('finds the best window', () => {
    expect(maxRollingMean([1, 1, 9, 9, 1], 2)).toBe(9);
    expect(maxRollingMean([0, 0, 0, 4, 8, 0], 3)).toBe(4);
  });
});

describe('dailyLevels', () => {
  const hours = Array.from({ length: 24 }, (_, h) =>
    airHour({
      pm25: h,
      pm10: 2 * h,
      no2: 10,
      so2: 20,
      o3: h >= 10 && h < 18 ? 80 : 0,
      co: h >= 2 && h < 10 ? 4 : 0,
    }),
  );

  it('uses 24-hour means for pm25, pm10, no2 and so2', () => {
    const levels = dailyLevels(hours);
    expect(levels.pm25).toBeCloseTo(11.5);
    expect(levels.pm10).toBeCloseTo(23);
    expect(levels.no2).toBeCloseTo(10);
    expect(levels.so2).toBeCloseTo(20);
  });

  it('uses the worst 8-hour rolling mean for o3 and co', () => {
    const levels = dailyLevels(hours);
    expect(levels.o3).toBeCloseTo(80);
    expect(levels.co).toBeCloseTo(4);
  });

  it('gives zeros for no hours', () => {
    expect(dailyLevels([])).toEqual(ZERO);
  });
});
