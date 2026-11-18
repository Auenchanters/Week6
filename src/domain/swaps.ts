/**
 * The choices catalog: every change a household could make, each measured by running the same
 * model on the profile with that one change applied.
 * Does: list the changes that apply to this household (a cleaner commute mode per trip, a purifier
 * sized for the home, a cleaner cooking fuel or heater, shorter heater hours, an exhaust fan, N95s
 * outdoors, no incense or smoking indoors, composting instead of burning), measure each one's
 * effect on inhaled PM2.5, cigarette equivalents, weekly CO2 and street PM2.5, and rank them.
 * Never does: hide a trade-off. A change that is better for lungs but worse for CO2 (an electric
 * heater on a coal-heavy grid) is reported with both signs, never netted into one score.
 */
import type { Activity, Home, Mode, Profile, Purifier } from '../shared/schema.js';
import { PURIFIER_CADR_M3_PER_H } from './coefficients.js';
import { householdDay, weeklyFootprint } from './household.js';

export type SwapCategory = 'travel' | 'home' | 'cooking' | 'heating' | 'protection' | 'community';
export type Cost = 'free' | 'low' | 'medium' | 'high';

/** A travel change: one trip, from its current mode to a cleaner one. */
interface TripChange {
  readonly activity: Activity;
  readonly from: Mode;
  readonly to: Mode;
}

/** A candidate change: a stable id, what kind it is, and the profile with it applied. */
interface Candidate {
  readonly id: string;
  readonly category: SwapCategory;
  readonly cost: Cost;
  /** What the change is, in words. */
  readonly label: string;
  /** For a travel change: the trip and the modes it moves between. */
  readonly trip?: TripChange;
  readonly apply: (profile: Profile) => Profile;
}

/** A measured change, ready for the impact ledger. */
export interface Swap {
  readonly id: string;
  readonly category: SwapCategory;
  readonly cost: Cost;
  readonly label: string;
  readonly trip?: TripChange;
  /** Household PM2.5 not breathed in, µg per day (negative means more). */
  readonly doseSavedUg: number;
  /** Household cigarette equivalents avoided per day, summed over members. */
  readonly cigarettesSaved: number;
  /** CO2 not emitted, kg per week (negative means more CO2). */
  readonly co2SavedKg: number;
  /** PM2.5 kept out of the street, g per week. */
  readonly streetPmSavedG: number;
}

/** Trips at most this long one way can reasonably be walked or cycled. */
const ACTIVE_TRAVEL_MAX_KM = 3;
/** Trips at least this long are worth the metro. */
const METRO_MIN_KM = 3;
/** A change has to move something by at least this much to be worth listing. */
const MIN_DOSE_UG = 1;
const MIN_CO2_KG = 0.1;
/** Hours of heater use that draught-proofing and warmer layers typically cut. */
const HEATER_HOURS_CUT = 2;
/** AHAM's sizing rule in metric: m³/h of smoke CADR per m² of floor. */
const AHAM_M3_PER_H_PER_M2 = 12.2;

const withHome =
  (patch: Partial<Home>) =>
  (profile: Profile): Profile => ({
    ...profile,
    home: { ...profile.home, ...patch },
  });

const withMode =
  (id: string, mode: Mode) =>
  (profile: Profile): Profile => ({
    ...profile,
    activities: profile.activities.map((a) => (a.id === id ? { ...a, mode } : a)),
  });

/** Cleaner modes worth suggesting for one trip, by its length and current mode. */
export function modeAlternatives(trip: Activity): Mode[] {
  const options: Mode[] = [];
  if (trip.distanceKm >= METRO_MIN_KM) options.push('metro', 'bus');
  if (trip.distanceKm <= ACTIVE_TRAVEL_MAX_KM) options.push('walk', 'cycle');
  if (trip.mode === 'car-windows-open') options.push('car-recirculation');
  return options.filter((m) => m !== trip.mode);
}

/** The smallest purifier whose CADR meets AHAM's two-thirds rule for the home, else the largest. */
export function purifierFor(areaM2: number): Exclude<Purifier, 'none'> {
  // AHAM: CADR (cfm) ≥ 2/3 × floor area (ft²), which is about 12.2 m³/h per m² in metric units.
  const needed = areaM2 * AHAM_M3_PER_H_PER_M2;
  const sizes = ['small', 'medium', 'large'] as const;
  return sizes.find((s) => PURIFIER_CADR_M3_PER_H[s] >= needed) ?? 'large';
}

/** Every change that applies to `profile`. */
export function candidates(profile: Profile): Candidate[] {
  const { home } = profile;
  const list: Candidate[] = [];
  for (const trip of profile.activities.filter((a) => a.distanceKm > 0)) {
    for (const mode of modeAlternatives(trip)) {
      list.push({
        id: `travel.${trip.id}.${mode}`,
        label: `Taking ${mode} instead of ${trip.mode}`,
        category: 'travel',
        cost: 'free',
        trip: { activity: trip, from: trip.mode, to: mode },
        apply: withMode(trip.id, mode),
      });
    }
  }
  if (home.purifier === 'none') {
    const size = purifierFor(home.areaM2);
    list.push({
      id: `home.purifier.${size}`,
      label: `Running a ${size} air purifier (${String(PURIFIER_CADR_M3_PER_H[size])} m³/h CADR) all day`,
      category: 'home',
      cost: size === 'small' ? 'medium' : 'high',
      apply: withHome({ purifier: size }),
    });
  }
  const sourceCooking = home.cookingFuel !== 'induction';
  if (sourceCooking && !home.exhaustFan)
    list.push({
      id: 'home.exhaust-fan',
      label: 'Running a kitchen exhaust fan while cooking',
      category: 'home',
      cost: 'low',
      apply: withHome({ exhaustFan: true }),
    });
  if (home.cookingFuel === 'biomass' || home.cookingFuel === 'kerosene')
    list.push({
      id: 'cooking.lpg',
      label: 'Cooking on LPG instead',
      category: 'cooking',
      cost: 'medium',
      apply: withHome({ cookingFuel: 'lpg' }),
    });
  if (sourceCooking)
    list.push({
      id: 'cooking.induction',
      label: 'Cooking on induction instead',
      category: 'cooking',
      cost: 'medium',
      apply: withHome({ cookingFuel: 'induction' }),
    });
  if (home.heater === 'coal-wood' || home.heater === 'kerosene')
    list.push({
      id: 'heating.electric',
      label: 'Heating with an electric heater instead of burning fuel',
      category: 'heating',
      cost: 'medium',
      apply: withHome({ heater: 'electric' }),
    });
  if (home.heater !== 'none' && home.heaterHours > HEATER_HOURS_CUT)
    list.push({
      id: 'heating.fewer-hours',
      label: 'Running the heater 2 hours less (draught-proofing, warmer layers)',
      category: 'heating',
      cost: 'low',
      apply: withHome({ heaterHours: home.heaterHours - HEATER_HOURS_CUT }),
    });
  if (!home.n95Outdoors && profile.activities.length > 0)
    list.push({
      id: 'protection.n95',
      label: 'Wearing a fitted N95 mask outdoors',
      category: 'protection',
      cost: 'low',
      apply: withHome({ n95Outdoors: true }),
    });
  if (home.incense)
    list.push({
      id: 'home.no-incense',
      label: 'Not burning incense indoors',
      category: 'home',
      cost: 'free',
      apply: withHome({ incense: false }),
    });
  if (home.smokingIndoors)
    list.push({
      id: 'home.smoke-free',
      label: 'Keeping the home smoke-free',
      category: 'home',
      cost: 'free',
      apply: withHome({ smokingIndoors: false }),
    });
  if (home.burnsWaste)
    list.push({
      id: 'community.compost',
      label: 'Composting garden and kitchen waste instead of burning it',
      category: 'community',
      cost: 'free',
      apply: withHome({ burnsWaste: false }),
    });
  return list;
}

/** Whether a measured change improves lungs, climate or street air by enough to show. */
const helps = (s: Swap): boolean =>
  s.doseSavedUg >= MIN_DOSE_UG || s.co2SavedKg >= MIN_CO2_KG || s.streetPmSavedG > 0;

/**
 * Every applicable change measured against `profile` for the day's outdoor PM2.5, keeping only
 * those that improve at least one of lungs, climate or street air, ranked by dose saved, then CO2
 * saved, then id.
 */
export function measureSwaps(profile: Profile, outdoor: readonly number[]): Swap[] {
  const base = householdDay(profile, outdoor);
  const baseCigs = base.members.reduce((sum, m) => sum + m.cigarettes, 0);
  const baseFoot = weeklyFootprint(profile);
  return candidates(profile)
    .map(({ apply, ...candidate }): Swap => {
      const changed = apply(profile);
      const day = householdDay(changed, outdoor);
      const foot = weeklyFootprint(changed);
      return {
        ...candidate,
        doseSavedUg: base.totalDoseUg - day.totalDoseUg,
        cigarettesSaved: baseCigs - day.members.reduce((sum, m) => sum + m.cigarettes, 0),
        co2SavedKg: baseFoot.totalCo2Kg - foot.totalCo2Kg,
        streetPmSavedG: baseFoot.outdoorPmG - foot.outdoorPmG,
      };
    })
    .filter(helps)
    .sort(
      (a, b) =>
        b.doseSavedUg - a.doseSavedUg || b.co2SavedKg - a.co2SavedKg || a.id.localeCompare(b.id),
    );
}
