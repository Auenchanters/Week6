/**
 * Health guidance: which precautions each household member should take at the day's air quality,
 * following the health statements that accompany India's NAQI (CPCB, 2014) and their stricter
 * advice for sensitive groups (young children, older adults, people with asthma or heart and lung
 * disease, and pregnancy).
 * Does: map (category, sensitivity, home) to an ordered list of action ids through one rule table.
 * Never does: diagnose, or give advice beyond the published statements; the wording that reaches
 * people says "estimate" and points to a doctor for symptoms.
 */
import type { Home, Member } from '../shared/schema.js';
import { NAQI_CATEGORIES, type NaqiCategory } from './aqi.js';

/** A precaution, in the order the rule table lists them. */
export type GuidanceAction =
  | 'enjoy-outdoors'
  | 'sensitive-take-breaks'
  | 'limit-outdoor-exertion'
  | 'avoid-outdoor-exertion'
  | 'stay-indoors'
  | 'n95-outdoors'
  | 'keep-windows-shut'
  | 'run-purifier'
  | 'keep-medicines-handy'
  | 'talk-to-doctor';

/** How bad a category is: 0 for good up to 5 for severe. */
export const severity = (category: NaqiCategory): number => NAQI_CATEGORIES.indexOf(category);

/** Whether a member belongs to a group the NAQI health statements single out. */
export const isSensitive = (member: Member): boolean =>
  member.age === 'under5' ||
  member.age === 'child' ||
  member.age === 'senior' ||
  member.conditions.length > 0;

interface Rule {
  readonly action: GuidanceAction;
  readonly when: (s: number, sensitive: boolean, member: Member, home: Home) => boolean;
}

/** The rule table, in the order actions are shown. `s` is the category's severity. */
const RULES: readonly Rule[] = [
  { action: 'enjoy-outdoors', when: (s, sensitive) => s <= 1 || (s === 2 && !sensitive) },
  { action: 'sensitive-take-breaks', when: (s, sensitive) => s === 2 && sensitive },
  { action: 'stay-indoors', when: (s) => s === 5 },
  { action: 'avoid-outdoor-exertion', when: (s, sensitive) => s >= 4 || (s === 3 && sensitive) },
  { action: 'limit-outdoor-exertion', when: (s, sensitive) => s === 3 && !sensitive },
  { action: 'n95-outdoors', when: (s, sensitive) => s >= 4 || (s === 3 && sensitive) },
  { action: 'keep-windows-shut', when: (s) => s >= 3 },
  {
    action: 'run-purifier',
    when: (s, _sensitive, _member, home) => s >= 3 && home.purifier !== 'none',
  },
  {
    action: 'keep-medicines-handy',
    when: (s, _sensitive, member) =>
      s >= 3 && (member.conditions.includes('asthma') || member.conditions.includes('heart-lung')),
  },
  {
    action: 'talk-to-doctor',
    when: (s, _sensitive, member) => s >= 4 && member.conditions.length > 0,
  },
];

/** The precautions for `member` on a day of `category` air. */
export function guidanceFor(member: Member, home: Home, category: NaqiCategory): GuidanceAction[] {
  const s = severity(category);
  const sensitive = isSensitive(member);
  return RULES.filter((rule) => rule.when(s, sensitive, member, home)).map((rule) => rule.action);
}
