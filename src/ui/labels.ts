/**
 * Every enum, category and engine id the engine hands to the screen, as human wording.
 * Does: name each option of the profile's vocabularies, give the NAQI categories their names,
 * turn guidance action ids into friendly sentences and describe each measured change in plain words.
 * Never does: compute a number; the engine's figures are shown as they are.
 */
import type { NaqiCategory, Pollutant } from '../domain/aqi.js';
import type { GuidanceAction } from '../domain/guidance.js';
import type { Cost, Swap, SwapCategory } from '../domain/swaps.js';
import type {
  ActivityKind,
  AgeBand,
  Condition,
  CookingFuel,
  Heater,
  Member,
  Mode,
  Purifier,
  Tightness,
  WindowHabit,
} from '../shared/schema.js';

/** The words shown for each age band. */
export const AGE_LABELS: Readonly<Record<AgeBand, string>> = {
  under5: 'Under 5',
  child: 'Child (5–12)',
  teen: 'Teen (13–17)',
  adult: 'Adult',
  senior: 'Senior (65+)',
};
/** The words shown for each health condition. */
export const CONDITION_LABELS: Readonly<Record<Condition, string>> = {
  asthma: 'Asthma',
  'heart-lung': 'Heart or lung condition',
  pregnant: 'Pregnant',
};
/** The words shown for each home air-tightness. */
export const TIGHTNESS_LABELS: Readonly<Record<Tightness, string>> = {
  leaky: 'Leaky (old windows, gaps)',
  average: 'Average',
  tight: 'Tight (sealed windows)',
};
/** The words shown for each cooking fuel. */
export const FUEL_LABELS: Readonly<Record<CookingFuel, string>> = {
  induction: 'Induction or electric',
  lpg: 'LPG',
  kerosene: 'Kerosene',
  biomass: 'Wood, dung or crop waste',
};
/** The words shown for each heater. */
export const HEATER_LABELS: Readonly<Record<Heater, string>> = {
  none: 'No heater',
  electric: 'Electric heater',
  kerosene: 'Kerosene heater',
  'coal-wood': 'Coal or wood (angithi)',
};
/** The words shown for each purifier size. */
export const PURIFIER_LABELS: Readonly<Record<Purifier, string>> = {
  none: 'No purifier',
  small: 'Small (150 m³/h)',
  medium: 'Medium (300 m³/h)',
  large: 'Large (450 m³/h)',
};
/** The words shown for each window habit. */
export const WINDOW_LABELS: Readonly<Record<WindowHabit, string>> = {
  closed: 'Kept closed',
  morning: 'Opened in the morning',
  evening: 'Opened in the evening',
  'mostly-open': 'Mostly open',
};
/** How a trip is made, worded to follow a verb: "Take the commute by metro". */
export const MODE_LABELS: Readonly<Record<Mode, string>> = {
  walk: 'on foot',
  cycle: 'by bicycle',
  'two-wheeler': 'by scooter or motorbike',
  'auto-rickshaw': 'by auto-rickshaw',
  'car-windows-open': 'by car, windows open',
  'car-recirculation': 'by car, windows shut and air recirculating',
  bus: 'by bus',
  metro: 'by metro',
};
/** The words shown for each activity kind. */
export const KIND_LABELS: Readonly<Record<ActivityKind, string>> = {
  commute: 'Commute',
  'school-run': 'School run',
  exercise: 'Exercise',
  walk: 'Walk',
  play: 'Outdoor play',
  errands: 'Errands',
  'outdoor-work': 'Outdoor work',
};
/** The words shown for each pollutant. */
export const POLLUTANT_LABELS: Readonly<Record<Pollutant, string>> = {
  pm25: 'PM2.5',
  pm10: 'PM10',
  no2: 'nitrogen dioxide',
  o3: 'ozone',
  co: 'carbon monoxide',
  so2: 'sulphur dioxide',
};

/** The Indian AQI category names. */
export const CATEGORY_LABELS: Readonly<Record<NaqiCategory, string>> = {
  good: 'Good',
  satisfactory: 'Satisfactory',
  moderate: 'Moderate',
  poor: 'Poor',
  'very-poor': 'Very poor',
  severe: 'Severe',
};

/** Friendly sentences for the guidance actions, written to the person they are about. */
export const GUIDANCE_TEXT: Readonly<Record<GuidanceAction, string>> = {
  'enjoy-outdoors': 'Fine to enjoy the outdoors today.',
  'sensitive-take-breaks': 'Take breaks and go easy outdoors; watch for coughing or tiredness.',
  'limit-outdoor-exertion': 'Keep outdoor effort light and short.',
  'avoid-outdoor-exertion': 'Skip hard exercise and long stretches outdoors.',
  'stay-indoors': 'Stay indoors as much as you can today.',
  'n95-outdoors': 'If you must go out, wear a snug N95 mask.',
  'keep-windows-shut': 'Keep windows shut except when the air outside is at its cleanest.',
  'run-purifier': 'Run an air purifier in the room where you spend most time.',
  'keep-medicines-handy': 'Keep reliever medicines close at hand.',
  'talk-to-doctor': 'Talk to a doctor if breathing feels harder than usual.',
};

/** The words shown for each kind of change. */
export const SWAP_CATEGORY_LABELS: Readonly<Record<SwapCategory, string>> = {
  travel: 'Getting around',
  home: 'Home air',
  cooking: 'Cooking',
  heating: 'Heating',
  protection: 'Protection',
  community: 'Community',
};
/** The words shown for each cost level. */
export const COST_LABELS: Readonly<Record<Cost, string>> = {
  free: 'Free',
  low: 'Low cost',
  medium: 'Medium cost',
  high: 'Higher cost',
};

const SWAP_TEXT: Readonly<Record<string, string>> = {
  'home.purifier.small': 'Run a small air purifier all day',
  'home.purifier.medium': 'Run a medium air purifier all day',
  'home.purifier.large': 'Run a large air purifier all day',
  'home.exhaust-fan': 'Switch on the kitchen exhaust fan while cooking',
  'home.no-incense': 'Skip incense indoors',
  'home.smoke-free': 'Keep the home smoke-free',
  'cooking.lpg': 'Cook on LPG instead',
  'cooking.induction': 'Cook on induction instead',
  'heating.electric': 'Heat with an electric heater instead of burning fuel',
  'heating.fewer-hours': 'Run the heater 2 hours less (draught-proof, add layers)',
  'protection.n95': 'Wear a fitted N95 mask outdoors',
  'community.compost': 'Compost garden and kitchen waste instead of burning it',
};

/** "Nani" or "Kabir and Asha": who an activity is for. */
export function whoIs(memberIds: readonly string[], members: readonly Member[]): string {
  return members
    .filter((m) => memberIds.includes(m.id))
    .map((m) => m.name)
    .join(' and ');
}

/** One plain sentence saying what a measured change is (the engine's label for an id not worded here). */
export function swapTitle(swap: Swap, members: readonly Member[]): string {
  const { trip } = swap;
  if (trip) {
    const kind = KIND_LABELS[trip.activity.kind].toLowerCase();
    return `Take the ${kind} (${whoIs(trip.activity.memberIds, members)}) ${MODE_LABELS[trip.to]} instead of ${MODE_LABELS[trip.from]}`;
  }
  return SWAP_TEXT[swap.id] ?? swap.label;
}
