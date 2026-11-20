/**
 * The air contract: one place's 48-hour hourly forecast of six pollutants.
 * Does: bound every concentration and the time format, so a malformed provider answer or request
 * body fails here, before the engine sees it.
 * Never does: fetch or fill data; server/air.ts does that, then validates against this schema.
 */
import { z } from 'zod';
import { LIMITS } from './limits.js';

const concentration = z.number().min(0).max(LIMITS.forecast.concentrationMax);

/** One hour of outdoor air, µg/m³ except CO in mg/m³ (the unit Indian AQI breakpoints use). */
const airHourSchema = z.strictObject({
  /** Local wall-clock time, `YYYY-MM-DDTHH:00`, as Open-Meteo returns it with `timezone=auto`. */
  time: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:00$/u),
  pm25: concentration,
  pm10: concentration,
  no2: concentration,
  o3: concentration,
  co: concentration,
  so2: concentration,
});

/** A 48-hour hourly forecast of the six pollutants for one place, and where it came from. */
export const forecastSchema = z.strictObject({
  source: z.enum(['open-meteo', 'sample']),
  timezone: z.string().min(1).max(64),
  hours: z.array(airHourSchema).length(LIMITS.forecast.hours),
});

/** One hour of the six pollutants, in micrograms per cubic metre. */
export type AirHour = z.infer<typeof airHourSchema>;
/** A validated 48-hour forecast. */
export type Forecast = z.infer<typeof forecastSchema>;
