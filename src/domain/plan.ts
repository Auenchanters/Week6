/**
 * The day plan: everything the engine knows about one day for one household, in one value.
 * Does: pick the day's 24 hours from the 48-hour forecast; index them (NAQI per hour and for the
 * day, US AQI for PM2.5); plan the routine and the airing time; run the household model before and
 * after; measure every applicable change; attach guidance per member; and state the key results as
 * numbered facts with stable ids. Those facts are the only numbers the AI may use, and it must cite
 * their ids, so every figure a person reads traces back to this function.
 * Never does: call the AI, read the clock, or round anything except inside fact wording.
 */
import type { Activity, AirHour, Forecast, Member, Profile } from '../shared/schema.js';
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

/** A numbered result the AI may cite: a stable id and one English sentence. */
export interface Fact {
  readonly id: string;
  readonly text: string;
}

/** One household member's results. */
export interface Person {
  readonly member: Member;
  readonly before: MemberExposure;
  readonly after: MemberExposure;
  readonly actions: readonly GuidanceAction[];
}

/**
 * Everything the screen and the AI need for one day: the air, each person's exposure, the
 * re-planned routine, the measured changes and the numbered facts the AI may cite.
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
  readonly facts: readonly Fact[];
}

const whole = (n: number): string => Math.round(n).toLocaleString('en-US');
const oneDecimal = (n: number): string => n.toFixed(1);
const clock = (hour: number): string => `${String(hour).padStart(2, '0')}:00`;

/** "Asha and Ravi". */
const names = (members: readonly Member[], ids: readonly string[]): string =>
  members
    .filter((m) => ids.includes(m.id))
    .map((m) => m.name)
    .join(' and ');

/** "the commute (Asha)". */
const activityLabel = (activity: Activity, members: readonly Member[]): string =>
  `the ${activity.kind.replace('-', ' ')} (${names(members, activity.memberIds)})`;

/** "123 µg less" or "123 µg more", with the unit and noun given. */
const delta = (saved: number, unit: string, format: (n: number) => string): string =>
  `${format(Math.abs(saved))} ${unit} ${saved >= 0 ? 'less' : 'more'}`;

/** One sentence describing a measured change, its numbers and its trade-offs. */
function swapText(swap: Swap, profile: Profile): string {
  const { trip } = swap;
  const what = trip
    ? `Switching ${activityLabel(trip.activity, profile.members)} from ${trip.from} to ${trip.to}`
    : swap.label;
  const street =
    swap.streetPmSavedG > 0
      ? `; ${whole(swap.streetPmSavedG)} g less PM2.5 into the street a week`
      : '';
  return `${what}: ${delta(swap.doseSavedUg, 'µg', whole)} PM2.5 breathed by the household a day; ${delta(swap.co2SavedKg, 'kg', oneDecimal)} CO2 a week${street}. Cost: ${swap.cost}.`;
}

/** A plan before its facts are written. */
type PlanBody = Omit<DayPlan, 'facts'>;

/** The day's air: its index, its cleanest and worst hours, and the indoor average. */
function airFacts(plan: PlanBody): Fact[] {
  const { day, airing, before, worst } = plan;
  return [
    {
      id: 'air.day',
      text: `${plan.date} India AQI ${whole(day.value)} (${day.category}; an index, not µg/m³), driven by ${day.dominant}; US AQI for PM2.5 ${whole(plan.usAqi)}.`,
    },
    {
      id: 'air.cleanest',
      text: `Cleanest daytime hours: ${clock(airing.hours[0])}–${clock(airing.hours[1] + 1)}, PM2.5 about ${whole(airing.outdoorMean)} µg/m³.`,
    },
    {
      id: 'air.worst',
      text: `Worst hour: ${clock(worst.hour)}, PM2.5 about ${whole(worst.pm25)} µg/m³.`,
    },
    {
      id: 'indoor.mean',
      text: `Modelled indoor PM2.5 averages ${whole(before.indoor.mean)} µg/m³; ${whole(before.indoor.outdoorShare * 100)}% of it comes from outdoors.`,
    },
  ];
}

/** Each person's dose today, before and after the routine, and their precautions. */
function personFacts(plan: PlanBody): Fact[] {
  return plan.people.flatMap(({ member, before: now, after: planned, actions }) => {
    const conditions = member.conditions.length > 0 ? `, ${member.conditions.join(', ')}` : '';
    return [
      {
        id: `member.${member.id}`,
        text: `${member.name} (${member.age}${conditions}): breathes about ${whole(now.doseUg)} µg of PM2.5 today, like smoking ${oneDecimal(now.cigarettes)} cigarettes; ${whole(planned.doseUg)} µg with the suggested routine.`,
      },
      {
        id: `guidance.${member.id}`,
        text: `Precautions for ${member.name}: ${actions.join(', ')}.`,
      },
    ];
  });
}

/** What the household can do: moved outings, better airing hours, and each measured change. */
function actionFacts(plan: PlanBody, profile: Profile): Fact[] {
  const { airing } = plan;
  const moves = plan.moves.map((move) => ({
    id: `move.${move.activity.id}`,
    text: `Moving ${activityLabel(move.activity, profile.members)} from ${clock(move.fromHour)} to ${clock(move.toHour)} saves the household about ${whole(move.savedUg)} µg of PM2.5 today.`,
  }));
  const airingFact =
    airing.savedUg > 0
      ? [
          {
            id: 'airing',
            text: `Airing the home at ${clock(airing.hours[0])}–${clock(airing.hours[1] + 1)} instead of the usual hours saves about ${whole(airing.savedUg)} µg today.`,
          },
        ]
      : [];
  const swaps = plan.swaps.map((swap) => ({
    id: `swap.${swap.id}`,
    text: swapText(swap, profile),
  }));
  return [...moves, ...airingFact, ...swaps];
}

/** The household's weekly CO2, split by source. */
function footprintFact(plan: PlanBody): Fact {
  const { co2Kg, totalCo2Kg } = plan.footprint;
  return {
    id: 'footprint',
    text: `Household CO2 about ${oneDecimal(totalCo2Kg)} kg a week: travel ${oneDecimal(co2Kg.travel)}, cooking ${oneDecimal(co2Kg.cooking)}, heating ${oneDecimal(co2Kg.heating)}, purifier ${oneDecimal(co2Kg.purifier)}.`,
  };
}

/** The facts for a plan, in the order the AI should read them. */
function factsFor(plan: PlanBody, profile: Profile): Fact[] {
  return [
    ...airFacts(plan),
    ...personFacts(plan),
    ...actionFacts(plan, profile),
    footprintFact(plan),
  ];
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
  const plan = {
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
  return { ...plan, facts: factsFor(plan, profile) };
}
