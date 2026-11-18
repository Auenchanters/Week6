/**
 * The model-answer reader: a valid answer, per-item salvage with exact `dropped` counts, cite
 * de-duplication, sanitized text, and every way an answer can be unusable (INVALID_RESPONSE).
 */
import { describe, expect, it } from 'vitest';
import { parseAdvice, parseAskAnswer } from '../../server/answer.js';
import { AppError } from '../../server/errors.js';
import { LIMITS } from '../../src/shared/limits.js';
import type { FactIds } from '../../src/shared/schema.js';

const IDS: FactIds = ['air.day', 'swap.purifier', 'person.nani'];
const item = (text: string, cites: string[] = ['air.day']) => ({ text, cites });
const advice = (patch: Record<string, unknown> = {}): string =>
  JSON.stringify({
    summary: 'Air is poor today; keep windows shut.',
    routine: [item('Walk after noon.')],
    indoor: [item('Run the purifier.', ['swap.purifier'])],
    alternatives: [item('Take the metro.', ['air.day', 'person.nani'])],
    ...patch,
  });

const unusable = { code: 'INVALID_RESPONSE', status: 502 };

describe('parseAdvice', () => {
  it('keeps a fully valid answer untouched', () => {
    expect(parseAdvice(advice(), IDS)).toEqual({
      value: {
        summary: 'Air is poor today; keep windows shut.',
        routine: [item('Walk after noon.')],
        indoor: [item('Run the purifier.', ['swap.purifier'])],
        alternatives: [item('Take the metro.', ['air.day', 'person.nani'])],
      },
      dropped: 0,
    });
  });

  it('takes a missing list as empty without counting it', () => {
    const read = parseAdvice(JSON.stringify({ summary: 'Short.' }), IDS);
    expect(read.value).toEqual({ summary: 'Short.', routine: [], indoor: [], alternatives: [] });
    expect(read.dropped).toBe(0);
  });

  it('drops each bad item on its own and counts it', () => {
    const read = parseAdvice(
      advice({
        routine: [
          item('Good one.'),
          { text: 'Cites nothing real.', cites: ['made.up'] },
          { text: 'No cites.', cites: [] },
          { text: '', cites: ['air.day'] },
          { text: 'Extra key.', cites: ['air.day'], extra: 1 },
          'a string',
          null,
        ],
      }),
      IDS,
    );
    expect(read.value.routine).toEqual([item('Good one.')]);
    expect(read.dropped).toBe(6);
    expect(read.value.indoor).toHaveLength(1);
  });

  it('drops an item with too many cites or too long a text', () => {
    const five = {
      text: 'Five cites.',
      cites: ['air.day', 'air.day', 'air.day', 'air.day', 'air.day'],
    };
    const long = item('x'.repeat(LIMITS.ai.noteMax + 1));
    const read = parseAdvice(advice({ indoor: [five, long] }), IDS);
    expect(read.value.indoor).toEqual([]);
    expect(read.dropped).toBe(2);
  });

  it('counts a list that is not a list as one dropped part and keeps the rest', () => {
    const read = parseAdvice(advice({ indoor: 'Run the purifier.', alternatives: { a: 1 } }), IDS);
    expect(read.value.indoor).toEqual([]);
    expect(read.value.alternatives).toEqual([]);
    expect(read.value.routine).toHaveLength(1);
    expect(read.dropped).toBe(2);
  });

  it('counts a bad summary as one dropped part, and keeps a usable list', () => {
    for (const summary of [42, 'x'.repeat(LIMITS.ai.summaryMax + 1), '', null]) {
      const read = parseAdvice(advice({ summary }), IDS);
      expect(read.value.summary).toBe('');
      expect(read.value.routine).toHaveLength(1);
      expect(read.dropped).toBe(1);
    }
  });

  it('does not count a missing summary as dropped', () => {
    const read = parseAdvice(JSON.stringify({ routine: [item('Walk after noon.')] }), IDS);
    expect(read.value.summary).toBe('');
    expect(read.dropped).toBe(0);
  });

  it('adds up every kind of loss', () => {
    const read = parseAdvice(
      advice({ summary: 7, routine: [item('ok'), 'bad'], indoor: 'bad', alternatives: [{}] }),
      IDS,
    );
    expect(read.dropped).toBe(1 + 1 + 1 + 1);
  });

  it('removes duplicate cites, keeping the first order', () => {
    const read = parseAdvice(
      advice({ routine: [item('Twice.', ['swap.purifier', 'air.day', 'swap.purifier'])] }),
      IDS,
    );
    expect(read.value.routine[0]?.cites).toEqual(['swap.purifier', 'air.day']);
  });

  it('strips tags and links from every string', () => {
    const read = parseAdvice(
      advice({
        summary: '<b>Stay</b> in. Read https://evil.example/x or www.evil.example',
        routine: [item('<script>alert(1)</script>Walk <img src=x onerror=1>late.')],
        indoor: [item('See javascript:alert(1) today')],
        alternatives: [item('Plain.')],
      }),
      IDS,
    );
    const all = JSON.stringify(read.value);
    expect(all).not.toMatch(/<|>|https?:\/\/|www\.|javascript:/iu);
    expect(read.value.summary).toBe('Stay in. Read evil.example/x or evil.example');
    expect(read.value.routine[0]?.text).toBe('alert(1) Walk late.');
  });

  it('removes an item that is nothing but markup once sanitized', () => {
    const read = parseAdvice(advice({ routine: [item('<b></b>'), item('Kept.')] }), IDS);
    expect(read.value.routine).toEqual([item('Kept.')]);
    expect(read.dropped).toBe(1);
  });

  it('keeps at most the documented number of items per list and counts the rest', () => {
    const many = (n: number) => Array.from({ length: n }, (_, i) => item(`Tip ${String(i)}.`));
    const read = parseAdvice(
      advice({ routine: many(10), indoor: many(7), alternatives: many(6) }),
      IDS,
    );
    expect(read.value.routine).toHaveLength(LIMITS.ai.notesMax);
    expect(read.value.indoor).toHaveLength(LIMITS.ai.hacksMax);
    expect(read.value.alternatives).toHaveLength(LIMITS.ai.alternativesMax);
    expect(read.dropped).toBe(10 - LIMITS.ai.notesMax + 7 - LIMITS.ai.hacksMax);
  });

  it.each([
    ['an empty object', '{}'],
    ['an empty summary and lists', JSON.stringify({ summary: '', routine: [], indoor: [] })],
    ['a summary of only markup', JSON.stringify({ summary: '<b></b>' })],
    ['only bad items', JSON.stringify({ routine: [{ text: 'x', cites: ['nope'] }] })],
    ['text that is not JSON', 'Sure! Here is your advice.'],
    ['an empty string', ''],
    ['a JSON array', '[]'],
    ['a JSON string', '"advice"'],
    ['JSON null', 'null'],
    ['JSON in a code fence', '```json\n{"summary":"x"}\n```'],
  ])('throws INVALID_RESPONSE for %s', (_name, text) => {
    expect(() => parseAdvice(text, IDS)).toThrow(AppError);
    expect(() => parseAdvice(text, IDS)).toThrow(expect.objectContaining(unusable));
  });

  it('throws nothing worse than an AppError for hostile prototype keys', () => {
    const text = '{"__proto__":{"summary":"x"},"constructor":1,"summary":"Fine."}';
    expect(parseAdvice(text, IDS).value.summary).toBe('Fine.');
  });
});

describe('parseAskAnswer', () => {
  const ask = (patch: Record<string, unknown> = {}): string =>
    JSON.stringify({ answer: 'Wait until the afternoon.', cites: ['air.day'], ...patch });

  it('reads a valid answer', () => {
    expect(parseAskAnswer(ask(), IDS)).toEqual({
      value: { answer: 'Wait until the afternoon.', cites: ['air.day'] },
      dropped: 0,
    });
  });

  it('allows an answer that cites nothing', () => {
    expect(parseAskAnswer(ask({ cites: [] }), IDS).value.cites).toEqual([]);
  });

  it('removes duplicate cites and sanitizes the text', () => {
    const read = parseAskAnswer(
      ask({ answer: '<i>Wait</i> and see https://evil.example', cites: ['air.day', 'air.day'] }),
      IDS,
    );
    expect(read.value.cites).toEqual(['air.day']);
    expect(read.value.answer).not.toMatch(/<|https?:\/\//u);
    expect(read.value.answer).toBe('Wait and see evil.example');
  });

  it.each([
    ['an unknown cite', ask({ cites: ['made.up'] })],
    ['too many cites', ask({ cites: ['air.day', 'air.day', 'air.day', 'air.day', 'air.day'] })],
    ['a missing answer', JSON.stringify({ cites: [] })],
    ['an empty answer', ask({ answer: '   ' })],
    ['an answer over the cap', ask({ answer: 'x'.repeat(LIMITS.ai.answerMax + 1) })],
    ['an answer of only markup', ask({ answer: '<i></i>' })],
    ['an extra key', ask({ extra: true })],
    ['non-JSON', 'The air is bad.'],
    ['a JSON array', '[{"answer":"x"}]'],
  ])('throws INVALID_RESPONSE for %s', (_name, text) => {
    expect(() => parseAskAnswer(text, IDS)).toThrow(expect.objectContaining(unusable));
  });
});
