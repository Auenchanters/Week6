/**
 * Every numeric cap in the data contracts, in one module with no imports at all.
 * Domain code may import it at runtime (see the allowlist in tests/unit/architecture.test.ts), so it
 * must never import zod or anything else. `profile` caps are enforced by the schema; `ai` bounds are
 * hints to Gemini that the server's answer reader enforces again.
 */

/** Numeric caps for the household profile, the forecast and Gemini's answers. */
export const LIMITS = {
  profile: {
    placeNameMax: 80,
    memberNameMax: 30,
    membersMin: 1,
    membersMax: 8,
    activitiesMax: 12,
    areaMinM2: 15,
    areaMaxM2: 500,
    heaterHoursMax: 16,
    durationMinMinutes: 10,
    durationMaxMinutes: 600,
    distanceMaxKm: 120,
    daysPerWeekMax: 7,
  },
  forecast: {
    /** Open-Meteo returns 48 hourly rows for `forecast_days=2`; a plan day is 24 of them. */
    hours: 48,
    dayHours: 24,
    /** Concentrations above this (µg/m³) are treated as sensor or model errors and rejected. */
    concentrationMax: 5000,
  },
  ai: {
    summaryMax: 500,
    noteMax: 280,
    notesMax: 8,
    hacksMax: 6,
    alternativesMax: 6,
    questionMax: 300,
    answerMax: 900,
  },
} as const;
