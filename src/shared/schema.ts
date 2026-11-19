/**
 * The data contracts every boundary validates against: the household profile (browser storage and
 * request bodies), the hourly air forecast (Open-Meteo responses) and the AI answer metadata.
 * Does: define each contract once as a zod schema and derive its TypeScript type from it, so a type
 * can never drift from its runtime check. The literal-union enums here are the domain's vocabulary.
 * Never does: compute anything; the engine in src/domain imports these types only, never zod.
 */
import { z } from 'zod';
import { LIMITS } from './limits.js';

const P = LIMITS.profile;

/** Age bands with distinct breathing rates (US EPA Exposure Factors Handbook, ch. 6). */
export const AGE_BANDS = ['under5', 'child', 'teen', 'adult', 'senior'] as const;
/** Conditions that make a person more sensitive to fine particles. */
export const CONDITIONS = ['asthma', 'heart-lung', 'pregnant'] as const;
/** How air-tight the home is; sets the infiltration air-change rate. */
export const TIGHTNESS = ['leaky', 'average', 'tight'] as const;
/** Cooking fuels, cleanest first. */
export const COOKING_FUELS = ['induction', 'lpg', 'kerosene', 'biomass'] as const;
/** Room heaters, from none to solid fuel. */
export const HEATERS = ['none', 'electric', 'kerosene', 'coal-wood'] as const;
/** Air purifier sizes; each has a clean-air delivery rate in the engine. */
export const PURIFIERS = ['none', 'small', 'medium', 'large'] as const;
/** When the household usually opens its windows. */
export const WINDOW_HABITS = ['closed', 'morning', 'evening', 'mostly-open'] as const;
/** Where a trip or an outing happens; each has its own exposure ratio to outdoor air. */
export const MODES = [
  'walk',
  'cycle',
  'two-wheeler',
  'auto-rickshaw',
  'car-windows-open',
  'car-recirculation',
  'bus',
  'metro',
] as const;
/** What a regular activity is for; sets its breathing effort. */
export const ACTIVITY_KINDS = [
  'commute',
  'school-run',
  'exercise',
  'walk',
  'play',
  'errands',
  'outdoor-work',
] as const;
/** Languages the AI writes in; the engine's numbers are language-free. */
export const LANGUAGES = ['en', 'hi', 'mr', 'bn', 'ta', 'pa'] as const;

const hour = z.number().int().min(0).max(23);
const id = z.string().regex(/^[a-z0-9-]{1,24}$/u);
const label = (max: number) => z.string().trim().min(1).max(max);

const memberSchema = z.strictObject({
  id,
  name: label(P.memberNameMax),
  age: z.enum(AGE_BANDS),
  conditions: z.array(z.enum(CONDITIONS)).max(CONDITIONS.length),
  /** Hours spent indoors away from home (office, school), `from` inclusive, `to` exclusive. */
  away: z
    .strictObject({ from: hour, to: z.number().int().min(1).max(24) })
    .refine((a) => a.from < a.to)
    .nullable(),
});

const homeSchema = z.strictObject({
  areaM2: z.number().int().min(P.areaMinM2).max(P.areaMaxM2),
  tightness: z.enum(TIGHTNESS),
  cookingFuel: z.enum(COOKING_FUELS),
  heater: z.enum(HEATERS),
  heaterHours: z.number().int().min(0).max(P.heaterHoursMax),
  purifier: z.enum(PURIFIERS),
  windows: z.enum(WINDOW_HABITS),
  exhaustFan: z.boolean(),
  incense: z.boolean(),
  smokingIndoors: z.boolean(),
  burnsWaste: z.boolean(),
  /** Whether people wear a fitted N95/FFP2 mask outdoors. */
  n95Outdoors: z.boolean(),
});

const activitySchema = z
  .strictObject({
    id,
    kind: z.enum(ACTIVITY_KINDS),
    memberIds: z.array(id).min(1).max(P.membersMax),
    startHour: hour,
    durationMinutes: z.number().int().min(P.durationMinMinutes).max(P.durationMaxMinutes),
    mode: z.enum(MODES),
    /** Trip length one way, for the CO2 of a commute; 0 for outings on foot near home. */
    distanceKm: z.number().min(0).max(P.distanceMaxKm),
    daysPerWeek: z.number().int().min(1).max(P.daysPerWeekMax),
    /** When set, the engine may move the activity anywhere inside this window of the day. */
    window: z.strictObject({ earliest: hour, latest: hour }).nullable(),
  })
  .refine((a) => a.window === null || a.window.earliest <= a.window.latest, {
    path: ['window'],
  });

const placeSchema = z.strictObject({
  name: label(P.placeNameMax),
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

/** A household: place, members, home and regular activities, validated in the browser and on the server. */
export const profileSchema = z
  .strictObject({
    place: placeSchema,
    members: z.array(memberSchema).min(P.membersMin).max(P.membersMax),
    home: homeSchema,
    activities: z.array(activitySchema).max(P.activitiesMax),
    language: z.enum(LANGUAGES),
  })
  .refine((p) => new Set(p.members.map((m) => m.id)).size === p.members.length, {
    path: ['members'],
  })
  .refine(
    (p) => {
      const known = new Set(p.members.map((m) => m.id));
      return p.activities.every((a) => a.memberIds.every((m) => known.has(m)));
    },
    { path: ['activities'] },
  );

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

/** An age band; children and older adults get stricter guidance. */
export type AgeBand = (typeof AGE_BANDS)[number];
/** A health condition that makes a person more sensitive to polluted air. */
export type Condition = (typeof CONDITIONS)[number];
/** How leaky the home is, which sets how fast outdoor air gets in. */
export type Tightness = (typeof TIGHTNESS)[number];
/** The fuel the home cooks with. */
export type CookingFuel = (typeof COOKING_FUELS)[number];
/** The kind of space heater, if any. */
export type Heater = (typeof HEATERS)[number];
/** The size of air purifier, if any. */
export type Purifier = (typeof PURIFIERS)[number];
/** How the household uses its windows. */
export type WindowHabit = (typeof WINDOW_HABITS)[number];
/** How someone travels on an outing. */
export type Mode = (typeof MODES)[number];
/** What an outing is, such as a commute, a school run, a walk or play. */
export type ActivityKind = (typeof ACTIVITY_KINDS)[number];
/** A language the AI can write advice in. */
export type Language = (typeof LANGUAGES)[number];
/** One person in the household, as validated. */
export type Member = z.infer<typeof memberSchema>;
/** The home settings that change indoor air, as validated. */
export type Home = z.infer<typeof homeSchema>;
/** One regular outing, as validated. */
export type Activity = z.infer<typeof activitySchema>;
/** A named place with its coordinates. */
export type Place = z.infer<typeof placeSchema>;
/** The whole household: place, people, home, outings and advice language. */
export type Profile = z.infer<typeof profileSchema>;
/** One hour of the six pollutants, in micrograms per cubic metre. */
export type AirHour = z.infer<typeof airHourSchema>;
/** A validated 48-hour forecast. */
export type Forecast = z.infer<typeof forecastSchema>;

/** The ids the AI may cite: the plan's fact ids, never empty (every plan states `air.day`). */
export type FactIds = readonly [string, ...string[]];

const A = LIMITS.ai;
const MAX_CITES = 4;

/** One piece of AI advice and the plan facts it rests on. */
const citedSchema = (ids: FactIds) =>
  z.strictObject({
    text: z.string().trim().min(1).max(A.noteMax),
    cites: z.array(z.enum(ids)).min(1).max(MAX_CITES),
  });

const adviceShape = (ids: FactIds) =>
  z.strictObject({
    summary: z.string().trim().min(1).max(A.summaryMax),
    routine: z.array(citedSchema(ids)).max(A.notesMax),
    indoor: z.array(citedSchema(ids)).max(A.hacksMax),
    alternatives: z.array(citedSchema(ids)).max(A.alternativesMax),
  });

const askAnswerShape = (ids: FactIds) =>
  z.strictObject({
    answer: z.string().trim().min(1).max(A.answerMax),
    cites: z.array(z.enum(ids)).max(MAX_CITES),
  });

/** The advice schema for one plan, its fact-id enum built from that plan's ids. */
export type AdviceSchema = ReturnType<typeof adviceShape>;
/** The answer schema for one question, its fact-id enum built from the plan's ids. */
export type AskAnswerSchema = ReturnType<typeof askAnswerShape>;

/** The AI's advice for one plan; every item must cite at least one fact id of that plan. */
export const adviceSchemaFor = (ids: FactIds): AdviceSchema => adviceShape(ids);

/** The AI's answer to one follow-up question about a plan. */
export const askAnswerSchemaFor = (ids: FactIds): AskAnswerSchema => askAnswerShape(ids);

/** A cited item as the browser stores it (ids already checked against the plan). */
export interface CitedItem {
  readonly text: string;
  readonly cites: readonly string[];
}
/** The AI's personal advice: a summary and cited items per section. */
export interface Advice {
  readonly summary: string;
  readonly routine: readonly CitedItem[];
  readonly indoor: readonly CitedItem[];
  readonly alternatives: readonly CitedItem[];
}
/** The AI's answer to one question, with the fact ids it cites. */
export interface AskAnswer {
  readonly answer: string;
  readonly cites: readonly string[];
}

/** What the server reports about each model call, shown in the "AI at work" panel. */
export const aiMetaSchema = z.strictObject({
  model: z.string().min(1).max(80),
  latencyMs: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  /** Items in the answer that failed validation or cited unknown facts and were left out. */
  dropped: z.number().int().min(0),
  requestId: z.uuid(),
});
/** Metadata about one model call, returned with every AI answer. */
export type AiMeta = z.infer<typeof aiMetaSchema>;

/** `POST /api/plan`: the household and the forecast the browser planned with. */
export const adviceRequestSchema = z.strictObject({
  profile: profileSchema,
  forecast: forecastSchema,
  dayIndex: z.union([z.literal(0), z.literal(1)]),
});

/** `POST /api/ask`: the same, plus one question. */
export const askRequestSchema = z.strictObject({
  profile: profileSchema,
  forecast: forecastSchema,
  dayIndex: z.union([z.literal(0), z.literal(1)]),
  question: z.string().trim().min(2).max(A.questionMax),
});
