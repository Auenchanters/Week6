/**
 * The API's one Fetch handler, shared by the Vercel functions and the local dev server.
 * Does: route five endpoints, `GET /api/health`, `GET /api/air` (the 48-hour forecast for a place),
 * `GET /api/places` (place search), `POST /api/plan` (AI advice for a day plan) and `POST /api/ask`
 * (one grounded question); run each route's gate (method, content type, origin, rate limit, size,
 * JSON, schema); rebuild the day plan with the same engine the browser runs, so the facts sent to
 * the model are computed here from validated numbers; answer a repeated prompt from a cache with
 * no model call; count a real call against the daily budget and make it inside the concurrency
 * gate; return sanitized, fact-checked answers with call metadata; write one log line per request.
 * Never does: retry a model call, return a provider message, or log household or model text.
 */
import { createHash, randomUUID } from 'node:crypto';
import { ApiError } from '@google/genai';
import { z } from 'zod';
import { buildAdvicePrompt, buildAskPrompt, factIds, type Prompt } from '../src/ai/prompt.js';
import { buildDayPlan } from '../src/domain/plan.js';
import {
  adviceRequestSchema,
  aiMetaSchema,
  askRequestSchema,
  type FactIds,
} from '../src/shared/schema.js';
import { createAirClient, type AirClient } from './air.js';
import { parseAdvice, parseAskAnswer, type Read } from './answer.js';
import { createInferenceGate } from './capacity.js';
import { AppError, errorResponse, type ErrorCode } from './errors.js';
import { logEvent, logRequest, type RequestFacts, type Route } from './log.js';
import { createGeminiGenerator, type Generate, type Generation } from './provider.js';
import {
  clientId,
  createMemoryLimits,
  createSharedLimits,
  DEFAULT_DAILY_LIMIT,
  type Limits,
} from './rate-limit.js';
import { readJsonBody, readQuery, validateTransport } from './request.js';

const DEFAULT_MODEL = 'gemini-3.5-flash-lite';
/** Each route and the one method it accepts. */
const ROUTES = {
  '/api/plan': 'POST',
  '/api/ask': 'POST',
  '/api/air': 'GET',
  '/api/places': 'GET',
  '/api/health': 'GET',
} as const satisfies Record<Route, string>;
const isRoute = (path: string): path is Route => Object.hasOwn(ROUTES, path);
const NO_STORE = { 'Cache-Control': 'no-store' };
/** Answers kept for repeated prompts; a repeat costs no model call. */
const ANSWER_CACHE_MAX = 200;

/** A decimal number written out in full: blank or `1e3` is rejected, not read as 0 or 1000. */
const decimal = (min: number, max: number) =>
  z
    .string()
    .regex(/^-?\d{1,3}(\.\d{1,6})?$/u)
    .transform(Number)
    .pipe(z.number().min(min).max(max));
const airQuery = z.strictObject({
  lat: decimal(-90, 90),
  lon: decimal(-180, 180),
});
const placesQuery = z.strictObject({ q: z.string().trim().min(2).max(60) });

/** Dependencies, injectable so tests run offline and deterministically. */
export interface HandlerOptions {
  /** The model call. Without it, AI routes answer `AI_NOT_CONFIGURED`. */
  readonly generate?: Generate;
  /** The model id reported in `meta.model`. */
  readonly model?: string;
  /** `APP_ORIGIN`, accepted in addition to the request's own origin. */
  readonly origin?: string;
  /** The clock for the rate limit and the daily budget. */
  readonly now?: () => Date;
  /** The quotas; by default in-memory counters for this handler alone. */
  readonly limits?: Limits;
  /** The air data client; by default Open-Meteo through the global `fetch`. */
  readonly air?: AirClient;
}

/** Facts about a request gathered for its log line as handling proceeds. */
type Trace = RequestFacts;

/** Quota exhaustion: the SDK throws its `ApiError` with the HTTP status, 429 for a spent quota. */
const isBusy = (error: unknown): boolean => error instanceof ApiError && error.status === 429;

/** The SDK's own timeout aborts its fetch, which rejects with an AbortError. */
const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

/**
 * The public code for a failed model call, chosen by the error's shape. Inspecting a hostile value
 * (a throwing getter or Proxy trap) must not escape as a 500, so that falls back to unavailable.
 */
function modelFailure(error: unknown): ErrorCode {
  try {
    if (isBusy(error)) return 'AI_BUSY';
    if (isTimeout(error)) return 'AI_TIMEOUT';
  } catch {
    // Fall through: an error we cannot even inspect is just an unavailable provider.
  }
  return 'AI_UNAVAILABLE';
}

/** The provider's HTTP status for a failed call, for the log only; never its message. */
function providerStatus(error: unknown): number | undefined {
  try {
    return error instanceof ApiError ? error.status : undefined;
  } catch {
    return undefined;
  }
}

/** The public error for anything thrown while handling `request`; a client abort wins. */
function toAppError(error: unknown, request: Request): AppError {
  if (request.signal.aborted) return new AppError('REQUEST_CANCELLED');
  return error instanceof AppError ? error : new AppError('INTERNAL_ERROR');
}

/** A SHA-256 of a prompt, the answer cache's key. */
const promptKey = (prompt: Prompt): string =>
  createHash('sha256').update(prompt.system).update('\u0000').update(prompt.user).digest('hex');

/** A Fetch handler with its own rate-limit counters, concurrency gate and answer cache. */
export function createHandler(
  options: HandlerOptions = {},
): (request: Request) => Promise<Response> {
  const { generate, model = DEFAULT_MODEL, origin, now = () => new Date() } = options;
  const limits = options.limits ?? createMemoryLimits();
  const air = options.air ?? createAirClient((url, init) => fetch(url, init), now);
  const withCapacity = createInferenceGate();
  const answers = new Map<string, unknown>();

  /**
   * One model call for `prompt`, read by `parse`, answered from the cache when the same prompt
   * was answered before. Returns the JSON body: the parsed value under `key`, plus call metadata.
   */
  async function answer<T>(
    request: Request,
    prompt: Prompt,
    ids: FactIds,
    parse: (text: string, ids: FactIds) => Read<T>,
    key: 'advice' | 'answer',
    trace: Trace,
    requestId: string,
  ): Promise<Response> {
    const cacheKey = promptKey(prompt);
    const cached = answers.get(cacheKey);
    if (cached !== undefined) {
      trace.cached = true;
      return Response.json(cached, { headers: NO_STORE });
    }
    if (!generate) throw new AppError('AI_NOT_CONFIGURED');
    request.signal.throwIfAborted();
    // Counted before the call, as an attempt: the provider bills a call that fails too.
    await limits.aiCall(now().getTime());
    const started = performance.now();
    let generation: Generation;
    try {
      generation = await withCapacity(() => generate(prompt, request.signal));
    } catch (error) {
      if (error instanceof AppError) throw error;
      const status = providerStatus(error);
      if (status !== undefined) trace.providerStatus = status;
      throw new AppError(modelFailure(error));
    }
    const latencyMs = Math.round(performance.now() - started);
    const { inputTokens, outputTokens } = generation;
    trace.inputTokens = inputTokens;
    trace.outputTokens = outputTokens;
    // A cut-off answer rarely parses; if one does, what it holds is still used.
    if (generation.truncated === true) trace.event = 'truncated';
    const read = parse(generation.text, ids);
    if (read.dropped > 0) trace.dropped = read.dropped;
    // Checked at runtime too: a bad model id or token count must not reach the client's store.
    const meta = aiMetaSchema.safeParse({
      model,
      latencyMs,
      inputTokens,
      outputTokens,
      dropped: read.dropped,
      requestId,
    });
    if (!meta.success) throw new AppError('INVALID_RESPONSE');
    const body = { [key]: read.value, meta: meta.data };
    if (answers.size >= ANSWER_CACHE_MAX) answers.clear();
    answers.set(cacheKey, body);
    return Response.json(body, { headers: NO_STORE });
  }

  async function route(
    request: Request,
    path: Route,
    requestId: string,
    trace: Trace,
  ): Promise<Response> {
    if (path === '/api/health') {
      const ai = generate ? 'configured' : 'not_configured';
      return Response.json({ status: 'ok', ai }, { headers: NO_STORE });
    }
    // Transport checks first for POSTs: a cross-site or non-JSON request never spends a quota.
    if (ROUTES[path] === 'POST') validateTransport(request, origin);
    await limits.request(clientId(request), now().getTime());
    if (path === '/api/air') {
      const { lat, lon } = readQuery(request, airQuery);
      const forecast = await air.forecast(lat, lon);
      trace.source = forecast.source;
      return Response.json(forecast, { headers: NO_STORE });
    }
    if (path === '/api/places') {
      const { q } = readQuery(request, placesQuery);
      try {
        return Response.json({ places: await air.places(q) }, { headers: NO_STORE });
      } catch {
        throw new AppError('PLACES_UNAVAILABLE');
      }
    }
    if (path === '/api/plan') {
      const { profile, forecast, dayIndex } = await readJsonBody(request, adviceRequestSchema);
      const plan = buildDayPlan(profile, forecast, dayIndex);
      const prompt = buildAdvicePrompt(plan, profile);
      return answer(request, prompt, factIds(plan), parseAdvice, 'advice', trace, requestId);
    }
    const { profile, forecast, dayIndex, question } = await readJsonBody(request, askRequestSchema);
    const plan = buildDayPlan(profile, forecast, dayIndex);
    const prompt = buildAskPrompt(plan, profile, question);
    return answer(request, prompt, factIds(plan), parseAskAnswer, 'answer', trace, requestId);
  }

  return async (request) => {
    const requestId = randomUUID();
    const started = performance.now();
    const path = new URL(request.url).pathname;
    const trace: Trace = {};
    let response: Response;
    let code: ErrorCode | undefined;
    try {
      request.signal.throwIfAborted();
      if (!isRoute(path)) throw new AppError('NOT_FOUND');
      const method = ROUTES[path];
      if (request.method !== method) throw new AppError('METHOD_NOT_ALLOWED', { allow: method });
      response = await route(request, path, requestId, trace);
    } catch (error) {
      const failure = toAppError(error, request);
      code = failure.code;
      if (code === 'INTERNAL_ERROR') trace.kind = 'internal';
      response = errorResponse(failure);
    }
    logRequest({
      requestId,
      route: isRoute(path) ? path : 'unknown',
      status: response.status,
      ...(code ? { code } : {}),
      latencyMs: Math.round(performance.now() - started),
      ...trace,
    });
    return response;
  };
}

/** The environment variables a handler is configured from, such as `process.env`. */
export type Env = Readonly<Record<string, string | undefined>>;

/**
 * A handler configured from `env`, built once per warm instance by each function entry point:
 * `GEMINI_API_KEY` (no key, no model calls), `GEMINI_MODEL`, `APP_ORIGIN`, `AI_DAILY_LIMIT` (a
 * whole number of model calls a UTC day; 300 when unset or not a positive whole number) and the
 * shared store for the limits: `KV_REST_API_URL` and `KV_REST_API_TOKEN` as the Vercel Marketplace
 * names them, or `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Without a store the
 * limits count in this instance's memory, and that is logged once. A value that is unset or blank
 * (`NAME=`) means "not set".
 */
export function handlerFromEnv(env: Env): (request: Request) => Promise<Response> {
  const setting = (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === '' ? undefined : value;
  };
  const key = setting('GEMINI_API_KEY');
  const model = setting('GEMINI_MODEL') ?? DEFAULT_MODEL;
  const origin = setting('APP_ORIGIN');
  const daily = Number(setting('AI_DAILY_LIMIT'));
  const dailyLimit = Number.isSafeInteger(daily) && daily > 0 ? daily : DEFAULT_DAILY_LIMIT;
  const url = setting('KV_REST_API_URL') ?? setting('UPSTASH_REDIS_REST_URL');
  const token = setting('KV_REST_API_TOKEN') ?? setting('UPSTASH_REDIS_REST_TOKEN');
  let limits = createMemoryLimits(dailyLimit);
  if (url === undefined || token === undefined) {
    logEvent({ event: 'limiter_fallback', reason: 'not_configured' });
  } else {
    limits = createSharedLimits({ url, token, dailyLimit, fallback: limits });
  }
  return createHandler({
    model,
    limits,
    ...(key ? { generate: createGeminiGenerator(key, model) } : {}),
    ...(origin ? { origin } : {}),
  });
}
