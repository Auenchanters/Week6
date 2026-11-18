/**
 * Covers the guidance rule table: exact action lists for every NAQI category by member sensitivity,
 * conditions and purifier, plus `isSensitive` and `severity`.
 */
import { describe, expect, it } from 'vitest';
import { NAQI_CATEGORIES, type NaqiCategory } from '../../src/domain/aqi.js';
import { guidanceFor, isSensitive, severity } from '../../src/domain/guidance.js';
import type { Home, Member } from '../../src/shared/schema.js';
import { CLEAN_HOME, memberWith } from '../support/profiles.js';

const noPurifier: Home = CLEAN_HOME;
const purifier: Home = { ...CLEAN_HOME, purifier: 'medium' };

const adult = memberWith();
const asthmaticChild = memberWith({ age: 'child', conditions: ['asthma'] });
const pregnantAdult = memberWith({ conditions: ['pregnant'] });
const heartSenior = memberWith({ age: 'senior', conditions: ['heart-lung'] });
const plainChild = memberWith({ age: 'child' });

interface Case {
  readonly who: string;
  readonly member: Member;
  readonly home: Home;
  readonly category: NaqiCategory;
  readonly expected: readonly string[];
}

const CASES: readonly Case[] = [
  // Non-sensitive adult, no purifier: the whole ladder.
  { who: 'adult', member: adult, home: noPurifier, category: 'good', expected: ['enjoy-outdoors'] },
  {
    who: 'adult',
    member: adult,
    home: noPurifier,
    category: 'satisfactory',
    expected: ['enjoy-outdoors'],
  },
  {
    who: 'adult',
    member: adult,
    home: noPurifier,
    category: 'moderate',
    expected: ['enjoy-outdoors'],
  },
  {
    who: 'adult',
    member: adult,
    home: noPurifier,
    category: 'poor',
    expected: ['limit-outdoor-exertion', 'keep-windows-shut'],
  },
  {
    who: 'adult',
    member: adult,
    home: noPurifier,
    category: 'very-poor',
    expected: ['avoid-outdoor-exertion', 'n95-outdoors', 'keep-windows-shut'],
  },
  {
    who: 'adult',
    member: adult,
    home: noPurifier,
    category: 'severe',
    expected: ['stay-indoors', 'avoid-outdoor-exertion', 'n95-outdoors', 'keep-windows-shut'],
  },
  // Asthmatic child with a purifier: everything that can apply.
  {
    who: 'asthmatic child',
    member: asthmaticChild,
    home: purifier,
    category: 'good',
    expected: ['enjoy-outdoors'],
  },
  {
    who: 'asthmatic child',
    member: asthmaticChild,
    home: purifier,
    category: 'satisfactory',
    expected: ['enjoy-outdoors'],
  },
  {
    who: 'asthmatic child',
    member: asthmaticChild,
    home: purifier,
    category: 'moderate',
    expected: ['sensitive-take-breaks'],
  },
  {
    who: 'asthmatic child',
    member: asthmaticChild,
    home: purifier,
    category: 'poor',
    expected: [
      'avoid-outdoor-exertion',
      'n95-outdoors',
      'keep-windows-shut',
      'run-purifier',
      'keep-medicines-handy',
    ],
  },
  {
    who: 'asthmatic child',
    member: asthmaticChild,
    home: purifier,
    category: 'very-poor',
    expected: [
      'avoid-outdoor-exertion',
      'n95-outdoors',
      'keep-windows-shut',
      'run-purifier',
      'keep-medicines-handy',
      'talk-to-doctor',
    ],
  },
  {
    who: 'asthmatic child',
    member: asthmaticChild,
    home: purifier,
    category: 'severe',
    expected: [
      'stay-indoors',
      'avoid-outdoor-exertion',
      'n95-outdoors',
      'keep-windows-shut',
      'run-purifier',
      'keep-medicines-handy',
      'talk-to-doctor',
    ],
  },
  // Sensitive by age alone: stricter than an adult at "poor", no medicines or doctor.
  {
    who: 'plain child',
    member: plainChild,
    home: noPurifier,
    category: 'poor',
    expected: ['avoid-outdoor-exertion', 'n95-outdoors', 'keep-windows-shut'],
  },
  {
    who: 'plain child',
    member: plainChild,
    home: noPurifier,
    category: 'moderate',
    expected: ['sensitive-take-breaks'],
  },
  // Pregnancy: doctor advice but no inhaler.
  {
    who: 'pregnant adult',
    member: pregnantAdult,
    home: noPurifier,
    category: 'very-poor',
    expected: ['avoid-outdoor-exertion', 'n95-outdoors', 'keep-windows-shut', 'talk-to-doctor'],
  },
  {
    who: 'pregnant adult',
    member: pregnantAdult,
    home: noPurifier,
    category: 'poor',
    expected: ['avoid-outdoor-exertion', 'n95-outdoors', 'keep-windows-shut'],
  },
  // Heart and lung disease counts for medicines.
  {
    who: 'senior with heart-lung',
    member: heartSenior,
    home: noPurifier,
    category: 'poor',
    expected: [
      'avoid-outdoor-exertion',
      'n95-outdoors',
      'keep-windows-shut',
      'keep-medicines-handy',
    ],
  },
];

describe('guidanceFor', () => {
  it.each(CASES.map((c) => [c.who, c.category, c] as const))(
    '%s at %s air',
    (_who, _category, { member, home, category, expected }) => {
      expect(guidanceFor(member, home, category)).toEqual(expected);
    },
  );

  it('covers all six categories', () => {
    for (const category of NAQI_CATEGORIES)
      expect(CASES.some((c) => c.category === category)).toBe(true);
  });
});

describe('isSensitive', () => {
  it.each([
    ['under5', [], true],
    ['child', [], true],
    ['senior', [], true],
    ['teen', [], false],
    ['adult', [], false],
    ['adult', ['pregnant'], true],
    ['teen', ['asthma'], true],
    ['adult', ['heart-lung'], true],
  ] as const)('%s with %j is %s', (age, conditions, expected) => {
    expect(isSensitive(memberWith({ age, conditions: [...conditions] }))).toBe(expected);
  });
});

describe('severity', () => {
  it('runs from 0 for good to 5 for severe', () => {
    expect(NAQI_CATEGORIES.map(severity)).toEqual([0, 1, 2, 3, 4, 5]);
  });
});
