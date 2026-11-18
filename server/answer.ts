/**
 * The reader for the model's answers; the prompts are built in src/ai/prompt.ts.
 * Does: parse the response as JSON, then each section on its own and each item within a list on
 * its own, against the plan's schema (so a cite outside the plan's fact ids fails that item);
 * keep everything valid, count what was left out, and sanitize every string. One bad item costs
 * that item, not the paid answer.
 * Never does: repair or retry a bad answer (one call per request), or keep an answer with nothing
 * usable in it.
 */
import { z } from 'zod';
import { LIMITS } from '../src/shared/limits.js';
import { sanitizeText } from '../src/shared/sanitize-text.js';
import {
  adviceSchemaFor,
  askAnswerSchemaFor,
  type Advice,
  type AskAnswer,
  type CitedItem,
  type FactIds,
} from '../src/shared/schema.js';
import { AppError } from './errors.js';

/** An answer as read: what was kept, and how many items were left out. */
export interface Read<T> {
  readonly value: T;
  readonly dropped: number;
}

const anyList = z.array(z.unknown());
const anyObject = z.record(z.string(), z.unknown());

/** The model's text as a JSON object, or `INVALID_RESPONSE`. */
function jsonObject(text: string): Record<string, unknown> {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new AppError('INVALID_RESPONSE');
  }
  const object = anyObject.safeParse(raw);
  if (!object.success) throw new AppError('INVALID_RESPONSE');
  return object.data;
}

/** The items of `value` that pass `item`, and how many did not. A missing list is an empty one. */
function salvage<T>(value: unknown, item: z.ZodType<T>): { kept: T[]; dropped: number } {
  if (value === undefined) return { kept: [], dropped: 0 };
  const list = anyList.safeParse(value);
  if (!list.success) return { kept: [], dropped: 1 };
  const kept = list.data.flatMap((entry) => {
    const parsed = item.safeParse(entry);
    return parsed.success ? [parsed.data] : [];
  });
  return { kept, dropped: list.data.length - kept.length };
}

/**
 * Sanitized items with duplicate cites removed, at most `max` of them; items that sanitize to
 * nothing and items past the cap count as dropped.
 */
function cleanItems(
  salvaged: { kept: readonly CitedItem[]; dropped: number },
  max: number,
): { items: CitedItem[]; dropped: number } {
  const items = salvaged.kept
    .map((i) => ({ text: sanitizeText(i.text, LIMITS.ai.noteMax), cites: [...new Set(i.cites)] }))
    .filter((i) => i.text !== '');
  const kept = items.slice(0, max);
  return { items: kept, dropped: salvaged.dropped + salvaged.kept.length - kept.length };
}

/**
 * Reads the advice for a plan whose fact ids are `ids`.
 * @throws AppError `INVALID_RESPONSE` when the text is not a JSON object or nothing usable is left.
 */
export function parseAdvice(text: string, ids: FactIds): Read<Advice> {
  const raw = jsonObject(text);
  const { shape } = adviceSchemaFor(ids);
  const summary = shape.summary.safeParse(raw['summary']);
  const routine = salvage(raw['routine'], shape.routine.element);
  const indoor = salvage(raw['indoor'], shape.indoor.element);
  const alternatives = salvage(raw['alternatives'], shape.alternatives.element);
  const lists = {
    routine: cleanItems(routine, LIMITS.ai.notesMax),
    indoor: cleanItems(indoor, LIMITS.ai.hacksMax),
    alternatives: cleanItems(alternatives, LIMITS.ai.alternativesMax),
  };
  const value: Advice = {
    summary: summary.success ? sanitizeText(summary.data, LIMITS.ai.summaryMax) : '',
    routine: lists.routine.items,
    indoor: lists.indoor.items,
    alternatives: lists.alternatives.items,
  };
  const count = value.routine.length + value.indoor.length + value.alternatives.length;
  if (value.summary === '' && count === 0) throw new AppError('INVALID_RESPONSE');
  const badSummary = summary.success || raw['summary'] === undefined ? 0 : 1;
  return {
    value,
    dropped: badSummary + lists.routine.dropped + lists.indoor.dropped + lists.alternatives.dropped,
  };
}

/**
 * Reads the answer to a question about a plan whose fact ids are `ids`.
 * @throws AppError `INVALID_RESPONSE` when the answer is missing, empty or cites unknown facts.
 */
export function parseAskAnswer(text: string, ids: FactIds): Read<AskAnswer> {
  const parsed = askAnswerSchemaFor(ids).safeParse(jsonObject(text));
  if (!parsed.success) throw new AppError('INVALID_RESPONSE');
  const answer = sanitizeText(parsed.data.answer, LIMITS.ai.answerMax);
  if (answer === '') throw new AppError('INVALID_RESPONSE');
  return { value: { answer, cites: [...new Set(parsed.data.cites)] }, dropped: 0 };
}
