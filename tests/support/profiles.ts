/**
 * Builders for the domain tests: small profiles, members, activities, flat air and forecasts, so a
 * test states only what it varies.
 */
import type {
  Activity,
  AirHour,
  Forecast,
  Home,
  Member,
  Profile,
} from '../../src/shared/schema.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';

/** A home with no indoor sources beyond a trace of induction cooking, windows shut, no purifier. */
export const CLEAN_HOME: Home = {
  areaM2: 60,
  tightness: 'average',
  cookingFuel: 'induction',
  heater: 'none',
  heaterHours: 0,
  purifier: 'none',
  windows: 'closed',
  exhaustFan: false,
  incense: false,
  smokingIndoors: false,
  burnsWaste: false,
  n95Outdoors: false,
};

/** An adult with no conditions who is never away. */
export const memberWith = (patch: Partial<Member> = {}): Member => ({
  id: 'm1',
  name: 'Test',
  age: 'adult',
  conditions: [],
  away: null,
  ...patch,
});

/** A one-hour walk for `m1` with no window. */
export const activityWith = (patch: Partial<Activity> = {}): Activity => ({
  id: 'a1',
  kind: 'walk',
  memberIds: ['m1'],
  startHour: 9,
  durationMinutes: 60,
  mode: 'walk',
  distanceKm: 0,
  daysPerWeek: 7,
  window: null,
  ...patch,
});

/** The sample profile with parts replaced. */
export const profileWith = (
  patch: { home?: Partial<Home>; members?: Member[]; activities?: Activity[] } = {},
): Profile => ({
  ...SAMPLE_PROFILE,
  home: { ...SAMPLE_PROFILE.home, ...patch.home },
  members: patch.members ?? SAMPLE_PROFILE.members,
  activities: patch.activities ?? SAMPLE_PROFILE.activities,
});

/** A profile of `CLEAN_HOME` with one member `m1` and the given activities. */
export const cleanProfile = (activities: Activity[] = [], home: Partial<Home> = {}): Profile =>
  profileWith({ home: { ...CLEAN_HOME, ...home }, members: [memberWith()], activities });

/** 24 hourly values, all `value`. */
export const flat = (value: number): number[] => Array.from({ length: 24 }, () => value);

/** `flat(base)` with some hours replaced. */
export const flatWith = (base: number, overrides: Readonly<Record<number, number>>): number[] =>
  flat(base).map((v, h) => overrides[h] ?? v);

/** One hour of air with every pollutant zero unless given. */
export const airHour = (patch: Partial<AirHour> = {}): AirHour => ({
  time: '2026-11-18T00:00',
  pm25: 0,
  pm10: 0,
  no2: 0,
  o3: 0,
  co: 0,
  so2: 0,
  ...patch,
});

/** A 48-hour forecast with constant PM2.5. */
export const flatForecast = (pm25: number): Forecast => ({
  source: 'sample',
  timezone: 'Asia/Kolkata',
  hours: Array.from({ length: 48 }, (_, i) =>
    airHour({
      time: `${i < 24 ? '2026-11-18' : '2026-11-19'}T${String(i % 24).padStart(2, '0')}:00`,
      pm25,
    }),
  ),
});
