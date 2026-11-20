/**
 * The model prompts: the system instruction is fixed and holds no user data, the user message is
 * one JSON block with sanitized text and every fact id, hostile text is neutralized, the response
 * schema's cite enums are exactly the plan's fact ids, and the labels (language, data source).
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { sampleForecast } from '../../server/sample-forecast.js';
import {
  ADVICE_INSTRUCTION,
  ASK_INSTRUCTION,
  LANGUAGE_NAMES,
  buildAdvicePrompt,
  buildAskPrompt,
  factIds,
} from '../../src/ai/prompt.js';
import { factsFor } from '../../src/ai/facts.js';
import { buildDayPlan } from '../../src/domain/plan.js';
import { LIMITS } from '../../src/shared/limits.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';
import { LANGUAGES, type Language, type Profile } from '../../src/shared/schema.js';
import { sanitizeText } from '../../src/shared/sanitize-text.js';

const corpus = z
  .array(z.object({ name: z.string(), text: z.string() }))
  .min(5)
  .parse(JSON.parse(readFileSync('tests/fixtures/injection.json', 'utf8')));

const forecast = sampleForecast('2026-11-18', '2026-11-19');
const plan = buildDayPlan(SAMPLE_PROFILE, forecast, 0);
const facts = factsFor(plan, SAMPLE_PROFILE);

const userBlock = z.strictObject({
  language: z.string(),
  place: z.string(),
  date: z.string(),
  dataSource: z.string(),
  household: z.array(
    z.strictObject({
      id: z.string(),
      name: z.string(),
      age: z.string(),
      conditions: z.array(z.string()),
    }),
  ),
  facts: z.array(z.strictObject({ id: z.string(), text: z.string() })),
  question: z.string().optional(),
});
const parseUser = (user: string) => userBlock.parse(JSON.parse(user));

/** The profile with the first member's name and the place replaced. */
const withText = (text: string): Profile => {
  const [first, ...rest] = SAMPLE_PROFILE.members;
  if (!first) throw new Error('the sample profile has members');
  return {
    ...SAMPLE_PROFILE,
    place: { ...SAMPLE_PROFILE.place, name: text },
    members: [{ ...first, name: text }, ...rest],
  };
};

/** Control characters and bidi overrides, which sanitizing must remove before JSON encoding. */
const invisible = (char: string): boolean => {
  const n = char.codePointAt(0) ?? 0;
  return (
    n < 32 ||
    n === 127 ||
    n === 0x85 ||
    (n >= 0x202a && n <= 0x202e) ||
    (n >= 0x2066 && n <= 0x2069)
  );
};

/** Every `enum` array found anywhere in a JSON Schema. */
function enumsIn(value: unknown): unknown[][] {
  if (Array.isArray(value)) return value.flatMap(enumsIn);
  if (typeof value !== 'object' || value === null) return [];
  return Object.entries(value).flatMap(([key, child]) =>
    key === 'enum' && Array.isArray(child) ? [child] : enumsIn(child),
  );
}

describe('the system instructions', () => {
  it('are the same fixed text whoever the household is', () => {
    const other = withText('Somebody Else');
    expect(buildAdvicePrompt(plan, SAMPLE_PROFILE).system).toBe(ADVICE_INSTRUCTION);
    expect(buildAdvicePrompt(plan, other).system).toBe(ADVICE_INSTRUCTION);
    expect(buildAskPrompt(plan, other, 'Is it safe?').system).toBe(ASK_INSTRUCTION);
  });

  it('hold none of the household, place, date or fact text', () => {
    const private_ = [
      ...SAMPLE_PROFILE.members.map((m) => m.name),
      SAMPLE_PROFILE.place.name,
      plan.date,
      ...facts.map((f) => f.text),
    ];
    for (const system of [ADVICE_INSTRUCTION, ASK_INSTRUCTION])
      for (const value of private_) expect(system).not.toContain(value);
  });

  it('tell the model the message is untrusted data and to cite only listed ids', () => {
    for (const system of [ADVICE_INSTRUCTION, ASK_INSTRUCTION]) {
      expect(system).toContain('UNTRUSTED DATA');
      expect(system).toContain('use only ids that appear in "facts"');
      expect(system).toContain('Never include URLs');
    }
  });
});

describe('the user message', () => {
  const prompt = buildAdvicePrompt(plan, SAMPLE_PROFILE);

  it('is one JSON object with the household, place, date and every fact', () => {
    const block = parseUser(prompt.user);
    expect(block.place).toBe('New Delhi, India');
    expect(block.date).toBe(plan.date);
    expect(block.household).toEqual(
      SAMPLE_PROFILE.members.map((m) => ({
        id: m.id,
        name: m.name,
        age: m.age,
        conditions: m.conditions,
      })),
    );
    expect(block.facts.map((f) => f.id)).toEqual(facts.map((f) => f.id));
    for (const id of factIds(facts)) expect(prompt.user).toContain(`"id":"${id}"`);
    expect(block.question).toBeUndefined();
  });

  it('carries the question as data, sanitized and capped, only for an ask', () => {
    const asked = buildAskPrompt(plan, SAMPLE_PROFILE, `<b>Is it safe?</b> ${'?'.repeat(400)}`);
    const block = parseUser(asked.user);
    expect(block.question?.startsWith('Is it safe?')).toBe(true);
    expect(block.question).not.toContain('<');
    expect(Array.from(block.question ?? '').length).toBeLessThanOrEqual(300);
    expect(asked.user).toContain('"language":"English"');
  });

  it('is deterministic', () => {
    expect(buildAdvicePrompt(plan, SAMPLE_PROFILE)).toEqual(prompt);
  });

  it('sanitizes names and place', () => {
    const block = parseUser(buildAdvicePrompt(plan, withText('<b>Ravi</b> https://x.test')).user);
    expect(block.household[0]?.name).toBe('Ravi x.test');
    expect(block.place).toBe('Ravi x.test');
  });

  it('caps a name at 30 characters and a place at 80', () => {
    const block = parseUser(buildAdvicePrompt(plan, withText('n'.repeat(200))).user);
    expect(block.household[0]?.name).toHaveLength(30);
    expect(block.place).toHaveLength(80);
  });
});

describe('hostile text', () => {
  it.each(corpus)(
    '$name: never reaches the system text, and is neutralized in the data',
    ({ text }) => {
      const profile = withText(text);
      for (const prompt of [
        buildAdvicePrompt(plan, profile),
        buildAskPrompt(plan, profile, text),
      ]) {
        expect(prompt.system).not.toContain(text);
        expect(prompt.system === ADVICE_INSTRUCTION || prompt.system === ASK_INSTRUCTION).toBe(
          true,
        );
        expect(prompt.user).not.toMatch(/<script|<img|<\/?system|https?:\/\/|www\.|javascript:/iu);
        expect(Array.from(prompt.user).filter(invisible)).toEqual([]);
        // The text stays inside its own JSON strings: no new keys, no new members.
        const block = parseUser(prompt.user);
        expect(block.household).toHaveLength(SAMPLE_PROFILE.members.length);
        expect(block.household[0]?.name).toBe(sanitizeText(text, 30));
        expect(block.place).toBe(sanitizeText(text, 80));
      }
    },
  );
});

describe('factIds', () => {
  it('puts air.day first and lists each plan fact once', () => {
    const ids = factIds(facts);
    expect(ids[0]).toBe('air.day');
    expect(ids).toHaveLength(facts.length);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('moves air.day to the front when the facts list it later', () => {
    const reordered = [...facts].reverse();
    expect(factIds(reordered)[0]).toBe('air.day');
    expect([...factIds(reordered)].sort()).toEqual([...factIds(facts)].sort());
  });
});

describe('the response schema', () => {
  it('is shape-only, so Gemini accepts it: no enums and no length or count caps', () => {
    for (const schema of [
      buildAdvicePrompt(plan, SAMPLE_PROFILE).schema,
      buildAskPrompt(plan, SAMPLE_PROFILE, 'Is it safe?').schema,
    ]) {
      expect(enumsIn(schema)).toEqual([]);
      expect(JSON.stringify(schema)).not.toMatch(/maxLength|minLength|maxItems|minItems/u);
    }
  });

  it('states the caps the server enforces in the instructions instead', () => {
    expect(ADVICE_INSTRUCTION).toContain(String(LIMITS.ai.noteMax));
    expect(ADVICE_INSTRUCTION).toContain(String(LIMITS.ai.notesMax));
    expect(ASK_INSTRUCTION).toContain(String(LIMITS.ai.answerMax));
  });

  it('asks for the advice sections and the answer', () => {
    const advice = z
      .object({
        properties: z.record(z.string(), z.unknown()),
        additionalProperties: z.literal(false),
      })
      .parse(buildAdvicePrompt(plan, SAMPLE_PROFILE).schema);
    expect(Object.keys(advice.properties)).toEqual([
      'summary',
      'routine',
      'indoor',
      'alternatives',
    ]);
    const answer = z
      .object({ properties: z.record(z.string(), z.unknown()) })
      .parse(buildAskPrompt(plan, SAMPLE_PROFILE, 'Is it safe?').schema);
    expect(Object.keys(answer.properties)).toEqual(['answer', 'cites']);
  });
});

describe('labels', () => {
  it.each(LANGUAGES)('names the language %s for the model', (code: Language) => {
    const profile = { ...SAMPLE_PROFILE, language: code };
    const block = parseUser(buildAdvicePrompt(plan, profile).user);
    expect(block.language).toBe(LANGUAGE_NAMES[code]);
  });

  it('spells out the six languages', () => {
    expect(LANGUAGE_NAMES.en).toBe('English');
    expect(LANGUAGE_NAMES.hi).toContain('Hindi');
    expect(Object.keys(LANGUAGE_NAMES)).toEqual([...LANGUAGES]);
  });

  it('says whether the data is the sample or a live forecast', () => {
    const sample = parseUser(buildAdvicePrompt(plan, SAMPLE_PROFILE).user);
    expect(sample.dataSource).toBe('illustrative sample data');
    const live = buildDayPlan(SAMPLE_PROFILE, { ...forecast, source: 'open-meteo' }, 0);
    expect(parseUser(buildAdvicePrompt(live, SAMPLE_PROFILE).user).dataSource).toBe(
      'live forecast',
    );
  });
});
