/**
 * Every physical coefficient the engine uses, each with the source it comes from.
 * Does: hold published central values (or the midpoint of a published range, noted as such) as
 * typed, read-only tables keyed by the schema's own enums, so a missing entry is a compile error.
 * Never does: compute anything. docs/METHODS.md lists the same sources for readers.
 * These are population averages for estimates, not measurements of any one home or person.
 */
import type {
  AgeBand,
  CookingFuel,
  Heater,
  Mode,
  Purifier,
  Tightness,
  WindowHabit,
} from '../shared/schema.js';

/** Activity intensity, which sets how much air a person breathes per hour. */
export type Effort = 'rest' | 'light' | 'moderate' | 'vigorous';

/**
 * Mean inhalation rates in m³/h by age band and effort: US EPA Exposure Factors Handbook (2011),
 * Table 6-2 (m³/min × 60, rounded to 0.01). Bands: under5 = 3–<6 y, child = 6–<11 y, teen =
 * 16–<21 y, adult = 31–<41 y, senior = 61–<71 y.
 */
export const BREATHING_M3_PER_H: Readonly<Record<AgeBand, Readonly<Record<Effort, number>>>> = {
  under5: { rest: 0.26, light: 0.66, moderate: 1.26, vigorous: 2.22 },
  child: { rest: 0.27, light: 0.66, moderate: 1.32, vigorous: 2.52 },
  teen: { rest: 0.29, light: 0.72, moderate: 1.62, vigorous: 2.94 },
  adult: { rest: 0.3, light: 0.72, moderate: 1.56, vigorous: 3.0 },
  senior: { rest: 0.29, light: 0.72, moderate: 1.5, vigorous: 2.94 },
};

/**
 * PM2.5 in each travel mode relative to the outdoor background at the same hour. Midpoints of the
 * ranges in Indian and international commuter studies: Goel et al., Atmos. Environ. 2015 (Delhi,
 * modes); Kumar et al., Sci. Total Environ. 2018 (review of in-cabin ratios); de Nazelle et al.,
 * Environ. Int. 2017 (active travel).
 */
export const MODE_EXPOSURE_RATIO: Readonly<Record<Mode, number>> = {
  walk: 1.3,
  cycle: 1.3,
  'two-wheeler': 1.4,
  'auto-rickshaw': 1.5,
  'car-windows-open': 1.1,
  'car-recirculation': 0.55,
  bus: 1.1,
  metro: 0.6,
};

/** How hard people breathe in each mode: active modes are moderate effort, riding is light. */
export const MODE_EFFORT: Readonly<Record<Mode, Effort>> = {
  walk: 'moderate',
  cycle: 'moderate',
  'two-wheeler': 'light',
  'auto-rickshaw': 'light',
  'car-windows-open': 'light',
  'car-recirculation': 'light',
  bus: 'light',
  metro: 'light',
};

/**
 * Tailpipe and grid CO2 per passenger-km, kg. UK DESNZ/DEFRA GHG conversion factors 2024
 * (average petrol car 0.164 per vehicle-km, local bus 0.102, light rail 0.029); two-wheeler and
 * CNG auto-rickshaw from ICCT India fleet estimates (0.05 and 0.06 per passenger-km).
 */
export const MODE_CO2_KG_PER_KM: Readonly<Record<Mode, number>> = {
  walk: 0,
  cycle: 0,
  'two-wheeler': 0.05,
  'auto-rickshaw': 0.06,
  'car-windows-open': 0.164,
  'car-recirculation': 0.164,
  bus: 0.102,
  metro: 0.029,
};

/** Outdoor air infiltration, air changes per hour (ASHRAE Fundamentals ch. 16, typical ranges). */
export const INFILTRATION_ACH: Readonly<Record<Tightness, number>> = {
  leaky: 1.0,
  average: 0.5,
  tight: 0.25,
};

/** Air changes per hour with windows open for cross-ventilation (midpoint of 2–8, ASHRAE). */
export const OPEN_WINDOW_ACH = 5;
/** Extra air changes per hour a kitchen exhaust fan adds while it runs (midpoint of 1–3). */
export const EXHAUST_FAN_ACH = 2;
/** Fraction of outdoor PM2.5 that survives the trip through the building shell (Chen & Zhao 2011). */
export const PENETRATION = 0.8;
/** PM2.5 deposition onto indoor surfaces, per hour (Chen & Zhao, Atmos. Environ. 2011). */
export const DEPOSITION_PER_H = 0.2;
/** Purifier power draw, watts, for its electricity CO2 (typical rated units on medium speed). */
export const PURIFIER_WATTS: Readonly<Record<Purifier, number>> = {
  none: 0,
  small: 30,
  medium: 50,
  large: 70,
};
/** India's grid emission factor, kg CO2 per kWh (CEA CO2 Baseline Database v19, 2023). */
export const GRID_KG_PER_KWH = 0.716;

/** Ceiling height used to turn floor area into volume, metres (typical Indian apartment). */
export const CEILING_M = 2.8;

/** Clean air delivery rate for smoke, m³/h, per purifier size (AHAM-rated typical units). */
export const PURIFIER_CADR_M3_PER_H: Readonly<Record<Purifier, number>> = {
  none: 0,
  small: 150,
  medium: 300,
  large: 450,
};

/**
 * PM2.5 emitted indoors, mg per hour of use. Midpoints of the ranges in: Smith et al., WHO Indoor
 * Air Quality Guidelines: Household Fuel Combustion (2014) for biomass and kerosene stoves; Abdullahi
 * et al., Atmos. Environ. 2013 for gas and electric cooking; Lee & Wang, Indoor Air 2004 for incense;
 * Klepeis et al., JAWMA 2003 for cigarettes (one per hour of smoking).
 */
/** PM2.5 emitted indoors per hour of cooking, by fuel (mg/h). */
export const COOKING_EMISSION_MG_PER_H: Readonly<Record<CookingFuel, number>> = {
  induction: 1.5,
  lpg: 4,
  kerosene: 25,
  biomass: 200,
};
/** PM2.5 emitted indoors per hour of heating, by heater (mg/h). */
export const HEATER_EMISSION_MG_PER_H: Readonly<Record<Heater, number>> = {
  none: 0,
  electric: 0,
  kerosene: 8,
  'coal-wood': 60,
};
/** PM2.5 emitted per hour of burning incense (mg/h). */
export const INCENSE_EMISSION_MG_PER_H = 20;
/** PM2.5 emitted per hour of smoking indoors, one cigarette an hour (mg/h). */
export const CIGARETTE_EMISSION_MG_PER_H = 12;

/**
 * Heating and cooking CO2, kg per hour of use. Electric uses India's grid factor of 0.716 kg/kWh
 * (CEA CO2 Baseline Database v19, 2023): a 1.5 kW heater or induction hob is 1.07 kg/h. LPG burns
 * about 0.2 kg/h at 2.98 kg CO2/kg (IPCC 2006); kerosene stoves 0.25 L/h at 2.52 kg/L; a coal
 * angithi about 0.6 kg/h at 2.4 kg CO2/kg. Biomass is counted as 30% non-renewable (Bailis et al.,
 * Nature Climate Change 2015).
 */
/** CO2 per hour of cooking, by fuel (kg/h). */
export const COOKING_CO2_KG_PER_H: Readonly<Record<CookingFuel, number>> = {
  induction: 1.07,
  lpg: 0.6,
  kerosene: 0.63,
  biomass: 0.5,
};
/** CO2 per hour of heating, by heater (kg/h). */
export const HEATER_CO2_KG_PER_H: Readonly<Record<Heater, number>> = {
  none: 0,
  electric: 1.07,
  kerosene: 0.63,
  'coal-wood': 1.44,
};

/** Hours of the day the household cooks: breakfast, lunch and dinner (one hour each). */
export const COOKING_HOURS: readonly number[] = [7, 13, 20];
/** Hours of the day incense burns (morning and evening prayers, half an hour each, as fractions). */
export const INCENSE_HOURS: Readonly<Record<number, number>> = { 6: 0.5, 19: 0.5 };
/** Heaters run in the evening and night: the last `heaterHours` hours before 23:00. */
export const HEATER_LAST_HOUR = 22;
/** Smoking spread over waking hours, one cigarette in each of these hours. */
export const SMOKING_HOURS: readonly number[] = [8, 12, 16, 20, 22];

/** Hours each window habit keeps windows open. */
export const WINDOW_HOURS: Readonly<Record<WindowHabit, readonly number[]>> = {
  closed: [],
  morning: [7, 8],
  evening: [18, 19],
  'mostly-open': [7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18],
};

/** Indoor PM2.5 in offices and schools relative to outdoors (no sources, ordinary ventilation). */
export const AWAY_INDOOR_RATIO = 0.6;

/**
 * Berkeley Earth (Muller & Muller, 2015): breathing air at 22 µg/m³ of PM2.5 for a day carries about
 * the mortality risk of smoking one cigarette. Used only to make a number relatable.
 */
export const CIGARETTE_EQUIVALENT_UG_M3 = 22;

/**
 * Real-world PM2.5 reduction from wearing a well-fitted N95/FFP2 outdoors (lab efficiency ≥ 95%,
 * fit losses bring typical use to about 70%; Cherrie et al., Occup. Environ. Med. 2018).
 */
export const N95_REDUCTION = 0.7;

/** Days in the week, for the per-week figures the impact ledger reports. */
export const DAYS_PER_WEEK = 7;

/**
 * PM2.5 from open burning of garden and household waste, grams per kg burned (Akagi et al., Atmos.
 * Chem. Phys. 2011, garbage burning 9.8 g/kg), and a typical 2 kg burned per week by a household.
 */
/** PM2.5 released per kg of waste burned in the open (g/kg). */
export const WASTE_BURNING_PM_G_PER_KG = 9.8;
/** Waste a household that burns it burns in a week (kg). */
export const WASTE_BURNED_KG_PER_WEEK = 2;
