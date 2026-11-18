/**
 * A fake Clearday API for UI and client tests.
 * Does: answer `fetch` for the five routes with the bundled sample forecast, two place matches and
 * fixed AI answers shaped like the real API, record every call, and let a test replace any route
 * with its own response.
 * Never does: reach the network.
 */
import { vi, type Mock } from 'vitest';
import { sampleForecast } from '../../server/sample-forecast.js';

export const FORECAST = sampleForecast('2026-11-18', '2026-11-19');
export const META = {
  model: 'gemini-test',
  latencyMs: 1234,
  inputTokens: 1500,
  outputTokens: 321,
  dropped: 0,
  requestId: '123e4567-e89b-42d3-a456-426614174000',
};
export const ADVICE = {
  summary: 'Keep the windows shut and move the walk to the afternoon.',
  routine: [{ text: 'Walk at two in the afternoon.', cites: ['air.cleanest'] }],
  indoor: [{ text: 'Run a purifier in the bedroom.', cites: ['indoor.mean', 'air.day'] }],
  alternatives: [],
};
export const PLACES = [
  { name: 'New Delhi, India', latitude: 28.61, longitude: 77.21 },
  { name: 'New Town, India', latitude: 22.58, longitude: 88.48 },
];

/** The URL a `fetch` call was made with, as text. */
export const urlOf = (input: RequestInfo | URL): string =>
  input instanceof Request ? input.url : input.toString();

/** The JSON body a `fetch` call was made with. */
export const bodyOf = (init: RequestInit | undefined): unknown =>
  JSON.parse(typeof init?.body === 'string' ? init.body : 'null');

/** A JSON response with `status`. */
export const json = (body: unknown, status = 200): Promise<Response> =>
  Promise.resolve(Response.json(body, { status }));

/** A route's answer: the body and status of the response. */
export type Route = (url: URL, init: RequestInit | undefined) => Promise<Response>;

/** The routes the fake serves; replace any with `overrides`, keyed by path. */
export function stubApi(overrides: Readonly<Record<string, Route>> = {}): Mock<typeof fetch> {
  const routes: Record<string, Route> = {
    '/api/air': () => json(FORECAST),
    '/api/places': () => json({ places: PLACES }),
    '/api/plan': () => json({ advice: ADVICE, meta: META }),
    '/api/ask': () =>
      json({
        answer: { answer: 'Yes, late afternoon is fine.', cites: ['air.worst'] },
        meta: META,
      }),
    ...overrides,
  };
  const fake = vi.fn<typeof fetch>((input, init) => {
    const url = new URL(urlOf(input), 'http://localhost');
    const route = routes[url.pathname];
    return route ? route(url, init) : json({ error: { code: 'NOT_FOUND', message: 'No.' } }, 404);
  });
  vi.stubGlobal('fetch', fake);
  return fake;
}

/** The paths fetched so far, in order. */
export const paths = (fake: Mock<typeof fetch>): string[] =>
  fake.mock.calls.map(([input]) => new URL(urlOf(input), 'http://localhost').pathname);
