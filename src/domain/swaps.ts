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

/** The part of daily life a change touches; the ledger groups changes by it. */
export type SwapCategory = 'travel' | 'home' | 'cooking' | 'heating' | 'protection' | 'community';
/** A change's rough up-front cost, as a band rather than a price that varies by city. */
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

/**
 * A change to the home or its habits: when it applies, and the patch that applies it. One row per
 * change keeps the catalog readable as data; the ranking in `measureSwaps` makes row order moot.
 */
interface HomeRule extends Omit<Candidate, 'apply' | 'trip'> {
  readonly when: (profile: Profile) => boolean;
  readonly patch: (home: Home) => Partial<Home>;
}

/** Cooking that burns something indoors (everything but induction). */
const burnsToCook = (p: Profile): boolean => p.home.cookingFuel !== 'induction';
const burnsToHeat = (p: Profile): boolean =>
  p.home.heater === 'coal-wood' || p.home.heater === 'kerosene';

const HOME_RULES: readonly HomeRule[] = [
  {
    id: 'home.exhaust-fan',
    label: 'Switch on the kitchen exhaust fan while cooking',
    category: 'home',
    cost: 'low',
    when: (p) => burnsToCook(p) && !p.home.exhaustFan,
    patch: () => ({ exhaustFan: true }),
  },
  {
    id: 'cooking.lpg',
    label: 'Cook on LPG instead',
    category: 'cooking',
    cost: 'medium',
    when: (p) => p.home.cookingFuel === 'biomass' || p.home.cookingFuel === 'kerosene',
    patch: () => ({ cookingFuel: 'lpg' }),
  },
  {
    id: 'cooking.induction',
    label: 'Cook on induction instead',
    category: 'cooking',
    cost: 'medium',
    when: burnsToCook,
    patch: () => ({ cookingFuel: 'induction' }),
  },
  {
    id: 'heating.electric',
    label: 'Heat with an electric heater instead of burning fuel',
    category: 'heating',
    cost: 'medium',
    when: burnsToHeat,
    patch: () => ({ heater: 'electric' }),
  },
  {
    id: 'heating.fewer-hours',
    label: 'Run the heater 2 hours less (draught-proof, add layers)',
    category: 'heating',
    cost: 'low',
    when: (p) => p.home.heater !== 'none' && p.home.heaterHours > HEATER_HOURS_CUT,
    patch: (home) => ({ heaterHours: home.heaterHours - HEATER_HOURS_CUT }),
  },
  {
    id: 'protection.n95',
    label: 'Wear a fitted N95 mask outdoors',
    category: 'protection',
    cost: 'low',
    when: (p) => !p.home.n95Outdoors && p.activities.length > 0,
    patch: () => ({ n95Outdoors: true }),
  },
  {
    id: 'home.no-incense',
    label: 'Skip incense indoors',
    category: 'home',
    cost: 'free',
    when: (p) => p.home.incense,
    patch: () => ({ incense: false }),
  },
  {
    id: 'home.smoke-free',
    label: 'Keep the home smoke-free',
    category: 'home',
    cost: 'free',
    when: (p) => p.home.smokingIndoors,
    patch: () => ({ smokingIndoors: false }),
  },
  {
    id: 'community.compost',
    label: 'Compost garden and kitchen waste instead of burning it',
    category: 'community',
    cost: 'free',
    when: (p) => p.home.burnsWaste,
    patch: () => ({ burnsWaste: false }),
  },
];

/** A cleaner mode for every trip that has a distance. */
const travelChanges = (profile: Profile): Candidate[] =>
  profile.activities
    .filter((trip) => trip.distanceKm > 0)
    .flatMap((trip) =>
      modeAlternatives(trip).map((mode): Candidate => ({
        id: `travel.${trip.id}.${mode}`,
        label: `Take ${mode} instead of ${trip.mode}`,
        category: 'travel',
        cost: 'free',
        trip: { activity: trip, from: trip.mode, to: mode },
        apply: withMode(trip.id, mode),
      })),
    );

/** One purifier row per size; only the size that fits a home without one applies. */
const PURIFIER_RULES: readonly HomeRule[] = (['small', 'medium', 'large'] as const).map(
  (size): HomeRule => ({
    id: `home.purifier.${size}`,
    label: `Run a ${size} air purifier (${String(PURIFIER_CADR_M3_PER_H[size])} m³/h CADR) all day`,
    category: 'home',
    cost: size === 'small' ? 'medium' : 'high',
    when: (p) => p.home.purifier === 'none' && purifierFor(p.home.areaM2) === size,
    patch: () => ({ purifier: size }),
  }),
);

/** Every change that applies to `profile`. */
export function candidates(profile: Profile): Candidate[] {
  const rules = [...PURIFIER_RULES, ...HOME_RULES];
  const homeChanges = rules
    .filter((rule) => rule.when(profile))
    .map((rule): Candidate => ({
      id: rule.id,
      label: rule.label,
      category: rule.category,
      cost: rule.cost,
      apply: withHome(rule.patch(profile.home)),
    }));
  return [...travelChanges(profile), ...homeChanges];
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
