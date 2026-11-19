/**
 * Air quality indices: India's National AQI (CPCB, 2014) over six pollutants, and the US EPA AQI
 * for PM2.5 with the breakpoints revised in February 2024.
 * Does: map a concentration to a sub-index by linear interpolation inside its breakpoint band, take
 * the worst sub-index as the AQI and name the pollutant that set it, and average an hourly series
 * the way each index expects (24-hour means, 8-hour rolling maxima for O3 and CO).
 * Never does: round concentrations it was not told to (EPA truncates PM2.5 to 0.1 µg/m³; NAQI does
 * not), or report an index above 500.
 * Convention: CPCB leaves its "Severe" band open-ended. We extend it with the width of the band
 * below it and cap the index at 500; docs/METHODS.md says so.
 */
import type { AirHour } from '../shared/schema.js';

/** The six NAQI pollutants. CO is in mg/m³; the rest in µg/m³. */
export type Pollutant = 'pm25' | 'pm10' | 'no2' | 'o3' | 'co' | 'so2';
/** All six pollutants, in the order the screen lists them. */
export const POLLUTANTS: readonly Pollutant[] = ['pm25', 'pm10', 'no2', 'o3', 'co', 'so2'];

/** The NAQI categories, mildest first; their order is the order of the index bands. */
export const NAQI_CATEGORIES = [
  'good',
  'satisfactory',
  'moderate',
  'poor',
  'very-poor',
  'severe',
] as const;
/** One of the six India NAQI categories, from good to severe. */
export type NaqiCategory = (typeof NAQI_CATEGORIES)[number];

/** Upper index value of each NAQI band and its category (each band starts where the last ended). */
const NAQI_BANDS: readonly (readonly [number, NaqiCategory])[] = [
  [50, 'good'],
  [100, 'satisfactory'],
  [200, 'moderate'],
  [300, 'poor'],
  [400, 'very-poor'],
  [500, 'severe'],
];

/**
 * `[upper concentration, upper index]` of each NAQI band, CPCB National Air Quality Index (2014),
 * Table 3. The last row is our extension of the open "Severe" band (see the module note).
 */
const NAQI_BREAKPOINTS: Readonly<Record<Pollutant, readonly (readonly [number, number])[]>> = {
  pm25: [
    [30, 50],
    [60, 100],
    [90, 200],
    [120, 300],
    [250, 400],
    [380, 500], // "Severe" is open-ended in CPCB; this cap is ours
  ],
  pm10: [
    [50, 50],
    [100, 100],
    [250, 200],
    [350, 300],
    [430, 400],
    [510, 500], // "Severe" is open-ended in CPCB; this cap is ours
  ],
  no2: [
    [40, 50],
    [80, 100],
    [180, 200],
    [280, 300],
    [400, 400],
    [520, 500], // "Severe" is open-ended in CPCB; this cap is ours
  ],
  o3: [
    [50, 50],
    [100, 100],
    [168, 200],
    [208, 300],
    [748, 400],
    [1288, 500], // "Severe" is open-ended in CPCB; this cap is ours
  ],
  co: [
    [1, 50],
    [2, 100],
    [10, 200],
    [17, 300],
    [34, 400],
    [51, 500], // "Severe" is open-ended in CPCB; this cap is ours
  ],
  so2: [
    [40, 50],
    [80, 100],
    [380, 200],
    [800, 300],
    [1600, 400],
    [2400, 500], // "Severe" is open-ended in CPCB; this cap is ours
  ],
};

/** An index value with the category it falls in. */
interface IndexValue {
  readonly value: number;
  readonly category: NaqiCategory;
}

/** The NAQI result: the worst sub-index and the pollutant that set it. */
export interface Naqi extends IndexValue {
  readonly dominant: Pollutant;
  readonly subIndices: Readonly<Record<Pollutant, number>>;
}

/** A closed range `[low, high]`. */
type Span = readonly [low: number, high: number];

/** Linear interpolation of `c` from the concentration band onto the index band. */
const interpolate = (c: number, [cLo, cHi]: Span, [iLo, iHi]: Span): number =>
  iLo + ((c - cLo) * (iHi - iLo)) / (cHi - cLo);

/** The NAQI category of an index value. */
export function naqiCategory(index: number): NaqiCategory {
  return NAQI_BANDS.find(([top]) => index <= top)?.[1] ?? 'severe';
}

/** The NAQI sub-index (0–500, whole number) for one pollutant's concentration. */
export function naqiSubIndex(pollutant: Pollutant, concentration: number): number {
  const c = Math.max(0, concentration);
  let cLo = 0;
  let iLo = 0;
  for (const [cHi, iHi] of NAQI_BREAKPOINTS[pollutant]) {
    if (c <= cHi) return Math.round(interpolate(c, [cLo, cHi], [iLo, iHi]));
    cLo = cHi;
    iLo = iHi;
  }
  return 500;
}

/** Concentrations of all six pollutants. */
export type Levels = Readonly<Record<Pollutant, number>>;

/** The NAQI for one set of concentrations: the maximum sub-index wins (PM2.5 on a tie). */
export function naqi(levels: Levels): Naqi {
  const subIndices: Record<Pollutant, number> = {
    pm25: naqiSubIndex('pm25', levels.pm25),
    pm10: naqiSubIndex('pm10', levels.pm10),
    no2: naqiSubIndex('no2', levels.no2),
    o3: naqiSubIndex('o3', levels.o3),
    co: naqiSubIndex('co', levels.co),
    so2: naqiSubIndex('so2', levels.so2),
  };
  let dominant: Pollutant = 'pm25';
  for (const pollutant of POLLUTANTS) {
    if (subIndices[pollutant] > subIndices[dominant]) dominant = pollutant;
  }
  const value = subIndices[dominant];
  return { value, category: naqiCategory(value), dominant, subIndices };
}

/** US EPA PM2.5 breakpoints (24-hour, µg/m³), effective 2024-05-06: [cLo, cHi, iLo, iHi]. */
const US_PM25_BANDS: readonly (readonly [number, number, number, number])[] = [
  [0, 9.0, 0, 50],
  [9.1, 35.4, 51, 100],
  [35.5, 55.4, 101, 150],
  [55.5, 125.4, 151, 200],
  [125.5, 225.4, 201, 300],
  [225.5, 325.4, 301, 500],
];

/**
 * The US AQI for a PM2.5 concentration: EPA truncates to one decimal, then interpolates within the
 * band (Technical Assistance Document, EPA-454/B-24-002). Above 325.4 µg/m³ the index is 500.
 */
export function usAqiPm25(concentration: number): number {
  const c = Math.floor(Math.max(0, concentration) * 10) / 10;
  const band = US_PM25_BANDS.find(([, cHi]) => c <= cHi);
  if (!band) return 500;
  const [cLo, cHi, iLo, iHi] = band;
  return Math.round(interpolate(c, [cLo, cHi], [iLo, iHi]));
}

/** The arithmetic mean; 0 for an empty list. */
export const mean = (values: readonly number[]): number =>
  values.length === 0 ? 0 : values.reduce((sum, v) => sum + v, 0) / values.length;

/** The largest mean over any `window` consecutive values (the whole list when it is shorter). */
export function maxRollingMean(values: readonly number[], window: number): number {
  if (values.length <= window) return mean(values);
  let best = -Infinity;
  for (let start = 0; start + window <= values.length; start += 1) {
    best = Math.max(best, mean(values.slice(start, start + window)));
  }
  return best;
}

/**
 * The averaging NAQI prescribes over one day of hours: 24-hour means for PM2.5, PM10, NO2 and SO2,
 * and the worst 8-hour rolling mean for O3 and CO.
 */
export function dailyLevels(hours: readonly AirHour[]): Levels {
  const series = (p: Pollutant): number[] => hours.map((h) => h[p]);
  return {
    pm25: mean(series('pm25')),
    pm10: mean(series('pm10')),
    no2: mean(series('no2')),
    so2: mean(series('so2')),
    o3: maxRollingMean(series('o3'), 8),
    co: maxRollingMean(series('co'), 8),
  };
}
