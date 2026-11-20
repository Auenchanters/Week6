/**
 * The day plan: everything the engine knows about one day for one household, in one value.
 * Does: pick the day's 24 hours from the 48-hour forecast; index them (NAQI per hour and for the
 * day, US AQI for PM2.5); plan the routine and the airing time; run the household model before and
 * after; measure every applicable change; and attach guidance per member. src/ai/facts.ts states
 * the key results as numbered facts with stable ids; those are the only numbers the AI may use, so
 * every figure a person reads traces back to this function.
 * Never does: write prose, call the AI, read the clock, or round anything.
 */
import type { AirHour, Forecast, Member, Profile } from '../shared/schema.js';
import { dailyLevels, naqi, usAqiPm25, type Naqi } from './aqi.js';
import { memberExposure, type MemberExposure } from './exposure.js';
import { guidanceFor, type GuidanceAction } from './guidance.js';
import {
  householdDay,
  weeklyFootprint,
  type HouseholdDay,
  type WeeklyFootprint,
} from './household.js';
import { bestAiring, planRoutine, type Airing, type Move } from './routine.js';
import { measureSwaps, type Swap } from './swaps.js';

/** Today or tomorrow, as an index into the 48-hour forecast. */
export type DayIndex = 0 | 1;

/** One household member's results. */
export interface Person {
  readonly member: Member;
  readonly before: MemberExposure;
  readonly after: MemberExposure;
  readonly actions: readonly GuidanceAction[];
}

/**
 * Everything the screen and the AI need for one day, as numbers: the air, each person's exposure,
 * the re-planned routine and the measured changes. src/ai/facts.ts words it for the model.
 */
export interface DayPlan {
  readonly dayIndex: DayIndex;
  /** The plan day's date, `YYYY-MM-DD`, in the place's own time zone. */
  readonly date: string;
  readonly source: Forecast['source'];
  readonly hours: readonly AirHour[];
  readonly hourlyNaqi: readonly Naqi[];
  readonly day: Naqi;
  readonly usAqi: number;
  /** The hour with the most outdoor PM2.5, and that level. */
  readonly worst: { readonly hour: number; readonly pm25: number };
  /** The household's day as they live it now, and after the suggested moves. */
  readonly before: HouseholdDay;
  readonly after: HouseholdDay;
  readonly moves: readonly Move[];
  readonly airing: Airing;
  readonly swaps: readonly Swap[];
  readonly footprint: WeeklyFootprint;
  /** Each member's day now and with the suggested routine, and their precautions. */
  readonly people: readonly Person[];
}

/** The hour with the most outdoor PM2.5 (the earliest on a tie); hour 0 at 0 for no hours. */
function worstOf(hours: readonly AirHour[]): { hour: number; pm25: number } {
  return hours.reduce((worst, h, hour) => (h.pm25 > worst.pm25 ? { hour, pm25: h.pm25 } : worst), {
    hour: 0,
    pm25: 0,
  });
}

/** The plan for `profile` on day `dayIndex` of `forecast`. */
export function buildDayPlan(profile: Profile, forecast: Forecast, dayIndex: DayIndex): DayPlan {
  const hours = forecast.hours.slice(dayIndex * 24, dayIndex * 24 + 24);
  const outdoor = hours.map((h) => h.pm25);
  const levels = dailyLevels(hours);
  const day = naqi(levels);
  const routine = planRoutine(profile, outdoor);
  const before = householdDay(profile, outdoor);
  const after = householdDay(routine.profile, outdoor);
  const air = (indoor: readonly number[]) => ({ outdoor, indoor });
  const people = profile.members.map((member): Person => ({
    member,
    before: memberExposure(member, profile.activities, profile.home, air(before.indoor.hourly)),
    after: memberExposure(
      member,
      routine.profile.activities,
      profile.home,
      air(after.indoor.hourly),
    ),
    actions: guidanceFor(member, profile.home, day.category),
  }));
  return {
    dayIndex,
    // An empty day (a malformed forecast) still yields a plan, with no date.
    date: hours[0]?.time.slice(0, 10) ?? '',
    source: forecast.source,
    hours,
    hourlyNaqi: hours.map((h) => naqi(h)),
    day,
    usAqi: usAqiPm25(levels.pm25),
    worst: worstOf(hours),
    before,
    after,
    moves: routine.moves,
    airing: bestAiring(routine.profile, outdoor),
    swaps: measureSwaps(routine.profile, outdoor),
    footprint: weeklyFootprint(profile),
    people,
  };
}
