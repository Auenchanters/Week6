/**
 * What every route receives: the handler's resolved dependencies and the request in flight.
 * Does: name the shapes the router, the routes and the model reply share, and the one way a route
 * answers JSON (never cached by a browser or CDN).
 * Never does: handle a request; server/handler.ts dispatches, server/routes.ts does the work.
 */
import type { AirClient } from './air.js';
import type { AnswerCache } from './answer-cache.js';
import type { Read } from './answer.js';
import type { RequestFacts } from './log.js';
import type { Generate } from './provider.js';
import type { Limits } from './rate-limit.js';

/** One handler's resolved dependencies and per-instance state, shared by every request it serves. */
export interface Deps {
  /** The model call; absent when no key is configured. */
  readonly generate?: Generate;
  /** `APP_ORIGIN`, accepted in addition to the request's own origin. */
  readonly origin?: string;
  /** The model id reported in `meta.model`. */
  readonly model: string;
  readonly now: () => Date;
  readonly limits: Limits;
  readonly air: AirClient;
  /** Runs a model call inside the per-instance concurrency gate. */
  readonly withCapacity: <T>(task: () => Promise<T>) => Promise<T>;
  /** Parsed answers by prompt; call metadata is never cached, so each reply carries its own. */
  readonly cache: AnswerCache<Read<unknown>>;
}

/** One request in flight: the request, its id, and the facts its log line will carry. */
export interface InFlight {
  readonly request: Request;
  readonly requestId: string;
  readonly trace: RequestFacts;
}

/** A route's work once its gates have passed. */
export type RouteHandler = (deps: Deps, call: InFlight) => Promise<Response>;

/** A JSON response no browser or CDN may store. */
export const noStoreJson = (body: unknown): Response =>
  Response.json(body, { headers: { 'Cache-Control': 'no-store' } });
