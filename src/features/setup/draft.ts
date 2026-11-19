/**
 * The setup form's working copy of a household, and its validation.
 * Does: hold the household as the form edits it (the place may still be missing), add and remove
 * people and activities consistently, and check the whole draft with `profileSchema`, turning each
 * schema issue into a message for a field id the form can link to.
 * Never does: show anything, or accept a draft the schema rejects.
 */
import { LIMITS } from '../../shared/limits.js';
import {
  profileSchema,
  type Activity,
  type Home,
  type Language,
  type Member,
  type Place,
  type Profile,
} from '../../shared/schema.js';

const P = LIMITS.profile;

/** A household as the form edits it. */
export interface Draft {
  readonly place: Place | null;
  readonly members: readonly Member[];
  readonly home: Home;
  readonly activities: readonly Activity[];
  readonly language: Language;
}

/** One problem found in a draft: the field's element id and what to tell the person. */
export interface FieldError {
  readonly id: string;
  readonly message: string;
}

/** A typical city flat, the starting point for a new household's home. */
export const DEFAULT_HOME: Home = {
  areaM2: 60,
  tightness: 'average',
  cookingFuel: 'lpg',
  heater: 'none',
  heaterHours: 0,
  purifier: 'none',
  windows: 'closed',
  exhaustFan: false,
  incense: false,
  smokingIndoors: false,
  burnsWaste: false,
  n95Outdoors: false,
};

/** A new person, with an id no other member has. */
export function newMember(taken: readonly Member[]): Member {
  const numbers = taken.map((m) => Number(m.id.replace(/\D/gu, '')));
  return {
    id: `m${Math.max(0, ...numbers) + 1}`,
    name: '',
    age: 'adult',
    conditions: [],
    away: null,
  };
}

/** A new outing for the first person, with an id no other activity has. */
export function newActivity(members: readonly Member[], taken: readonly Activity[]): Activity {
  const numbers = taken.map((a) => Number(a.id.replace(/\D/gu, '')));
  return {
    id: `a${Math.max(0, ...numbers) + 1}`,
    kind: 'walk',
    memberIds: members.slice(0, 1).map((m) => m.id),
    startHour: 7,
    durationMinutes: 45,
    mode: 'walk',
    distanceKm: 0,
    daysPerWeek: 7,
    window: null,
  };
}

/** The blank draft: one person, a plain home. */
export const BLANK_DRAFT: Draft = {
  place: null,
  members: [newMember([])],
  home: DEFAULT_HOME,
  activities: [],
  language: 'en',
};

/** The draft that edits an existing household. */
export const draftOf = (profile: Profile | null): Draft => profile ?? BLANK_DRAFT;

/** `list` with the item at `index` merged with `patch`. */
export const patchAt = <T extends object>(
  list: readonly T[],
  index: number,
  patch: Partial<T>,
): T[] => list.map((item, i) => (i === index ? { ...item, ...patch } : item));

/** `list` without the item at `index`. */
export const removeAt = <T>(list: readonly T[], index: number): T[] =>
  list.filter((_, i) => i !== index);

/** `list` with `item` added or taken out. */
export const toggle = <T>(list: readonly T[], item: T, on: boolean): T[] =>
  on ? [...list.filter((x) => x !== item), item] : list.filter((x) => x !== item);

/** A person taken out of the household, and out of every activity, dropping outings left empty. */
export function withoutMember(draft: Draft, index: number): Draft {
  const gone = draft.members[index]?.id;
  return {
    ...draft,
    members: removeAt(draft.members, index),
    activities: draft.activities
      .map((a) => ({ ...a, memberIds: a.memberIds.filter((id) => id !== gone) }))
      .filter((a) => a.memberIds.length > 0),
  };
}

const HINTS: Readonly<Record<string, string>> = {
  place: 'Search for your place and choose it from the list.',
  name: `Enter a name, up to ${P.memberNameMax} characters.`,
  members: `Add between ${P.membersMin} and ${P.membersMax} people, each with a different id.`,
  areaM2: `Enter the floor area between ${P.areaMinM2} and ${P.areaMaxM2} m².`,
  heaterHours: `Enter whole hours from 0 to ${P.heaterHoursMax}.`,
  activities: 'Every outing must be for people in the household.',
  memberIds: 'Pick at least one person.',
  startHour: 'Enter an hour from 0 to 23.',
  durationMinutes: `Enter whole minutes from ${P.durationMinMinutes} to ${P.durationMaxMinutes}.`,
  distanceKm: `Enter a distance from 0 to ${P.distanceMaxKm} km.`,
  daysPerWeek: `Enter whole days from 1 to ${P.daysPerWeekMax}.`,
  window: 'The earliest hour must not be after the latest, and both must be from 0 to 23.',
  away: 'Enter hours from 0 to 24, with "back" later than "away from".',
  from: 'Enter an hour from 0 to 23, earlier than the return hour.',
  to: 'Enter an hour from 1 to 24, later than the leaving hour.',
  earliest: 'Enter an hour from 0 to 23.',
  latest: 'Enter an hour from 0 to 23.',
};

/** Errors on a whole group land on its first control: its last path segment becomes that control's. */
const FIRST_CONTROL: Readonly<Record<string, string>> = { away: 'away-from', window: 'earliest' };

/** The element id for a schema path; place problems all land on the place search. */
export function fieldId(path: readonly PropertyKey[]): string {
  const parts = (path[0] === 'place' ? ['place'] : path).map(String);
  const last = parts.length - 1;
  return `f-${parts.map((p, i) => (i === last ? (FIRST_CONTROL[p] ?? p) : p)).join('-')}`;
}

/** The draft as a household, or every problem found, each once. */
export function validate(
  draft: Draft,
): { readonly profile: Profile } | { readonly errors: readonly FieldError[] } {
  const parsed = profileSchema.safeParse(draft);
  if (parsed.success) return { profile: parsed.data };
  const errors = new Map<string, FieldError>();
  for (const { path } of parsed.error.issues) {
    const id = fieldId(path);
    const last = String(path[path.length - 1]);
    errors.set(id, { id, message: HINTS[last] ?? 'Check this value.' });
  }
  return { errors: [...errors.values()] };
}
