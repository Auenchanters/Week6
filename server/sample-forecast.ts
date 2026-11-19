/**
 * The bundled sample forecast: two winter days of smog over Delhi, shaped like the city's typical
 * diurnal cycle (a shallow night-time boundary layer traps pollution; afternoon mixing clears it).
 * Does: serve as the fallback when Open-Meteo is unreachable, and as fixed input for tests and the
 * demo, always labelled `source: 'sample'` so nobody mistakes it for a live reading.
 * Never does: pretend to be a measurement; the values are illustrative, not from any one day.
 */
import type { AirHour, Forecast } from '../src/shared/schema.js';

/**
 * `[PM2.5, O3]` by hour of day, µg/m³: PM2.5 is high overnight with a morning traffic peak and an
 * afternoon trough; ozone's photochemistry peaks after midday.
 */
const SHAPE: readonly (readonly [number, number])[] = [
  [262, 8],
  [255, 7],
  [248, 6],
  [240, 6],
  [236, 5],
  [238, 6],
  [252, 8],
  [284, 12],
  [302, 20],
  [288, 34],
  [246, 52],
  [198, 70],
  [162, 84],
  [138, 92],
  [126, 94],
  [124, 88],
  [136, 72],
  [168, 50],
  [214, 30],
  [252, 18],
  [278, 12],
  [292, 10],
  [288, 9],
  [274, 8],
];

const round1 = (n: number): number => Math.round(n * 10) / 10;

/** One sample hour with the given PM2.5 and ozone; the other pollutants follow PM2.5. */
function sampleHour(date: string, hour: number, pm25: number, o3: number): AirHour {
  return {
    time: `${date}T${String(hour).padStart(2, '0')}:00`,
    pm25,
    pm10: round1(pm25 * 1.7),
    no2: round1(55 + pm25 * 0.2),
    o3,
    co: round1(1 + pm25 / 120),
    so2: 14,
  };
}

/** One day of sample hours, every PM2.5 value scaled by `factor` (tomorrow is a little worse, as
 * smog episodes build). */
const day = (date: string, factor: number): AirHour[] =>
  SHAPE.map(([pm25, o3], hour) => sampleHour(date, hour, round1(pm25 * factor), o3));

/** The sample forecast for a two-day window starting on `today` (`YYYY-MM-DD`). */
export function sampleForecast(today: string, tomorrow: string): Forecast {
  return {
    source: 'sample',
    timezone: 'Asia/Kolkata',
    hours: [...day(today, 1), ...day(tomorrow, 1.08)],
  };
}
