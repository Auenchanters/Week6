/**
 * The handler as the deployment configures it, from environment variables.
 * Does: read each setting (trimmed; blank means unset), pick the daily model-call budget, choose
 * shared limits when a store is configured or this instance's memory otherwise (logged once), and
 * build the Gemini generator only when a key is set.
 * Never does: log or return a setting's value.
 */
import { createHandler } from './handler.js';
import { logEvent } from './log.js';
import { createGeminiGenerator, DEFAULT_MODEL } from './provider.js';
import {
  createMemoryLimits,
  createSharedLimits,
  DEFAULT_DAILY_LIMIT,
  type Limits,
} from './rate-limit.js';

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

/** A Fetch handler, as the platform calls it. */
type Fetch = (request: Request) => Promise<Response>;

/**
 * `handler` as the dynamic Vercel function `api/[route].ts` must call it. Vercel passes the path
 * segment as a `route` query parameter, which the strict query schemas of `GET /api/air` and
 * `GET /api/places` would reject, so it is removed first. Only GET requests read the query, so a
 * POST (whose body must not be copied) passes through as it came.
 */
export function withoutRouteSegment(handler: Fetch): Fetch {
  return (request) => {
    const url = new URL(request.url);
    if (request.method !== 'GET' || !url.searchParams.has('route')) return handler(request);
    url.searchParams.delete('route');
    return handler(new Request(url, { headers: request.headers, signal: request.signal }));
  };
}
