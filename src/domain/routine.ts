/**
 * The routine planner: moves flexible outdoor activities to the cleanest hours they allow, and
 * finds the cleanest time to air the home.
 * Does: try every whole-hour start inside an activity's window, re-run the household model for
 * each, and keep the start with the least total inhaled PM2.5; activities are placed one after
 * another in profile order, each on top of the moves before it, so the result is deterministic.
 * Ties go to the start nearest the usual time, then the earlier one.
 * Never does: move an activity without a window, start one before `earliest` or after `latest`,
 * or report a move that saves nothing.
 */
import type { Activity, Profile } from '../shared/schema.js';
import { WINDOW_HOURS } from './coefficients.js';
import { householdDay } from './household.js';

/** A suggested new start time for one activity. */
export interface Move {
  /** The activity as the household does it now. */
  readonly activity: Activity;
  readonly fromHour: number;
  readonly toHour: number;
  /** Household inhaled PM2.5 saved by this move on top of the earlier ones, µg per day. */
  readonly savedUg: number;
}

/** The routine after every move, and the moves themselves. */
export interface RoutinePlan {
  readonly moves: readonly Move[];
  readonly profile: Profile;
}

/** Whole hours from `earliest` to `latest`, inclusive. */
const hoursBetween = (earliest: number, latest: number): number[] =>
  Array.from({ length: latest - earliest + 1 }, (_, i) => earliest + i);

/** `profile` with one activity's start changed. */
const withStart = (profile: Profile, id: string, startHour: number): Profile => ({
  ...profile,
  activities: profile.activities.map((a) => (a.id === id ? { ...a, startHour } : a)),
});

/** The best start for `activity` in `profile`, with the dose at that start. */
function bestStart(
  profile: Profile,
  activity: Activity & { window: NonNullable<Activity['window']> },
  outdoor: readonly number[],
): { hour: number; dose: number } {
  const { earliest, latest } = activity.window;
  // Compared to the nanogram so float noise never decides between equally good hours.
  const key = (dose: number): number => Math.round(dose * 1000);
  const distance = (hour: number): number => Math.abs(hour - activity.startHour);
  let best = { hour: activity.startHour, dose: Infinity };
  for (const hour of hoursBetween(earliest, latest)) {
    const dose = householdDay(withStart(profile, activity.id, hour), outdoor).totalDoseUg;
    const better =
      key(dose) < key(best.dose) ||
      (key(dose) === key(best.dose) && distance(hour) < distance(best.hour));
    if (better) best = { hour, dose };
  }
  return best;
}

/** Moves every flexible activity in `profile` to its cleanest start for the day's outdoor air. */
export function planRoutine(profile: Profile, outdoor: readonly number[]): RoutinePlan {
  let current = profile;
  const moves: Move[] = [];
  for (const activity of profile.activities) {
    if (activity.window === null) continue;
    const before = householdDay(current, outdoor).totalDoseUg;
    const best = bestStart(current, { ...activity, window: activity.window }, outdoor);
    if (best.hour === activity.startHour || best.dose >= before) continue;
    current = withStart(current, activity.id, best.hour);
    moves.push({
      activity,
      fromHour: activity.startHour,
      toHour: best.hour,
      savedUg: before - best.dose,
    });
  }
  return { moves, profile: current };
}

/** The daytime hours the engine will consider for airing the home (07:00 to 20:00 starts). */
const AIRING_EARLIEST = 7;
const AIRING_LATEST = 20;

/** The cleanest time to air the home, and what airing then instead of the usual hours saves. */
export interface Airing {
  /** The two consecutive hours to open the windows, e.g. `[14, 15]`. */
  readonly hours: readonly [number, number];
  /** Mean outdoor PM2.5 across those two hours, µg/m³. */
  readonly outdoorMean: number;
  /** Household dose saved versus the usual window habit (0 when the habit is "closed"), µg/day. */
  readonly savedUg: number;
}

/**
 * The two consecutive daytime hours with the lowest outdoor PM2.5 (the earliest on a tie), and the
 * household dose saved by airing then instead of following the usual window habit.
 */
export function bestAiring(profile: Profile, outdoor: readonly number[]): Airing {
  let best: Airing = {
    hours: [AIRING_EARLIEST, AIRING_EARLIEST + 1],
    outdoorMean: Infinity,
    savedUg: 0,
  };
  for (const h of hoursBetween(AIRING_EARLIEST, AIRING_LATEST)) {
    const pair = ((outdoor[h] ?? 0) + (outdoor[h + 1] ?? 0)) / 2;
    if (pair < best.outdoorMean) best = { hours: [h, h + 1], outdoorMean: pair, savedUg: 0 };
  }
  if (WINDOW_HOURS[profile.home.windows].length === 0) return best;
  const usual = householdDay(profile, outdoor).totalDoseUg;
  const aired = householdDay(profile, outdoor, best.hours).totalDoseUg;
  return { ...best, savedUg: Math.max(0, usual - aired) };
}
