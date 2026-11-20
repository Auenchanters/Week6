/**
 * The AI contracts: the advice and answer the model must return, and the metadata of each call.
 * Does: build each answer schema for one plan's fact ids, so an item can cite only facts that plan
 * stated, and bound every text and list.
 * Never does: call the model or decide what to keep; server/answer.ts salvages items with these.
 */
import { z } from 'zod';
import { LIMITS } from './limits.js';

/** The ids the AI may cite: the plan's fact ids, never empty (every plan states `air.day`). */
export type FactIds = readonly [string, ...string[]];

const A = LIMITS.ai;
const MAX_CITES = 4;

/** One piece of AI advice and the plan facts it rests on. */
const citedSchema = (ids: FactIds) =>
  z.strictObject({
    text: z.string().trim().min(1).max(A.noteMax),
    cites: z.array(z.enum(ids)).min(1).max(MAX_CITES),
  });

const adviceShape = (ids: FactIds) =>
  z.strictObject({
    summary: z.string().trim().min(1).max(A.summaryMax),
    routine: z.array(citedSchema(ids)).max(A.notesMax),
    indoor: z.array(citedSchema(ids)).max(A.hacksMax),
    alternatives: z.array(citedSchema(ids)).max(A.alternativesMax),
  });

const askAnswerShape = (ids: FactIds) =>
  z.strictObject({
    answer: z.string().trim().min(1).max(A.answerMax),
    cites: z.array(z.enum(ids)).max(MAX_CITES),
  });

/** The advice schema for one plan, its fact-id enum built from that plan's ids. */
export type AdviceSchema = ReturnType<typeof adviceShape>;
/** The answer schema for one question, its fact-id enum built from the plan's ids. */
export type AskAnswerSchema = ReturnType<typeof askAnswerShape>;

/** The AI's advice for one plan; every item must cite at least one fact id of that plan. */
export const adviceSchemaFor = (ids: FactIds): AdviceSchema => adviceShape(ids);

/** The AI's answer to one follow-up question about a plan. */
export const askAnswerSchemaFor = (ids: FactIds): AskAnswerSchema => askAnswerShape(ids);

/** A cited item as the browser stores it (ids already checked against the plan). */
export interface CitedItem {
  readonly text: string;
  readonly cites: readonly string[];
}
/** The AI's personal advice: a summary and cited items per section. */
export interface Advice {
  readonly summary: string;
  readonly routine: readonly CitedItem[];
  readonly indoor: readonly CitedItem[];
  readonly alternatives: readonly CitedItem[];
}
/** The AI's answer to one question, with the fact ids it cites. */
export interface AskAnswer {
  readonly answer: string;
  readonly cites: readonly string[];
}

/** What the server reports about each model call, shown in the "AI at work" panel. */
export const aiMetaSchema = z.strictObject({
  model: z.string().min(1).max(80),
  latencyMs: z.number().int().min(0),
  inputTokens: z.number().int().min(0),
  outputTokens: z.number().int().min(0),
  /** Items in the answer that failed validation or cited unknown facts and were left out. */
  dropped: z.number().int().min(0),
  requestId: z.uuid(),
});
/** Metadata about one model call, returned with every AI answer. */
export type AiMeta = z.infer<typeof aiMetaSchema>;
