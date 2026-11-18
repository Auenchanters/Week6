/**
 * Tests for the browser's API client (src/features/client/api.ts).
 * Does: check each route's request (method, headers, body), that every response is validated, and
 * that network failures, cancelled requests, error envelopes and malformed bodies all come back as
 * `{ code, message }` values instead of exceptions.
 * Never does: reach the network.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { buildDayPlan } from '../../src/domain/plan.js';
import {
  fetchForecast,
  requestAdvice,
  requestAnswer,
  searchPlaces,
} from '../../src/features/client/api.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';
import { ADVICE, bodyOf, FORECAST, json, META, PLACES } from '../support/api.js';

const plan = buildDayPlan(SAMPLE_PROFILE, FORECAST, 0);
const input = { profile: SAMPLE_PROFILE, forecast: FORECAST, plan };

afterEach(() => {
  vi.unstubAllGlobals();
});

/** Stubs `fetch` to answer with `answer`, and returns the stub. */
function answerWith(answer: () => Promise<Response>): ReturnType<typeof vi.fn<typeof fetch>> {
  const fake = vi.fn<typeof fetch>(answer);
  vi.stubGlobal('fetch', fake);
  return fake;
}

describe('forecast and places', () => {
  it('returns a validated forecast', async () => {
    const fake = answerWith(() => json(FORECAST));
    expect(await fetchForecast(28.61, 77.21)).toEqual({ ok: true, value: FORECAST });
    expect(fake).toHaveBeenCalledWith('/api/air?lat=28.61&lon=77.21', {});
  });

  it('passes the abort signal along', async () => {
    const fake = answerWith(() => json({ places: PLACES }));
    const { signal } = new AbortController();
    await fetchForecast(1, 2, signal);
    await searchPlaces('Pune', signal);
    expect(fake).toHaveBeenNthCalledWith(1, '/api/air?lat=1&lon=2', { signal });
    expect(fake).toHaveBeenNthCalledWith(2, '/api/places?q=Pune', { signal });
  });

  it('rejects a forecast of the wrong shape', async () => {
    answerWith(() => json({ source: 'open-meteo', hours: [] }));
    expect(await fetchForecast(1, 2)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_RESPONSE' },
    });
  });

  it('searches places with the text encoded', async () => {
    const fake = answerWith(() => json({ places: PLACES }));
    expect(await searchPlaces('São Paulo')).toEqual({ ok: true, value: PLACES });
    expect(fake).toHaveBeenCalledWith('/api/places?q=S%C3%A3o%20Paulo', {});
  });

  it('passes a failed search on as a failure', async () => {
    answerWith(() => json({ error: { code: 'PLACES_UNAVAILABLE', message: 'Down.' } }, 502));
    expect(await searchPlaces('Pune')).toEqual({
      ok: false,
      error: { code: 'PLACES_UNAVAILABLE', message: 'Down.' },
    });
  });
});

describe('failures', () => {
  it('reports a network error', async () => {
    answerWith(() => Promise.reject(new TypeError('offline')));
    expect(await fetchForecast(1, 2)).toMatchObject({ ok: false, error: { code: 'NETWORK' } });
  });

  it('reports a cancelled request as cancelled', async () => {
    const controller = new AbortController();
    answerWith(() => {
      controller.abort();
      return Promise.reject(new DOMException('aborted', 'AbortError'));
    });
    expect(await fetchForecast(1, 2, controller.signal)).toMatchObject({
      ok: false,
      error: { code: 'ABORTED' },
    });
  });

  it('reports an error page that is not JSON as a network problem', async () => {
    answerWith(() => Promise.resolve(new Response('<html>', { status: 502 })));
    expect(await fetchForecast(1, 2)).toMatchObject({ ok: false, error: { code: 'NETWORK' } });
  });

  it('reports a good status with a body that is not JSON as an unreadable answer', async () => {
    answerWith(() => Promise.resolve(new Response('nope', { status: 200 })));
    expect(await fetchForecast(1, 2)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_RESPONSE' },
    });
  });

  it('reports an error status whose body is not an error envelope', async () => {
    answerWith(() => json({ oops: true }, 500));
    expect(await fetchForecast(1, 2)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_RESPONSE' },
    });
  });
});

describe('AI routes', () => {
  it('posts the household, forecast and day, and validates the advice', async () => {
    const fake = answerWith(() => json({ advice: ADVICE, meta: META }));
    expect(await requestAdvice(input)).toEqual({ ok: true, value: { advice: ADVICE, meta: META } });
    const [url, init] = fake.mock.calls[0] ?? [];
    expect(url).toBe('/api/plan');
    expect(init).toMatchObject({ method: 'POST', headers: { 'Content-Type': 'application/json' } });
    expect(bodyOf(init)).toEqual({
      profile: SAMPLE_PROFILE,
      forecast: FORECAST,
      dayIndex: 0,
    });
  });

  it('rejects advice that cites a fact the plan does not have', async () => {
    const bad = { ...ADVICE, routine: [{ text: 'x', cites: ['made.up'] }] };
    answerWith(() => json({ advice: bad, meta: META }));
    expect(await requestAdvice(input)).toMatchObject({
      ok: false,
      error: { code: 'INVALID_RESPONSE' },
    });
  });

  it('posts a question with the signal and validates the answer', async () => {
    const fake = answerWith(() =>
      json({ answer: { answer: 'Yes.', cites: ['air.day'] }, meta: META }),
    );
    const { signal } = new AbortController();
    expect(await requestAnswer(input, 'Is it safe?', signal)).toMatchObject({
      ok: true,
      value: { answer: { answer: 'Yes.' } },
    });
    const [url, init] = fake.mock.calls[0] ?? [];
    expect(url).toBe('/api/ask');
    expect(init?.signal).toBe(signal);
    expect(bodyOf(init)).toMatchObject({ question: 'Is it safe?', dayIndex: 0 });
  });
});
