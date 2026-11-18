/**
 * The indoor PM2.5 model: a single well-mixed zone with a first-order mass balance per hour,
 *   dC/dt = (P·a + v)·C_out + S/V − (a + v + k + CADR/V)·C,
 * where a is infiltration, v open-window and exhaust ventilation, k deposition (all per hour),
 * P shell penetration, S indoor emissions and CADR the purifier's clean air delivery rate.
 * Does: solve that equation exactly within each hour (inputs are constant across an hour), run the
 * day twice so the morning starts from last night's air rather than an arbitrary guess, and split
 * the result into the part that came from outdoors and the part the home made itself (the equation
 * is linear, so the split is exact).
 * Never does: model rooms separately, humidity, or gases; PM2.5 is what drives the health estimate.
 */
import type { Home } from '../shared/schema.js';
import {
  CEILING_M,
  CIGARETTE_EMISSION_MG_PER_H,
  COOKING_EMISSION_MG_PER_H,
  COOKING_HOURS,
  DEPOSITION_PER_H,
  EXHAUST_FAN_ACH,
  HEATER_EMISSION_MG_PER_H,
  HEATER_LAST_HOUR,
  INCENSE_EMISSION_MG_PER_H,
  INCENSE_HOURS,
  INFILTRATION_ACH,
  OPEN_WINDOW_ACH,
  PENETRATION,
  PURIFIER_CADR_M3_PER_H,
  SMOKING_HOURS,
  WINDOW_HOURS,
} from './coefficients.js';
import { mean } from './aqi.js';

/** The conditions inside the home during one hour of the day. */
export interface HourConditions {
  /** Fraction of the hour the windows are open, 0–1. */
  readonly windowsOpen: number;
  /** Indoor PM2.5 emissions during the hour, mg. */
  readonly emissionsMg: number;
  /** Extra mechanical ventilation (exhaust fan), air changes per hour. */
  readonly exhaustAch: number;
}

/** The modelled indoor air over one day. */
export interface IndoorDay {
  /** Mean indoor PM2.5 in each hour, µg/m³. */
  readonly hourly: readonly number[];
  /** The part of each hour's mean that came in from outdoors. */
  readonly fromOutdoors: readonly number[];
  /** The 24-hour mean, µg/m³. */
  readonly mean: number;
  /** Share of the daily mean that came from outdoors, 0–1. */
  readonly outdoorShare: number;
  /** The conditions the model used, hour by hour, for explanations. */
  readonly conditions: readonly HourConditions[];
}

/** Hours the heater runs: the last `heaterHours` hours up to and including 22:00. */
export function heaterHourSet(heaterHours: number): ReadonlySet<number> {
  return new Set(Array.from({ length: heaterHours }, (_, i) => HEATER_LAST_HOUR - i));
}

/**
 * The conditions in each of the 24 hours for `home`. `windowHours` overrides the window habit when
 * the engine is testing a different airing time.
 */
export function homeConditions(
  home: Home,
  windowHours: readonly number[] = WINDOW_HOURS[home.windows],
): HourConditions[] {
  const heater = heaterHourSet(home.heater === 'none' ? 0 : home.heaterHours);
  return Array.from({ length: 24 }, (_, h) => {
    const cooking = COOKING_HOURS.includes(h);
    const emissionsMg =
      (cooking ? COOKING_EMISSION_MG_PER_H[home.cookingFuel] : 0) +
      (heater.has(h) ? HEATER_EMISSION_MG_PER_H[home.heater] : 0) +
      (home.incense ? (INCENSE_HOURS[h] ?? 0) * INCENSE_EMISSION_MG_PER_H : 0) +
      (home.smokingIndoors && SMOKING_HOURS.includes(h) ? CIGARETTE_EMISSION_MG_PER_H : 0);
    return {
      windowsOpen: windowHours.includes(h) ? 1 : 0,
      emissionsMg,
      exhaustAch: home.exhaustFan && cooking ? EXHAUST_FAN_ACH : 0,
    };
  });
}

/** An hour the conditions list does not cover: windows shut, no sources, no fan. */
const QUIET_HOUR: HourConditions = { windowsOpen: 0, emissionsMg: 0, exhaustAch: 0 };

/** One hour of the exact solution: the hour's mean and the concentration at its end. */
function stepHour(start: number, steady: number, loss: number): { mean: number; end: number } {
  const decay = Math.exp(-loss);
  return {
    mean: steady + ((start - steady) * (1 - decay)) / loss,
    end: steady + (start - steady) * decay,
  };
}

/**
 * Indoor PM2.5 through the day for `home` given 24 hourly outdoor PM2.5 values (µg/m³).
 * @param conditions the hour-by-hour conditions; `homeConditions(home)` unless testing a change.
 */
export function indoorDay(
  home: Home,
  outdoor: readonly number[],
  conditions: readonly HourConditions[] = homeConditions(home),
): IndoorDay {
  const volume = home.areaM2 * CEILING_M;
  const infiltration = INFILTRATION_ACH[home.tightness];
  const cleaning = PURIFIER_CADR_M3_PER_H[home.purifier] / volume;
  // Two passes over the same day: the second starts from the first one's midnight air.
  const run = (withSources: boolean): number[] => {
    let level = 0;
    let hourly: number[] = [];
    for (let pass = 0; pass < 2; pass += 1) {
      hourly = outdoor.map((out, h) => {
        const c = conditions[h] ?? QUIET_HOUR;
        const ventilation = c.windowsOpen * OPEN_WINDOW_ACH + c.exhaustAch;
        const loss = infiltration + ventilation + DEPOSITION_PER_H + cleaning;
        const source = withSources ? (c.emissionsMg * 1000) / volume : 0;
        const steady = ((PENETRATION * infiltration + ventilation) * out + source) / loss;
        const step = stepHour(level, steady, loss);
        level = step.end;
        return step.mean;
      });
    }
    return hourly;
  };
  const hourly = run(true);
  const fromOutdoors = run(false);
  const total = mean(hourly);
  return {
    hourly,
    fromOutdoors,
    mean: total,
    outdoorShare: total === 0 ? 1 : mean(fromOutdoors) / total,
    conditions,
  };
}
