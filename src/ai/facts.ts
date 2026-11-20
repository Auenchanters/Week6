/**
 * The plan's key results as numbered facts: the only numbers the model may use, each with a stable
 * id it must cite, so every figure a person reads traces back to the engine.
 * Does: word each result of a day plan as one English sentence, in the order the model should
 * read them (air, people, actions, footprint); round only for wording.
 * Never does: compute a number; every figure here comes from the plan as the engine built it.
 */
import type { DayPlan } from '../domain/plan.js';
import type { Swap } from '../domain/swaps.js';
import type { Activity, Member, Profile } from '../shared/schema.js';

/** A numbered result the AI may cite: a stable id and one English sentence. */
export interface Fact {
  readonly id: string;
  readonly text: string;
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

/** The day's air: its index, its cleanest and worst hours, and the indoor average. */
function airFacts(plan: DayPlan): Fact[] {
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
function personFacts(plan: DayPlan): Fact[] {
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
function actionFacts(plan: DayPlan, profile: Profile): Fact[] {
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
function footprintFact(plan: DayPlan): Fact {
  const { co2Kg, totalCo2Kg } = plan.footprint;
  return {
    id: 'footprint',
    text: `Household CO2 about ${oneDecimal(totalCo2Kg)} kg a week: travel ${oneDecimal(co2Kg.travel)}, cooking ${oneDecimal(co2Kg.cooking)}, heating ${oneDecimal(co2Kg.heating)}, purifier ${oneDecimal(co2Kg.purifier)}.`,
  };
}

/** The facts for a plan, in the order the AI should read them. */
export function factsFor(plan: DayPlan, profile: Profile): Fact[] {
  return [
    ...airFacts(plan),
    ...personFacts(plan),
    ...actionFacts(plan, profile),
    footprintFact(plan),
  ];
}
