/**
 * Personal exposure: where each household member spends every part of the day, the PM2.5 they meet
 * there and how much of it they breathe in.
 * Does: lay each member's activities onto the 24 hours (an activity may cover part of an hour or
 * span several), fill the rest with time away indoors (office, school) or at home, and add up the
 * inhaled dose, Σ concentration × inhalation rate × time, plus the time-weighted mean concentration
 * and its cigarette equivalent.
 * Never does: let activities overlap past a full hour (later ones get only what is left of it),
 * carry an activity past midnight (it stops at 24:00), or claim a clinical meaning for the numbers.
 */
import type { Activity, ActivityKind, Home, Member } from '../shared/schema.js';
import {
  AWAY_INDOOR_RATIO,
  BREATHING_M3_PER_H,
  CIGARETTE_EQUIVALENT_UG_M3,
  MODE_EFFORT,
  MODE_EXPOSURE_RATIO,
  N95_REDUCTION,
  type Effort,
} from './coefficients.js';

/** Trips are where the travel mode decides the air; everything else is an outing near home. */
const TRIP_KINDS: ReadonlySet<ActivityKind> = new Set(['commute', 'school-run']);

/** How hard people breathe during each kind of outing. */
const OUTING_EFFORT: Readonly<Record<ActivityKind, Effort>> = {
  commute: 'light',
  'school-run': 'light',
  exercise: 'vigorous',
  walk: 'moderate',
  play: 'moderate',
  errands: 'light',
  'outdoor-work': 'moderate',
};

/** Exposure ratio and breathing effort for an activity. Outings meet the background air (ratio 1). */
export function activityAir(activity: Activity): { ratio: number; effort: Effort } {
  if (TRIP_KINDS.has(activity.kind))
    return { ratio: MODE_EXPOSURE_RATIO[activity.mode], effort: MODE_EFFORT[activity.mode] };
  return { ratio: 1, effort: OUTING_EFFORT[activity.kind] };
}

/** Where a slice of an hour is spent. */
export type Place =
  | { readonly kind: 'home' }
  | { readonly kind: 'away' }
  | { readonly kind: 'activity'; readonly activityId: string };

/** A slice of one hour: where it was spent, for what fraction of the hour, at what air and effort. */
export interface Slice {
  readonly place: Place;
  readonly fraction: number;
  readonly concentration: number;
  readonly effort: Effort;
}

/** One member's day of air. */
export interface MemberExposure {
  readonly memberId: string;
  /** PM2.5 breathed in over the day, µg. */
  readonly doseUg: number;
  /** Time-weighted mean PM2.5 the member was in, µg/m³. */
  readonly meanExposure: number;
  /** `meanExposure` as cigarettes smoked in a day (Berkeley Earth equivalence). */
  readonly cigarettes: number;
  /** Dose by where it was breathed, µg. */
  readonly doseBy: Readonly<Record<Place['kind'], number>>;
  /** Mean PM2.5 the member was in during each hour, µg/m³. */
  readonly hourly: readonly number[];
}

/** The air a member meets: outdoor and indoor PM2.5 for each of the 24 hours, µg/m³. */
export interface DayAir {
  readonly outdoor: readonly number[];
  readonly indoor: readonly number[];
}

/** Overlap, in hours, of `[start, end)` with hour `h`. */
const overlap = (start: number, end: number, h: number): number =>
  Math.max(0, Math.min(end, h + 1) - Math.max(start, h));

/** The slices that make up each of `member`'s 24 hours. */
export function memberSlices(
  member: Member,
  activities: readonly Activity[],
  home: Home,
  air: DayAir,
): Slice[][] {
  const own = activities.filter((a) => a.memberIds.includes(member.id));
  const masked = home.n95Outdoors ? 1 - N95_REDUCTION : 1;
  return Array.from({ length: 24 }, (_, h) => {
    const outdoor = air.outdoor[h] ?? 0;
    const slices: Slice[] = [];
    let left = 1;
    for (const activity of own) {
      const start = activity.startHour;
      const end = Math.min(24, start + activity.durationMinutes / 60);
      const fraction = Math.min(left, overlap(start, end, h));
      if (fraction <= 0) continue;
      const { ratio, effort } = activityAir(activity);
      slices.push({
        place: { kind: 'activity', activityId: activity.id },
        fraction,
        concentration: outdoor * ratio * masked,
        effort,
      });
      left -= fraction;
    }
    if (left > 0) {
      const away = member.away !== null && h >= member.away.from && h < member.away.to;
      slices.push({
        place: { kind: away ? 'away' : 'home' },
        fraction: left,
        concentration: away ? outdoor * AWAY_INDOOR_RATIO : (air.indoor[h] ?? 0),
        effort: 'rest',
      });
    }
    return slices;
  });
}

/** A member's dose, mean exposure and cigarette equivalent over the day. */
export function memberExposure(
  member: Member,
  activities: readonly Activity[],
  home: Home,
  air: DayAir,
): MemberExposure {
  const rates = BREATHING_M3_PER_H[member.age];
  const doseBy = { home: 0, away: 0, activity: 0 };
  const hourly = memberSlices(member, activities, home, air).map((slices) => {
    let weighted = 0;
    for (const slice of slices) {
      doseBy[slice.place.kind] += slice.concentration * rates[slice.effort] * slice.fraction;
      weighted += slice.concentration * slice.fraction;
    }
    return weighted;
  });
  const meanExposure = hourly.reduce((sum, c) => sum + c, 0) / 24;
  return {
    memberId: member.id,
    doseUg: doseBy.home + doseBy.away + doseBy.activity,
    meanExposure,
    cigarettes: meanExposure / CIGARETTE_EQUIVALENT_UG_M3,
    doseBy,
    hourly,
  };
}
