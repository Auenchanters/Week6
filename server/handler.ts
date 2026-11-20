/**
 * The API's one Fetch handler, shared by the Vercel function and the local dev server.
 * Does: resolve the route and its method, run the gates (content type and origin for POSTs, then
 * the per-client rate limit), hand the request to its route (server/routes.ts), turn anything
 * thrown into a catalogued error, and write one log line per request.
 * Never does: return a provider message, or log household or model text.
 */
import { randomUUID } from 'node:crypto';
import { createAirClient, type AirClient } from './air.js';
import { createAnswerCache } from './answer-cache.js';
import { createInferenceGate } from './capacity.js';
import type { Deps, InFlight } from './context.js';
import { AppError, errorResponse, type ErrorCode } from './errors.js';
import { logRequest, type Route } from './log.js';
import { DEFAULT_MODEL, type Generate } from './provider.js';
import { clientId, createMemoryLimits, type Limits } from './rate-limit.js';
import { validateTransport } from './request.js';
import { HANDLERS, isRoute, ROUTES } from './routes.js';

/** Answers kept for repeated prompts; a repeat costs no model call. */
const ANSWER_CACHE_MAX = 200;

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

/** The response a request ends with, and the public error code when it failed. */
interface Outcome {
  readonly response: Response;
  readonly code?: ErrorCode;
}

/** The public error for anything thrown while handling `request`; a client abort wins. */
function toAppError(error: unknown, request: Request): AppError {
  if (request.signal.aborted) return new AppError('REQUEST_CANCELLED');
  return error instanceof AppError ? error : new AppError('INTERNAL_ERROR');
}

/**
 * The gates every route but health passes. Transport checks run first for POSTs, so a cross-site
 * or non-JSON request never spends a quota.
 */
async function admit(deps: Deps, request: Request, path: Route): Promise<void> {
  if (ROUTES[path] === 'POST') validateTransport(request, deps.origin);
  await deps.limits.request(clientId(request), deps.now().getTime());
}

/** The route `path` names, once the request is still wanted and uses that route's method. */
function resolve(request: Request, path: string): Route {
  request.signal.throwIfAborted();
  if (!isRoute(path)) throw new AppError('NOT_FOUND');
  const method = ROUTES[path];
  if (request.method !== method) throw new AppError('METHOD_NOT_ALLOWED', { allow: method });
  return path;
}

/** Routes `call` and turns anything thrown into the catalogued error response. */
async function respond(deps: Deps, call: InFlight, path: string): Promise<Outcome> {
  const { request } = call;
  try {
    const route = resolve(request, path);
    if (route !== '/api/health') await admit(deps, request, route);
    return { response: await HANDLERS[route](deps, call) };
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
