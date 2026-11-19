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
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import { buildAdvicePrompt, buildAskPrompt, factIds, type Prompt } from '../src/ai/prompt.js';
import { buildDayPlan } from '../src/domain/plan.js';
import {
  adviceRequestSchema,
  aiMetaSchema,
  askRequestSchema,
  type AiMeta,
  type FactIds,
} from '../src/shared/schema.js';
import { createAirClient, type AirClient } from './air.js';
import { createAnswerCache, type AnswerCache } from './answer-cache.js';
import { parseAdvice, parseAskAnswer, type Read } from './answer.js';
import { createInferenceGate } from './capacity.js';
import { AppError, errorResponse, type ErrorCode } from './errors.js';
import { logEvent, logRequest, type RequestFacts, type Route } from './log.js';
import { guardedGeneration } from './model-call.js';
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

/** One handler's resolved dependencies and per-instance state, shared by every request it serves. */
interface Deps extends Omit<HandlerOptions, 'model' | 'now' | 'limits' | 'air'> {
  readonly model: string;
  readonly now: () => Date;
  readonly limits: Limits;
  readonly air: AirClient;
  readonly withCapacity: <T>(task: () => Promise<T>) => Promise<T>;
  readonly cache: AnswerCache;
}

/** One request in flight: the request, its id, and the facts its log line will carry. */
interface InFlight {
  readonly request: Request;
  readonly requestId: string;
  readonly trace: RequestFacts;
}

/** One model job: the prompt, the fact ids its answer may cite, how to read it, and its body key. */
interface Job<T> {
  readonly prompt: Prompt;
  readonly ids: FactIds;
  readonly parse: (text: string, ids: FactIds) => Read<T>;
  readonly key: 'advice' | 'answer';
}

/** A finished model call and how long it took, in whole milliseconds. */
interface Generated {
  readonly generation: Generation;
  readonly latencyMs: number;
}

/** A route's work once its gates have passed. */
type RouteHandler = (deps: Deps, call: InFlight) => Promise<Response>;

/** The response a request ends with, and the public error code when it failed. */
interface Outcome {
  readonly response: Response;
  readonly code?: ErrorCode;
}

const noStoreJson = (body: unknown): Response => Response.json(body, { headers: NO_STORE });

/** The public error for anything thrown while handling `request`; a client abort wins. */
function toAppError(error: unknown, request: Request): AppError {
  if (request.signal.aborted) return new AppError('REQUEST_CANCELLED');
  return error instanceof AppError ? error : new AppError('INTERNAL_ERROR');
}

/**
 * One real model call for `prompt`: counted against the daily budget before it is made (the
 * provider bills a failed call too) and made inside the concurrency gate. Returns the generation
 * and its latency, with token counts noted on the trace.
 */
async function generateFor(deps: Deps, call: InFlight, prompt: Prompt): Promise<Generated> {
  const { generate } = deps;
  if (!generate) throw new AppError('AI_NOT_CONFIGURED');
  const { request, trace } = call;
  request.signal.throwIfAborted();
  await deps.limits.aiCall(deps.now().getTime());
  const started = performance.now();
  const generation = await guardedGeneration(
    () => deps.withCapacity(() => generate(prompt, request.signal)),
    trace,
  );
  trace.inputTokens = generation.inputTokens;
  trace.outputTokens = generation.outputTokens;
  // A cut-off answer rarely parses; if one does, what it holds is still used.
  if (generation.truncated === true) trace.event = 'truncated';
  return { generation, latencyMs: Math.round(performance.now() - started) };
}

/**
 * The call metadata returned with an answer. Checked at runtime too: a bad model id or token count
 * must not reach the client's store.
 */
function callMeta(deps: Deps, call: InFlight, made: Generated, dropped: number): AiMeta {
  const meta = aiMetaSchema.safeParse({
    model: deps.model,
    latencyMs: made.latencyMs,
    inputTokens: made.generation.inputTokens,
    outputTokens: made.generation.outputTokens,
    dropped,
    requestId: call.requestId,
  });
  if (!meta.success) throw new AppError('INVALID_RESPONSE');
  return meta.data;
}

/**
 * The answer to `job`: from the cache when the same prompt was answered before, otherwise one
 * model call read by `job.parse`. The body holds the parsed value under `job.key` plus call metadata.
 */
async function answer<T>(deps: Deps, call: InFlight, job: Job<T>): Promise<Response> {
  const cached = deps.cache.get(job.prompt);
  if (cached !== undefined) {
    call.trace.cached = true;
    return noStoreJson(cached);
  }
  const made = await generateFor(deps, call, job.prompt);
  const read = job.parse(made.generation.text, job.ids);
  if (read.dropped > 0) call.trace.dropped = read.dropped;
  const body = { [job.key]: read.value, meta: callMeta(deps, call, made, read.dropped) };
  deps.cache.set(job.prompt, body);
  return noStoreJson(body);
}

/** Each route's work. Health is answered before any gate; the others pass `admit` first. */
const HANDLERS: Readonly<Record<Route, RouteHandler>> = {
  '/api/health': (deps) =>
    Promise.resolve(
      noStoreJson({ status: 'ok', ai: deps.generate ? 'configured' : 'not_configured' }),
    ),
  '/api/air': async (deps, { request, trace }) => {
    const { lat, lon } = readQuery(request, airQuery);
    const forecast = await deps.air.forecast(lat, lon);
    trace.source = forecast.source;
    return noStoreJson(forecast);
  },
  '/api/places': async (deps, { request }) => {
    const { q } = readQuery(request, placesQuery);
    try {
      return noStoreJson({ places: await deps.air.places(q) });
    } catch {
      throw new AppError('PLACES_UNAVAILABLE');
    }
  },
  '/api/plan': async (deps, call) => {
    const { profile, forecast, dayIndex } = await readJsonBody(call.request, adviceRequestSchema);
    const plan = buildDayPlan(profile, forecast, dayIndex);
    const prompt = buildAdvicePrompt(plan, profile);
    return answer(deps, call, { prompt, ids: factIds(plan), parse: parseAdvice, key: 'advice' });
  },
  '/api/ask': async (deps, call) => {
    const body = await readJsonBody(call.request, askRequestSchema);
    const plan = buildDayPlan(body.profile, body.forecast, body.dayIndex);
    const prompt = buildAskPrompt(plan, body.profile, body.question);
    return answer(deps, call, { prompt, ids: factIds(plan), parse: parseAskAnswer, key: 'answer' });
  },
};

/**
 * The gates every route but health passes. Transport checks run first for POSTs, so a cross-site
 * or non-JSON request never spends a quota.
 */
async function admit(deps: Deps, request: Request, path: Route): Promise<void> {
  if (ROUTES[path] === 'POST') validateTransport(request, deps.origin);
  await deps.limits.request(clientId(request), deps.now().getTime());
}

/** Routes `call` and turns anything thrown into the catalogued error response. */
async function respond(deps: Deps, call: InFlight, path: string): Promise<Outcome> {
  const { request } = call;
  try {
    request.signal.throwIfAborted();
    if (!isRoute(path)) throw new AppError('NOT_FOUND');
    const method = ROUTES[path];
    if (request.method !== method) throw new AppError('METHOD_NOT_ALLOWED', { allow: method });
    if (path !== '/api/health') await admit(deps, request, path);
    return { response: await HANDLERS[path](deps, call) };
  } catch (error) {
    const failure = toAppError(error, request);
    if (failure.code === 'INTERNAL_ERROR') call.trace.kind = 'internal';
    return { response: errorResponse(failure), code: failure.code };
  }
}

/** A Fetch handler with its own rate-limit counters, concurrency gate and answer cache. */
export function createHandler(
  options: HandlerOptions = {},
): (request: Request) => Promise<Response> {
  const now = options.now ?? (() => new Date());
  const deps: Deps = {
    ...options,
    model: options.model ?? DEFAULT_MODEL,
    now,
    limits: options.limits ?? createMemoryLimits(),
    air: options.air ?? createAirClient((url, init) => fetch(url, init), now),
    withCapacity: createInferenceGate(),
    cache: createAnswerCache(ANSWER_CACHE_MAX),
  };
  return async (request) => {
    const started = performance.now();
    const path = new URL(request.url).pathname;
    const call: InFlight = { request, requestId: randomUUID(), trace: {} };
    const { response, code } = await respond(deps, call, path);
    logRequest({
      requestId: call.requestId,
      route: isRoute(path) ? path : 'unknown',
      status: response.status,
      ...(code ? { code } : {}),
      latencyMs: Math.round(performance.now() - started),
      ...call.trace,
    });
    return response;
  };
}

/** The environment variables a handler is configured from, such as `process.env`. */
export type Env = Readonly<Record<string, string | undefined>>;

/** A setting read from `env`: trimmed, and undefined when unset or blank (`NAME=`). */
const settingsOf =
  (env: Env) =>
  (name: string): string | undefined => {
    const value = env[name]?.trim();
    return value === '' ? undefined : value;
  };

/** The daily model-call budget: a positive whole number, or the default. */
function dailyLimitOf(raw: string | undefined): number {
  const daily = Number(raw);
  return Number.isSafeInteger(daily) && daily > 0 ? daily : DEFAULT_DAILY_LIMIT;
}

/** Shared limits when a store is configured; otherwise this instance's memory, logged once. */
function limitsFrom(setting: (name: string) => string | undefined, dailyLimit: number): Limits {
  const memory = createMemoryLimits(dailyLimit);
  const url = setting('KV_REST_API_URL') ?? setting('UPSTASH_REDIS_REST_URL');
  const token = setting('KV_REST_API_TOKEN') ?? setting('UPSTASH_REDIS_REST_TOKEN');
  if (url === undefined || token === undefined) {
    logEvent({ event: 'limiter_fallback', reason: 'not_configured' });
    return memory;
  }
  return createSharedLimits({ url, token, dailyLimit, fallback: memory });
}

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
  const setting = settingsOf(env);
  const key = setting('GEMINI_API_KEY');
  const model = setting('GEMINI_MODEL') ?? DEFAULT_MODEL;
  const origin = setting('APP_ORIGIN');
  return createHandler({
    model,
    limits: limitsFrom(setting, dailyLimitOf(setting('AI_DAILY_LIMIT'))),
    ...(key ? { generate: createGeminiGenerator(key, model) } : {}),
    ...(origin ? { origin } : {}),
  });
}
