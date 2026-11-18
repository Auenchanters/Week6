/**
 * The whole-household model for one day: indoor air, then every member's exposure in it, plus the
 * household's weekly CO2 from travel, cooking, heating and purifying.
 * Does: compose the indoor model and the exposure model so every "what if" in the engine (a moved
 * walk, a new purifier, a different commute) is answered by re-running the same model on a changed
 * profile. That is what keeps the impact figures comparable: one model, two inputs, a difference.
 * Never does: cache; a full day is a few thousand arithmetic operations.
 */
import type { Profile } from '../shared/schema.js';
import {
  COOKING_CO2_KG_PER_H,
  COOKING_HOURS,
  DAYS_PER_WEEK,
  GRID_KG_PER_KWH,
  HEATER_CO2_KG_PER_H,
  MODE_CO2_KG_PER_KM,
  PURIFIER_WATTS,
  WASTE_BURNED_KG_PER_WEEK,
  WASTE_BURNING_PM_G_PER_KG,
} from './coefficients.js';
import { memberExposure, type MemberExposure } from './exposure.js';
import { homeConditions, indoorDay, type IndoorDay } from './indoor.js';

/** One day of the household model. */
export interface HouseholdDay {
  readonly indoor: IndoorDay;
  readonly members: readonly MemberExposure[];
  /** Everyone's inhaled PM2.5 added up, µg. */
  readonly totalDoseUg: number;
}

/** Runs the household model for 24 hourly outdoor PM2.5 values (µg/m³). */
export function householdDay(
  profile: Profile,
  outdoor: readonly number[],
  windowHours?: readonly number[],
): HouseholdDay {
  const conditions = homeConditions(profile.home, windowHours);
  const indoor = indoorDay(profile.home, outdoor, conditions);
  const air = { outdoor, indoor: indoor.hourly };
  const members = profile.members.map((m) =>
    memberExposure(m, profile.activities, profile.home, air),
  );
  return { indoor, members, totalDoseUg: members.reduce((sum, m) => sum + m.doseUg, 0) };
}

/** The household's weekly footprint, by where it comes from. */
export interface WeeklyFootprint {
  /** CO2 from trips, cooking, heating and the purifier's electricity, kg per week. */
  readonly co2Kg: Readonly<Record<'travel' | 'cooking' | 'heating' | 'purifier', number>>;
  readonly totalCo2Kg: number;
  /** PM2.5 put into the neighbourhood's air by open burning, g per week. */
  readonly outdoorPmG: number;
}

/** Cars are billed per vehicle; every other mode per passenger. */
const isCar = (mode: string): boolean => mode.startsWith('car-');

/** The household's weekly CO2 and the PM2.5 it adds to the street. */
export function weeklyFootprint(profile: Profile): WeeklyFootprint {
  const { home } = profile;
  const travel = profile.activities.reduce((sum, a) => {
    const riders = isCar(a.mode) ? 1 : a.memberIds.length;
    return sum + MODE_CO2_KG_PER_KM[a.mode] * a.distanceKm * riders * a.daysPerWeek;
  }, 0);
  const cooking = COOKING_CO2_KG_PER_H[home.cookingFuel] * COOKING_HOURS.length * DAYS_PER_WEEK;
  const heating = HEATER_CO2_KG_PER_H[home.heater] * home.heaterHours * DAYS_PER_WEEK;
  const purifier = (PURIFIER_WATTS[home.purifier] / 1000) * 24 * GRID_KG_PER_KWH * DAYS_PER_WEEK;
  const co2Kg = { travel, cooking, heating, purifier };
  return {
    co2Kg,
    totalCo2Kg: travel + cooking + heating + purifier,
    outdoorPmG: home.burnsWaste ? WASTE_BURNING_PM_G_PER_KG * WASTE_BURNED_KG_PER_WEEK : 0,
  };
}
