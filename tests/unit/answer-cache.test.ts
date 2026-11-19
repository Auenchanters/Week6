/**
 * The answer cache on its own: keys come from both prompt parts, and a full cache is cleared whole.
 */
import { describe, expect, it } from 'vitest';
import { createAnswerCache } from '../../server/answer-cache.js';

const prompt = (system: string, user: string) => ({ system, user });

describe('createAnswerCache', () => {
  it('returns what was stored for the same prompt, and nothing for another', () => {
    const cache = createAnswerCache(10);
    cache.set(prompt('s', 'u'), { a: 1 });
    expect(cache.get(prompt('s', 'u'))).toEqual({ a: 1 });
    expect(cache.get(prompt('s', 'v'))).toBeUndefined();
  });

  it('keeps the system and user text apart in the key', () => {
    const cache = createAnswerCache(10);
    cache.set(prompt('ab', 'c'), 'first');
    expect(cache.get(prompt('a', 'bc'))).toBeUndefined();
  });

  it('holds `max` answers, then clears them all before storing the next', () => {
    const cache = createAnswerCache(2);
    cache.set(prompt('s', '1'), 1);
    cache.set(prompt('s', '2'), 2);
    expect([cache.get(prompt('s', '1')), cache.get(prompt('s', '2'))]).toEqual([1, 2]);
    cache.set(prompt('s', '3'), 3);
    expect(cache.get(prompt('s', '1'))).toBeUndefined();
    expect(cache.get(prompt('s', '2'))).toBeUndefined();
    expect(cache.get(prompt('s', '3'))).toBe(3);
  });
});
