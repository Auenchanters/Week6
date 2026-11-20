/**
 * The air data client: Open-Meteo's air quality forecast and its place search, both keyless.
 * Does: ask for 48 hours of the six NAQI pollutants in the place's own time zone, convert CO from
 * µg/m³ to the mg/m³ NAQI uses, fill a missing hour from its neighbour, validate the result against
 * the forecast schema, and keep it for 30 minutes per 0.1° grid cell (the model's own resolution is
 * coarser). When Open-Meteo fails, is slow or answers in a shape it should not, it serves the
 * bundled sample forecast instead, labelled as such.
 * Never does: send anything but coordinates or the search text to Open-Meteo, or let a provider
 * message reach a response.
 */
import { z } from 'zod';
import { forecastSchema, type AirHour, type Forecast } from '../src/shared/schema.js';
import { sampleForecast } from './sample-forecast.js';

const AIR_URL = 'https://air-quality-api.open-meteo.com/v1/air-quality';
const GEO_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const TIMEOUT_MS = 8000;
const CACHE_MS = 30 * 60 * 1000;
const CACHE_MAX = 500;
const PLACES_MAX = 5;
/** India Standard Time, for the sample forecast's dates. */
const IST_OFFSET_MS = 5.5 * 60 * 60 * 1000;

/** The fetch to use; injectable so tests run offline. */
export type Fetch = (url: string, init: { signal: AbortSignal }) => Promise<Response>;

const series = z.array(z.number().nullable());
const openMeteoAir = z.object({
  timezone: z.string(),
  hourly: z.object({
    time: z.array(z.string()),
    pm2_5: series,
    pm10: series,
    nitrogen_dioxide: series,
    ozone: series,
    carbon_monoxide: series,
    sulphur_dioxide: series,
  }),
});

const openMeteoPlaces = z.object({
  results: z
    .array(
      z.object({
        name: z.string(),
        latitude: z.number(),
        longitude: z.number(),
        country: z.string().optional(),
        admin1: z.string().optional(),
      }),
    )
    .optional(),
});

/** A place a search found. */
interface PlaceMatch {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
}

/**
 * `values` with each missing hour taken from the nearest earlier hour, or the first present one;
 * `null` when every hour is missing.
 */
export function fillGaps(values: readonly (number | null)[]): number[] | null {
  const first = values.find((v) => v !== null);
  if (first === undefined) return null;
  let last = first;
  return values.map((v) => {
    if (v !== null) last = v;
    return last;
  });
}

/** One hour's six concentrations, in the order of `toForecast`'s columns. */
type Row = [number, number, number, number, number, number];

/** Every column had a value for this hour. */
const isFullRow = (row: readonly (number | undefined)[]): row is Row =>
  row.every((value) => value !== undefined);

/**
 * Hour `i` of the six columns, or nothing when a column is shorter than the time axis. A missing
 * reading is never read as 0 µg/m³: the forecast then falls short of 48 hours, fails its schema
 * and the bundled sample is used instead.
 */
function hourAt(columns: readonly (readonly number[])[], time: string, i: number): AirHour[] {
  const row = columns.map((column) => column[i]);
  if (!isFullRow(row)) return [];
  const [pm25, pm10, no2, o3, co, so2] = row;
  // Open-Meteo reports CO in µg/m³; NAQI breakpoints are in mg/m³.
  return [{ time, pm25, pm10, no2, o3, co: co / 1000, so2 }];
}

/** Open-Meteo's JSON as our forecast, or `null` when anything about it is off. */
export function toForecast(json: unknown): Forecast | null {
  const parsed = openMeteoAir.safeParse(json);
  if (!parsed.success) return null;
  const { hourly, timezone } = parsed.data;
  const columns = [
    fillGaps(hourly.pm2_5),
    fillGaps(hourly.pm10),
    fillGaps(hourly.nitrogen_dioxide),
    fillGaps(hourly.ozone),
    fillGaps(hourly.carbon_monoxide),
    fillGaps(hourly.sulphur_dioxide),
  ] as const;
  const present = columns.filter((column) => column !== null);
  // A column with no reading at all cannot be filled from its neighbours.
  if (present.length < columns.length) return null;
  const hours = hourly.time.flatMap((time, i) => hourAt(present, time, i));
  const forecast = forecastSchema.safeParse({ source: 'open-meteo', timezone, hours });
  return forecast.success ? forecast.data : null;
}

/** Today and tomorrow in India, `YYYY-MM-DD`, for the sample forecast. */
export function sampleDates(now: Date): [string, string] {
  const ist = now.getTime() + IST_OFFSET_MS;
  const day = (offset: number): string =>
    new Date(ist + offset * 86_400_000).toISOString().slice(0, 10);
  return [day(0), day(1)];
}

/** The air client: a forecast per place (cached, with the sample as fallback) and place search. */
export interface AirClient {
  forecast(latitude: number, longitude: number): Promise<Forecast>;
  places(query: string): Promise<PlaceMatch[]>;
}

/** An air client over `fetchImpl` with its own cache. */
export function createAirClient(fetchImpl: Fetch, now: () => Date = () => new Date()): AirClient {
  const cache = new Map<string, { at: number; forecast: Forecast }>();

  async function getJson(url: string): Promise<unknown> {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
    if (!response.ok) throw new Error(`status ${String(response.status)}`);
    return response.json();
  }

  return {
    async forecast(latitude, longitude) {
      const key = `${latitude.toFixed(1)},${longitude.toFixed(1)}`;
      const at = now().getTime();
      const hit = cache.get(key);
      if (hit && at - hit.at < CACHE_MS) return hit.forecast;
      const params = new URLSearchParams({
        latitude: latitude.toFixed(2),
        longitude: longitude.toFixed(2),
        hourly: 'pm2_5,pm10,nitrogen_dioxide,ozone,carbon_monoxide,sulphur_dioxide',
        forecast_days: '2',
        timezone: 'auto',
      });
      let forecast: Forecast | null = null;
      try {
        forecast = toForecast(await getJson(`${AIR_URL}?${params.toString()}`));
      } catch {
        // Unreachable, slow or failing upstream: the sample below keeps the app working.
      }
      if (!forecast) return sampleForecast(...sampleDates(now()));
      // shortcut: a full cache is dropped whole rather than evicted by age; fine at this traffic.
      if (cache.size >= CACHE_MAX) cache.clear();
      cache.set(key, { at, forecast });
      return forecast;
    },

    async places(query) {
      const params = new URLSearchParams({
        name: query,
        count: String(PLACES_MAX),
        language: 'en',
        format: 'json',
      });
      const parsed = openMeteoPlaces.safeParse(await getJson(`${GEO_URL}?${params.toString()}`));
      if (!parsed.success) return [];
      return (parsed.data.results ?? []).map((r) => ({
        name: [r.name, r.admin1, r.country].filter(Boolean).join(', ').slice(0, 80),
        latitude: r.latitude,
        longitude: r.longitude,
      }));
    },
  };
}
