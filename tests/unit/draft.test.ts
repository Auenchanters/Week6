/**
 * Tests for the setup form's working copy (src/features/setup/draft.ts).
 * Does: check the list helpers, id allocation, removing a person from the outings, and that
 * validation turns schema issues into one message per field with an id the form can link to.
 * Never does: render anything.
 */
import { describe, expect, it } from 'vitest';
import {
  BLANK_DRAFT,
  DEFAULT_HOME,
  draftOf,
  fieldId,
  newActivity,
  newMember,
  patchAt,
  removeAt,
  toggle,
  validate,
  withoutMember,
} from '../../src/features/setup/draft.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';

describe('list helpers', () => {
  it('patch, remove and toggle without mutating', () => {
    const list = [{ a: 1 }, { a: 2 }];
    expect(patchAt(list, 1, { a: 9 })).toEqual([{ a: 1 }, { a: 9 }]);
    expect(list[1]).toEqual({ a: 2 });
    expect(removeAt(list, 0)).toEqual([{ a: 2 }]);
    expect(toggle(['x'], 'y', true)).toEqual(['x', 'y']);
    expect(toggle(['x', 'y'], 'y', true)).toEqual(['x', 'y']);
    expect(toggle(['x', 'y'], 'y', false)).toEqual(['x']);
  });

  it('allocates fresh ids', () => {
    expect(newMember([]).id).toBe('m1');
    expect(newMember([{ ...newMember([]), id: 'm4' }]).id).toBe('m5');
    expect(newActivity(BLANK_DRAFT.members, []).memberIds).toEqual(['m1']);
    expect(newActivity(BLANK_DRAFT.members, [{ ...newActivity([], []), id: 'a2' }]).id).toBe('a3');
  });

  it('starts from the saved household, or a blank one', () => {
    expect(draftOf(SAMPLE_PROFILE)).toBe(SAMPLE_PROFILE);
    expect(draftOf(null)).toBe(BLANK_DRAFT);
    expect(BLANK_DRAFT.home).toBe(DEFAULT_HOME);
  });

  it('drops a removed person from outings, and outings left with nobody', () => {
    const draft = withoutMember(SAMPLE_PROFILE, 2);
    expect(draft.members.map((m) => m.id)).toEqual(['ravi', 'asha', 'nani']);
    expect(draft.activities.find((a) => a.id === 'school-run')?.memberIds).toEqual(['asha']);
    expect(draft.activities.some((a) => a.id === 'kabir-play')).toBe(false);
  });
});

describe('validation', () => {
  it('accepts the sample family', () => {
    expect(validate(SAMPLE_PROFILE)).toEqual({ profile: SAMPLE_PROFILE });
  });

  it('gives one message per field, with ids the form uses', () => {
    const result = validate({
      ...SAMPLE_PROFILE,
      place: null,
      members: [{ id: 'm1', name: '', age: 'adult', conditions: [], away: null }],
      home: { ...SAMPLE_PROFILE.home, areaM2: 1 },
    });
    expect('errors' in result && result.errors.map((e) => e.id)).toEqual([
      'f-place',
      'f-members-0-name',
      'f-home-areaM2',
    ]);
  });

  it('falls back to a general message for a value it has no hint for', () => {
    const crowded = {
      id: 'm1',
      name: 'A',
      age: 'adult',
      conditions: ['asthma', 'asthma', 'asthma', 'asthma'],
      away: null,
    } as const;
    const result = validate({
      ...SAMPLE_PROFILE,
      members: [{ ...crowded, conditions: [...crowded.conditions] }],
    });
    expect('errors' in result && result.errors[0]?.message).toBe('Check this value.');
  });

  it('names the first control of a group for group-level problems', () => {
    expect(fieldId(['members', 0, 'away'])).toBe('f-members-0-away-from');
    expect(fieldId(['activities', 2, 'window'])).toBe('f-activities-2-earliest');
    expect(fieldId(['place', 'latitude'])).toBe('f-place');
    expect(fieldId(['home', 'areaM2'])).toBe('f-home-areaM2');
  });
});
