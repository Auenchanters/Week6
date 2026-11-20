/**
 * Tests for the screen wording (src/ui/format.ts and src/ui/labels.ts).
 * Does: pin the en-IN grouping, units, hours, dates and plurals, and the plain-language wording
 * of swaps, with a fallback for an id the table does not know.
 * Never does: read the clock.
 */
import { describe, expect, it } from 'vitest';
import type { Swap } from '../../src/domain/swaps.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';
import {
  cigarettes,
  clock,
  dayLabel,
  hourSpan,
  micrograms,
  tenths,
  whole,
} from '../../src/ui/format.js';
import { swapTitle, whoIs } from '../../src/ui/labels.js';

const swap = (patch: Partial<Swap>): Swap => ({
  id: 'x',
  label: 'Engine wording',
  category: 'home',
  cost: 'free',
  doseSavedUg: 0,
  cigarettesSaved: 0,
  co2SavedKg: 0,
  streetPmSavedG: 0,
  ...patch,
});

describe('format', () => {
  it('groups numbers the Indian way', () => {
    expect(whole(1234567.4)).toBe('12,34,567');
    expect(micrograms(2970)).toBe('2,970 µg');
    expect(tenths(3)).toBe('3.0');
  });

  it('writes hours and ranges', () => {
    expect(clock(7)).toBe('07:00');
    expect(hourSpan(14, 15)).toBe('14:00–16:00');
  });

  it('pluralises cigarettes', () => {
    expect(cigarettes(1)).toBe('1.0 cigarette');
    expect(cigarettes(9.46)).toBe('9.5 cigarettes');
  });

  it('writes a plan date', () => {
    expect(dayLabel('2026-11-18')).toBe('Wed, 18 Nov');
  });
});

describe('labels', () => {
  const { members } = SAMPLE_PROFILE;

  it('names the people an outing is for', () => {
    expect(whoIs(['kabir', 'asha'], members)).toBe('Asha and Kabir');
  });

  it('describes a travel change from its trip', () => {
    const activity = SAMPLE_PROFILE.activities[2];
    if (!activity) throw new Error('sample changed');
    const trip = { activity, from: 'auto-rickshaw', to: 'metro' } as const;
    expect(swapTitle(swap({ trip }), members)).toBe(
      'Take the school run (Asha and Kabir) by metro instead of by auto-rickshaw',
    );
  });

  it("describes any other change in the engine's own words, the same the AI reads", () => {
    expect(swapTitle(swap({ id: 'home.no-incense' }), members)).toBe('Engine wording');
  });
});
