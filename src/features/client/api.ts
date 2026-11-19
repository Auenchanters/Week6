/**
 * The browser's one door to the Clearday API.
 * Does: call the five same-origin routes with `fetch`, check every response against its zod schema
 * (the AI answers against the cite ids of the plan that was sent), turn every failure into a
 * `{ code, message }` value and honour an `AbortSignal`.
 * Never does: throw for an expected failure, trust a response shape, or send anything but the
 * household, the forecast and the question the person typed.
 */
import { z } from 'zod';
import type { DayPlan } from '../../domain/plan.js';
import { factIds } from '../../ai/prompt.js';
import { err, ok, type Result } from '../../shared/result.js';
import {
  adviceSchemaFor,
  aiMetaSchema,
  askAnswerSchemaFor,
  forecastSchema,
  type Advice,
  type AiMeta,
  type AskAnswer,
  type Forecast,
  type Profile,
} from '../../shared/schema.js';

/** A failure the screen can show: a stable code and a sentence for people. */
interface ApiFailure {
  readonly code: string;
  readonly message: string;
}
/** An API call's outcome: the parsed value, or the failure's public code and message. */
export type ApiResult<T> = Result<T, ApiFailure>;

/** One place a search found. */
export interface PlaceHit {
  readonly name: string;
  readonly latitude: number;
  readonly longitude: number;
}

const placesSchema = z.object({
  places: z.array(z.object({ name: z.string(), latitude: z.number(), longitude: z.number() })),
});
const errorSchema = z.object({
  error: z.object({ code: z.string(), message: z.string() }),
});

const NETWORK: ApiFailure = {
  code: 'NETWORK',
  message: 'Could not reach Clearday. Check your connection and try again.',
};
const INVALID: ApiFailure = {
  code: 'INVALID_RESPONSE',
  message: 'Clearday sent an answer this page could not read. Please try again.',
};
const ABORTED: ApiFailure = { code: 'ABORTED', message: 'The request was cancelled.' };

/** `fetch`, with a failed or cancelled request returned as a failure value. */
async function send(url: string, init: RequestInit): Promise<ApiResult<unknown>> {
  let response: Response;
  try {
    response = await fetch(url, init);
  } catch {
    return err(init.signal?.aborted === true ? ABORTED : NETWORK);
  }
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    return err(response.ok ? INVALID : NETWORK);
  }
  if (response.ok) return ok(body);
  const failure = errorSchema.safeParse(body);
  return err(failure.success ? failure.data.error : INVALID);
}

/** `send`, then `schema` over the body. */
async function receive<S extends z.ZodType>(
  url: string,
  init: RequestInit,
  schema: S,
): Promise<ApiResult<z.output<S>>> {
  const sent = await send(url, init);
  if (!sent.ok) return sent;
  const parsed = schema.safeParse(sent.value);
  return parsed.success ? ok(parsed.data) : err(INVALID);
}

const post = (body: unknown, signal?: AbortSignal): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
  ...(signal ? { signal } : {}),
});

/** The 48-hour air forecast around a place. */
export const fetchForecast = (
  latitude: number,
  longitude: number,
  signal?: AbortSignal,
): Promise<ApiResult<Forecast>> =>
  receive(`/api/air?lat=${latitude}&lon=${longitude}`, signal ? { signal } : {}, forecastSchema);

/** Places matching a search text, at most a handful. */
export async function searchPlaces(
  query: string,
  signal?: AbortSignal,
): Promise<ApiResult<PlaceHit[]>> {
  const found = await receive(
    `/api/places?q=${encodeURIComponent(query)}`,
    signal ? { signal } : {},
    placesSchema,
  );
  return found.ok ? ok(found.value.places) : found;
}

/** What the household sends with each AI request. */
export interface PlanInput {
  readonly profile: Profile;
  readonly forecast: Forecast;
  readonly plan: DayPlan;
}

/** AI advice for the plan, with the call's metadata. One model call. */
export async function requestAdvice(
  { profile, forecast, plan }: PlanInput,
  signal?: AbortSignal,
): Promise<ApiResult<{ advice: Advice; meta: AiMeta }>> {
  return receive(
    '/api/plan',
    post({ profile, forecast, dayIndex: plan.dayIndex }, signal),
    z.object({ advice: adviceSchemaFor(factIds(plan)), meta: aiMetaSchema }),
  );
}

/** The AI's answer to one question about the plan. One model call. */
export async function requestAnswer(
  { profile, forecast, plan }: PlanInput,
  question: string,
  signal?: AbortSignal,
): Promise<ApiResult<{ answer: AskAnswer; meta: AiMeta }>> {
  return receive(
    '/api/ask',
    post({ profile, forecast, dayIndex: plan.dayIndex, question }, signal),
    z.object({ answer: askAnswerSchemaFor(factIds(plan)), meta: aiMetaSchema }),
  );
}
