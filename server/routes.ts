/**
 * The API's five routes: the method each accepts and the work each does once its gates pass.
 * Does: validate GET queries strictly (`GET /api/air` coordinates, `GET /api/places` text), fetch
 * air data and places, report health, and hand `POST /api/plan` and `POST /api/ask` to the model
 * reply with the job each asks for.
 * Never does: run a gate; server/handler.ts admits the request before a route sees it.
 */
import { z } from 'zod';
import { buildAdvicePrompt, buildAskPrompt } from '../src/ai/prompt.js';
import { adviceRequestSchema, askRequestSchema } from '../src/shared/schema.js';
import { parseAdvice, parseAskAnswer } from './answer.js';
import { noStoreJson, type RouteHandler } from './context.js';
import { AppError } from './errors.js';
import type { Route } from './log.js';
import { modelRoute } from './model-reply.js';
import { readQuery } from './request.js';

/** Each route and the one method it accepts. */
export const ROUTES = {
  '/api/plan': 'POST',
  '/api/ask': 'POST',
  '/api/air': 'GET',
  '/api/places': 'GET',
  '/api/health': 'GET',
} as const satisfies Record<Route, string>;
/** Whether `path` is one of the API's routes. */
export const isRoute = (path: string): path is Route => Object.hasOwn(ROUTES, path);
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

/** Each route's work. Health is answered before any gate; the others pass `admit` first. */
export const HANDLERS: Readonly<Record<Route, RouteHandler>> = {
  /** Whether the AI is configured, never how. */
  '/api/health': (deps) =>
    Promise.resolve(
      noStoreJson({ status: 'ok', ai: deps.generate ? 'configured' : 'not_configured' }),
    ),
  /** The 48-hour forecast for a place: live, cached, or the bundled sample. */
  '/api/air': async (deps, { request, trace }) => {
    const { lat, lon } = readQuery(request, airQuery);
    const forecast = await deps.air.forecast(lat, lon);
    trace.source = forecast.source;
    return noStoreJson(forecast);
  },
  /** Places matching a name; a provider failure becomes PLACES_UNAVAILABLE. */
  '/api/places': async (deps, { request }) => {
    const { q } = readQuery(request, placesQuery);
    try {
      return noStoreJson({ places: await deps.air.places(q) });
    } catch {
      throw new AppError('PLACES_UNAVAILABLE');
    }
  },
  /** Personal advice for the day plan, every item citing its facts. */
  '/api/plan': modelRoute(adviceRequestSchema, (plan, { profile }) => ({
    prompt: buildAdvicePrompt(plan, profile),
    parse: parseAdvice,
    key: 'advice',
  })),
  /** One grounded answer to the household's question. */
  '/api/ask': modelRoute(askRequestSchema, (plan, { profile, question }) => ({
    prompt: buildAskPrompt(plan, profile, question),
    parse: parseAskAnswer,
    key: 'answer',
  })),
};
