/**
 * The HTTP contract of the Clearday API, end to end through `createHandler` with an injected model
 * and air client: every route's method, gates and failure codes, the prompt the model receives,
 * the answer cache, the quotas, the concurrency gate, cancellation, sanitized output, and log
 * privacy. Also `handlerFromEnv`. Never calls the network.
 */
import { ApiError } from '@google/genai';
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  vi,
  type Mock,
  type MockInstance,
} from 'vitest';
import { z } from 'zod';
import type { AirClient } from '../../server/air.js';
import { createHandler, handlerFromEnv, type HandlerOptions } from '../../server/handler.js';
import type { Generate, Generation } from '../../server/provider.js';
import { createMemoryLimits, type Limits } from '../../server/rate-limit.js';
import { sampleForecast } from '../../server/sample-forecast.js';
import { buildAdvicePrompt, buildAskPrompt, factIds } from '../../src/ai/prompt.js';
import { buildDayPlan } from '../../src/domain/plan.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';
import {
  adviceRequestSchema,
  adviceSchemaFor,
  aiMetaSchema,
  askAnswerSchemaFor,
  askRequestSchema,
} from '../../src/shared/schema.js';

// Only a handler built by `handlerFromEnv` reaches the SDK; every other test injects `generate`.
// The mock keeps that path offline too.
const sdk = vi.hoisted(() => ({ generateContent: vi.fn() }));
vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = { generateContent: sdk.generateContent };
  },
}));

const ORIGIN = 'https://clearday.example';
const NOW = new Date('2026-11-18T10:00:00Z');
const FORECAST = sampleForecast('2026-11-18', '2026-11-19');
const PLAN_BODY = { profile: SAMPLE_PROFILE, forecast: FORECAST, dayIndex: 0 };
const QUESTION = 'Should Zebracorn walk to school tomorrow?';
const ASK_BODY = { ...PLAN_BODY, question: QUESTION };
const MODEL_SECRET = 'ModelSecretPhrase';
const PLAN = buildDayPlan(SAMPLE_PROFILE, FORECAST, 0);
const IDS = factIds(PLAN);

const ADVICE = {
  summary: `Air is poor. ${MODEL_SECRET}`,
  routine: [{ text: 'Walk after noon.', cites: ['air.day'] }],
  indoor: [{ text: 'Run a purifier.', cites: ['air.day'] }],
  alternatives: [{ text: 'Take the metro.', cites: ['air.day'] }],
};
const ANSWER = { answer: `Wait until noon. ${MODEL_SECRET}`, cites: ['air.day'] };

const generation = (text: string, extra: Partial<Generation> = {}): Generation => ({
  text,
  inputTokens: 300,
  outputTokens: 420,
  ...extra,
});
const answering = (text = JSON.stringify(ADVICE)) =>
  vi.fn<Generate>(() => Promise.resolve(generation(text)));
const failing = (error: unknown) =>
  vi.fn<Generate>(() =>
    Promise.resolve().then(() => {
      throw error;
    }),
  );

interface FakeAir {
  forecast: Mock<AirClient['forecast']>;
  places: Mock<AirClient['places']>;
}
const fakeAir = (): FakeAir => ({
  forecast: vi.fn<AirClient['forecast']>(() => Promise.resolve(FORECAST)),
  places: vi.fn<AirClient['places']>(() =>
    Promise.resolve([{ name: 'New Delhi, India', latitude: 28.61, longitude: 77.21 }]),
  ),
});

const handlerWith = (options: HandlerOptions = {}) =>
  createHandler({ now: () => NOW, model: 'test-model', air: fakeAir(), ...options });

function post(
  path: '/api/plan' | '/api/ask',
  body: unknown = path === '/api/plan' ? PLAN_BODY : ASK_BODY,
  headers: Record<string, string> = {},
  init: RequestInit = {},
): Request {
  return new Request(`${ORIGIN}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN, ...headers },
    body: typeof body === 'string' ? body : JSON.stringify(body),
    ...init,
  });
}
const plan = (...args: [unknown?, Record<string, string>?, RequestInit?]) =>
  post('/api/plan', ...args);
const ask = (...args: [unknown?, Record<string, string>?, RequestInit?]) =>
  post('/api/ask', ...args);
const get = (path: string) => new Request(`${ORIGIN}${path}`);

const errorEnvelope = z.strictObject({
  error: z.strictObject({
    code: z.string(),
    message: z.string(),
    fields: z.array(z.string()).optional(),
  }),
});

/** The parsed `{ error: { code, message, fields? } }` envelope of a failed response. */
async function errorOf(response: Response): Promise<z.infer<typeof errorEnvelope>['error']> {
  const body: unknown = await response.clone().json();
  return errorEnvelope.parse(body).error;
}

let info: MockInstance<typeof console.info>;
let error: MockInstance<typeof console.error>;
let warn: MockInstance<typeof console.warn>;
beforeEach(() => {
  sdk.generateContent.mockReset();
  info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

/** Every line written to the console, parsed. */
const logLines = (): unknown[] =>
  [...info.mock.calls, ...error.mock.calls, ...warn.mock.calls].map(([line]) =>
    z
      .string()
      .transform((s): unknown => JSON.parse(s))
      .parse(line),
  );
const lastRequestLog = (spy: MockInstance<typeof console.info> = info) =>
  z
    .looseObject({ route: z.string(), status: z.number() })
    .parse(JSON.parse(String(spy.mock.calls.at(-1)?.[0])));

/** Limits that admit everything. */
const unlimited: Limits = { request: () => Promise.resolve(), aiCall: () => Promise.resolve() };

describe('routing', () => {
  it.each([
    ['/api/plan', 'POST'],
    ['/api/ask', 'POST'],
    ['/api/air', 'GET'],
    ['/api/places', 'GET'],
    ['/api/health', 'GET'],
  ])('405 with Allow: %s for the wrong method on %s', async (path, allowed) => {
    const generate = answering();
    const wrong = allowed === 'GET' ? 'POST' : 'GET';
    const response = await handlerWith({ generate })(
      new Request(`${ORIGIN}${path}`, { method: wrong }),
    );
    expect(response.status).toBe(405);
    expect(response.headers.get('allow')).toBe(allowed);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect((await errorOf(response)).code).toBe('METHOD_NOT_ALLOWED');
    expect(generate).not.toHaveBeenCalled();
  });

  it.each(['PUT', 'DELETE', 'PATCH'])('405 for %s on the plan route', async (method) => {
    const response = await handlerWith()(new Request(`${ORIGIN}/api/plan`, { method }));
    expect(response.status).toBe(405);
  });

  it('404 with a static message that never echoes the path', async () => {
    const response = await handlerWith()(get('/api/secret-<b>path</b>'));
    expect(response.status).toBe(404);
    expect(await response.clone().text()).not.toMatch(/secret|path/u);
    expect(await errorOf(response)).toEqual({
      code: 'NOT_FOUND',
      message: 'This endpoint does not exist.',
    });
    expect(lastRequestLog()).toMatchObject({ route: 'unknown', status: 404 });
    expect(JSON.stringify(info.mock.calls)).not.toContain('secret');
  });

  it.each(['/', '/api', '/api/', '/api/plan/', '/API/PLAN', '/api/__proto__', '/api/toString'])(
    '404 for %s',
    async (path) => {
      expect((await handlerWith()(get(path))).status).toBe(404);
    },
  );
});

describe('GET /api/health', () => {
  it('reports health in both states, with no-store and nothing else', async () => {
    const off = await handlerWith()(get('/api/health'));
    expect(off.status).toBe(200);
    expect(off.headers.get('cache-control')).toBe('no-store');
    expect(await off.json()).toEqual({ status: 'ok', ai: 'not_configured' });
    const on = await handlerWith({ generate: answering() })(get('/api/health'));
    expect(await on.json()).toEqual({ status: 'ok', ai: 'configured' });
  });

  it('is not rate limited and logs one line', async () => {
    const request = vi.fn<Limits['request']>(() => Promise.reject(new Error('should not run')));
    const response = await handlerWith({ limits: { request, aiCall: unlimited.aiCall } })(
      get('/api/health'),
    );
    expect(response.status).toBe(200);
    expect(request).not.toHaveBeenCalled();
    expect(lastRequestLog()).toMatchObject({ route: '/api/health', status: 200 });
  });
});

describe('GET /api/air', () => {
  it('returns the forecast for valid coordinates and logs its source', async () => {
    const air = fakeAir();
    const response = await handlerWith({ air })(get('/api/air?lat=28.61&lon=77.21'));
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    expect(await response.json()).toEqual(FORECAST);
    expect(air.forecast).toHaveBeenCalledWith(28.61, 77.21);
    expect(lastRequestLog()).toMatchObject({ route: '/api/air', status: 200, source: 'sample' });
  });

  it.each([
    ['no parameters', '', ['body']],
    ['no longitude', '?lat=28', ['lon']],
    ['a latitude out of range', '?lat=91&lon=77', ['lat']],
    ['a longitude out of range', '?lat=28&lon=-181', ['lon']],
    ['text for a number', '?lat=abc&lon=77', ['lat']],
    ['a blank latitude, which must not read as 0', '?lat=&lon=77', ['lat']],
    ['exponent notation', '?lat=2.8e1&lon=77', ['lat']],
    ['an extra parameter', '?lat=28&lon=77&units=us', ['body']],
  ])('400 INVALID_REQUEST with the fields for %s', async (_name, query, fields) => {
    const air = fakeAir();
    const response = await handlerWith({ air })(get(`/api/air${query}`));
    expect(response.status).toBe(400);
    const failure = await errorOf(response);
    expect(failure.code).toBe('INVALID_REQUEST');
    expect(failure.fields?.length).toBeGreaterThan(0);
    if (query !== '') expect(failure.fields).toEqual(fields);
    expect(air.forecast).not.toHaveBeenCalled();
  });

  it('429 RATE_LIMITED with Retry-After once a client has made ten requests a minute', async () => {
    const handler = handlerWith();
    for (let i = 0; i < 10; i += 1) {
      expect((await handler(get('/api/air?lat=28&lon=77'))).status).toBe(200);
    }
    const limited = await handler(get('/api/air?lat=28&lon=77'));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect((await errorOf(limited)).code).toBe('RATE_LIMITED');
  });

  it('500 INTERNAL_ERROR, with no message, when the air client throws unexpectedly', async () => {
    const air = fakeAir();
    air.forecast.mockRejectedValue(new Error('private operational detail'));
    const response = await handlerWith({ air })(get('/api/air?lat=28&lon=77'));
    expect(response.status).toBe(500);
    expect(JSON.stringify(await response.json())).not.toContain('private');
    expect(lastRequestLog(error)).toMatchObject({ code: 'INTERNAL_ERROR', kind: 'internal' });
  });
});

describe('GET /api/places', () => {
  it('returns the matches', async () => {
    const air = fakeAir();
    const response = await handlerWith({ air })(get('/api/places?q=New%20Del'));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      places: [{ name: 'New Delhi, India', latitude: 28.61, longitude: 77.21 }],
    });
    expect(air.places).toHaveBeenCalledWith('New Del');
  });

  it('trims the query before searching', async () => {
    const air = fakeAir();
    await handlerWith({ air })(get('/api/places?q=%20%20Pune%20'));
    expect(air.places).toHaveBeenCalledWith('Pune');
  });

  it.each([
    ['no query', ''],
    ['a one-letter query', '?q=a'],
    ['a blank query', '?q=%20%20%20'],
    ['a query over 60 characters', `?q=${'x'.repeat(61)}`],
    ['an extra parameter', '?q=Pune&limit=100'],
  ])('400 INVALID_REQUEST for %s', async (_name, query) => {
    const air = fakeAir();
    const response = await handlerWith({ air })(get(`/api/places${query}`));
    expect(response.status).toBe(400);
    const failure = await errorOf(response);
    expect(failure.code).toBe('INVALID_REQUEST');
    expect(failure.fields?.length).toBeGreaterThan(0);
    expect(air.places).not.toHaveBeenCalled();
  });

  it('502 PLACES_UNAVAILABLE, without the provider message, when the search fails', async () => {
    const air = fakeAir();
    air.places.mockRejectedValue(new Error('geocoder exploded at 10.0.0.1'));
    const response = await handlerWith({ air })(get('/api/places?q=Pune'));
    expect(response.status).toBe(502);
    expect(await errorOf(response)).toMatchObject({ code: 'PLACES_UNAVAILABLE' });
    expect(await response.clone().text()).not.toContain('10.0.0.1');
  });
});

describe.each([
  ['/api/plan', plan, PLAN_BODY],
  ['/api/ask', ask, ASK_BODY],
] as const)('POST %s: the gates', (_path, make, body) => {
  const generating = () =>
    answering(_path === '/api/plan' ? JSON.stringify(ADVICE) : JSON.stringify(ANSWER));

  it('415 for a non-JSON content type', async () => {
    const generate = generating();
    const response = await handlerWith({ generate })(make(body, { 'content-type': 'text/plain' }));
    expect(response.status).toBe(415);
    expect((await errorOf(response)).code).toBe('JSON_REQUIRED');
    expect(generate).not.toHaveBeenCalled();
  });

  it('403 for a foreign Origin', async () => {
    const generate = generating();
    const response = await handlerWith({ generate })(
      make(body, { origin: 'https://evil.example' }),
    );
    expect(response.status).toBe(403);
    expect((await errorOf(response)).code).toBe('ORIGIN_REJECTED');
    expect(generate).not.toHaveBeenCalled();
  });

  it('403 for a request with no Origin', async () => {
    const request = new Request(`${ORIGIN}${_path}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    const response = await handlerWith({ generate: generating() })(request);
    expect(response.status).toBe(403);
  });

  it('403 for a cross-site fetch even from the right Origin', async () => {
    const response = await handlerWith({ generate: generating() })(
      make(body, { 'sec-fetch-site': 'cross-site' }),
    );
    expect(response.status).toBe(403);
  });

  it('accepts APP_ORIGIN as well as its own origin', async () => {
    const app = 'https://app.example';
    const handler = handlerWith({ generate: generating(), origin: app });
    expect((await handler(make(body, { origin: app }))).status).toBe(200);
    expect(
      (await handlerWith({ generate: generating() })(make(body, { origin: app }))).status,
    ).toBe(403);
  });

  it('413 for a declared Content-Length over the cap', async () => {
    const generate = generating();
    const response = await handlerWith({ generate })(make(body, { 'content-length': '40000' }));
    expect(response.status).toBe(413);
    expect((await errorOf(response)).code).toBe('BODY_TOO_LARGE');
    expect(generate).not.toHaveBeenCalled();
  });

  it('413 for a streamed body over the cap with no Content-Length', async () => {
    const generate = generating();
    const chunk = new TextEncoder().encode(' '.repeat(8192));
    let sent = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        sent += 1;
        controller.enqueue(chunk);
        if (sent === 10) controller.close();
      },
    });
    const init = { method: 'POST', body: stream, duplex: 'half' };
    const request = new Request(`${ORIGIN}${_path}`, {
      ...init,
      headers: { 'content-type': 'application/json', origin: ORIGIN },
    });
    const response = await handlerWith({ generate })(request);
    expect(response.status).toBe(413);
    expect(sent).toBeLessThan(10);
    expect(generate).not.toHaveBeenCalled();
  });

  it('400 INVALID_JSON for a body that is not JSON', async () => {
    const response = await handlerWith({ generate: generating() })(make('{"profile":'));
    expect(response.status).toBe(400);
    expect((await errorOf(response)).code).toBe('INVALID_JSON');
  });

  it('400 INVALID_REQUEST naming the field paths, never the values', async () => {
    const generate = generating();
    const [first, ...rest] = SAMPLE_PROFILE.members;
    const bad = {
      ...body,
      dayIndex: 2,
      profile: { ...SAMPLE_PROFILE, members: [{ ...first, age: 'SECRET-AGE' }, ...rest] },
      extra: true,
    };
    const response = await handlerWith({ generate })(make(bad));
    expect(response.status).toBe(400);
    const failure = await errorOf(response);
    expect(failure.code).toBe('INVALID_REQUEST');
    expect(failure.fields).toEqual(expect.arrayContaining(['dayIndex', 'profile.members.0.age']));
    expect(JSON.stringify(failure)).not.toContain('SECRET');
    expect(generate).not.toHaveBeenCalled();
  });

  it('400 for an empty body, an array, and a forecast of the wrong length', async () => {
    for (const bad of [
      '',
      '[]',
      { ...body, forecast: { ...FORECAST, hours: FORECAST.hours.slice(1) } },
    ]) {
      const response = await handlerWith({ generate: generating() })(make(bad));
      expect(response.status).toBe(400);
    }
  });

  it('503 AI_NOT_CONFIGURED when no model is set up', async () => {
    const response = await handlerWith()(make(body));
    expect(response.status).toBe(503);
    expect((await errorOf(response)).code).toBe('AI_NOT_CONFIGURED');
  });

  it('429 RATE_LIMITED when the client has spent its quota', async () => {
    const generate = generating();
    const handler = handlerWith({ generate, limits: createMemoryLimits() });
    for (let i = 0; i < 10; i += 1) expect((await handler(make(body))).status).toBe(200);
    const limited = await handler(make(body));
    expect(limited.status).toBe(429);
    expect(limited.headers.get('retry-after')).toBe('60');
    expect((await errorOf(limited)).code).toBe('RATE_LIMITED');
    expect(generate).toHaveBeenCalledTimes(1);
  });
});

describe('POST /api/plan: the model call', () => {
  it('returns validated advice and metadata, with no-store', async () => {
    const generate = answering();
    const response = await handlerWith({ generate })(plan());
    expect(response.status).toBe(200);
    expect(response.headers.get('cache-control')).toBe('no-store');
    const body = z
      .strictObject({ advice: adviceSchemaFor(IDS), meta: aiMetaSchema })
      .parse(await response.json());
    expect(body.advice).toEqual(ADVICE);
    expect(body.meta).toMatchObject({
      model: 'test-model',
      inputTokens: 300,
      outputTokens: 420,
      dropped: 0,
    });
    expect(generate).toHaveBeenCalledTimes(1);
  });

  it('sends the generator exactly the prompt built from the engine plan for the parsed request', async () => {
    const generate = answering();
    await handlerWith({ generate })(plan({ ...PLAN_BODY, dayIndex: 1 }));
    const parsed = adviceRequestSchema.parse({ ...PLAN_BODY, dayIndex: 1 });
    const expected = buildAdvicePrompt(
      buildDayPlan(parsed.profile, parsed.forecast, 1),
      parsed.profile,
    );
    expect(generate).toHaveBeenCalledWith(expected, expect.any(AbortSignal));
    expect(JSON.stringify(generate.mock.calls[0]?.[0])).toBe(JSON.stringify(expected));
  });

  it('serves an identical second request from the cache with no second model call', async () => {
    const generate = answering();
    const handler = handlerWith({ generate });
    const first = await handler(plan());
    info.mockClear();
    const second = await handler(plan());
    expect(second.status).toBe(200);
    expect(await second.json()).toEqual(await first.json());
    expect(generate).toHaveBeenCalledTimes(1);
    expect(lastRequestLog()).toMatchObject({ route: '/api/plan', status: 200, cached: true });
  });

  it('does not count a cached answer against the daily budget', async () => {
    const aiCall = vi.fn<Limits['aiCall']>(() => Promise.resolve());
    const handler = handlerWith({ generate: answering(), limits: { ...unlimited, aiCall } });
    await handler(plan());
    await handler(plan());
    expect(aiCall).toHaveBeenCalledTimes(1);
  });

  it('answers a different day with a new model call', async () => {
    const generate = answering();
    const handler = handlerWith({ generate });
    await handler(plan());
    await handler(plan({ ...PLAN_BODY, dayIndex: 1 }));
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('does not cache a failed call', async () => {
    const generate = vi
      .fn<Generate>()
      .mockRejectedValueOnce(new Error('boom'))
      .mockResolvedValue(generation(JSON.stringify(ADVICE)));
    const handler = handlerWith({ generate });
    expect((await handler(plan())).status).toBe(502);
    expect((await handler(plan())).status).toBe(200);
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('forgets cached answers once it holds 200, and not before', async () => {
    const generate = vi.fn<Generate>(() => Promise.resolve(generation(JSON.stringify(ANSWER))));
    const handler = handlerWith({ generate, limits: unlimited });
    for (let i = 0; i < 201; i += 1)
      await handler(ask({ ...ASK_BODY, question: `Question ${String(i)}?` }));
    expect(generate).toHaveBeenCalledTimes(201);
    await handler(ask({ ...ASK_BODY, question: 'Question 200?' }));
    expect(generate).toHaveBeenCalledTimes(201);
    await handler(ask({ ...ASK_BODY, question: 'Question 0?' }));
    expect(generate).toHaveBeenCalledTimes(202);
  });

  it('503 AI_BUSY with Retry-After for a spent quota (ApiError 429)', async () => {
    const quota = new ApiError({
      message: 'RESOURCE_EXHAUSTED project quota key=SECRET',
      status: 429,
    });
    const response = await handlerWith({ generate: failing(quota) })(plan());
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe('60');
    expect((await errorOf(response)).code).toBe('AI_BUSY');
    expect(await response.clone().text()).not.toContain('SECRET');
  });

  it.each(['AbortError', 'TimeoutError'])('504 AI_TIMEOUT for a %s', async (name) => {
    const response = await handlerWith({
      generate: failing(new DOMException('The operation timed out.', name)),
    })(plan());
    expect(response.status).toBe(504);
    expect((await errorOf(response)).code).toBe('AI_TIMEOUT');
  });

  it.each([
    ['an ordinary error', new Error('model exploded')],
    ['an ApiError with another status', new ApiError({ message: 'upstream', status: 500 })],
    ['a thrown string', 'oops'],
    ['undefined', undefined],
  ])('502 AI_UNAVAILABLE for %s, without its message', async (_name, thrown) => {
    const response = await handlerWith({ generate: failing(thrown) })(plan());
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('AI_UNAVAILABLE');
    expect(await response.clone().text()).not.toMatch(/exploded|upstream|oops/u);
  });

  it('logs the provider status of a failed call, and never its message', async () => {
    await handlerWith({
      generate: failing(new ApiError({ message: 'upstream secret', status: 404 })),
    })(plan());
    expect(lastRequestLog(error)).toMatchObject({ code: 'AI_UNAVAILABLE', providerStatus: 404 });
    expect(JSON.stringify(lastRequestLog(error))).not.toContain('upstream secret');
  });

  it('502 AI_UNAVAILABLE, not a 500, for an error that cannot be inspected', async () => {
    const hostile = new Proxy(new ApiError({ message: 'x', status: 429 }), {
      get() {
        throw new Error('trap');
      },
    });
    const response = await handlerWith({ generate: failing(hostile) })(plan());
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('AI_UNAVAILABLE');
  });

  it.each([
    ['text that is not JSON', 'Sorry, I cannot help.'],
    ['an empty answer', '{}'],
    ['only unusable items', JSON.stringify({ routine: [{ text: 'x', cites: ['made.up'] }] })],
  ])('502 INVALID_RESPONSE for %s, and nothing is cached', async (_name, text) => {
    const generate = answering(text);
    const handler = handlerWith({ generate });
    const response = await handler(plan());
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('INVALID_RESPONSE');
    await handler(plan());
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('502 INVALID_RESPONSE if the metadata would break its own contract', async () => {
    for (const model of ['', 'm'.repeat(81)]) {
      const response = await handlerWith({ generate: answering(), model })(plan());
      expect(response.status).toBe(502);
      expect((await errorOf(response)).code).toBe('INVALID_RESPONSE');
    }
    const negative = vi.fn<Generate>(() =>
      Promise.resolve({ text: JSON.stringify(ADVICE), inputTokens: -1, outputTokens: 1 }),
    );
    expect((await handlerWith({ generate: negative })(plan())).status).toBe(502);
  });

  it('drops items that cite unknown facts, reporting the count in meta and the log', async () => {
    const text = JSON.stringify({
      ...ADVICE,
      routine: [...ADVICE.routine, { text: 'Invented.', cites: ['made.up'] }],
      indoor: [{ text: 'Also invented.', cites: ['air.nope'] }, ...ADVICE.indoor],
    });
    const response = await handlerWith({ generate: answering(text) })(plan());
    expect(response.status).toBe(200);
    const body = z
      .object({ advice: adviceSchemaFor(IDS), meta: aiMetaSchema })
      .parse(await response.json());
    expect(body.meta.dropped).toBe(2);
    expect(body.advice.routine).toEqual(ADVICE.routine);
    expect(body.advice.indoor).toEqual(ADVICE.indoor);
    expect(lastRequestLog()).toMatchObject({ dropped: 2, inputTokens: 300, outputTokens: 420 });
  });

  it('sanitizes model text: no tags and no link openers reach the client', async () => {
    const text = JSON.stringify({
      summary: '<b>Stay in</b> and visit https://evil.example/pay now',
      routine: [
        { text: '<script>alert(1)</script>Walk late. www.evil.example', cites: ['air.day'] },
      ],
    });
    const response = await handlerWith({ generate: answering(text) })(plan());
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).not.toMatch(/<|>|https?:\/\/|www\./iu);
    expect(body).toContain('Stay in');
  });

  it('logs a truncated answer that still parsed', async () => {
    const generate = vi.fn<Generate>(() =>
      Promise.resolve(generation(JSON.stringify(ADVICE), { truncated: true })),
    );
    const response = await handlerWith({ generate })(plan());
    expect(response.status).toBe(200);
    expect(lastRequestLog()).toMatchObject({ event: 'truncated' });
  });

  it('503 AI_BUSY, with the seconds until UTC midnight, once the daily budget is spent', async () => {
    const generate = answering();
    const handler = handlerWith({ generate, limits: createMemoryLimits(1) });
    expect((await handler(plan())).status).toBe(200);
    const response = await handler(plan({ ...PLAN_BODY, dayIndex: 1 }));
    expect(response.status).toBe(503);
    expect(response.headers.get('retry-after')).toBe(String(14 * 3600));
    expect((await errorOf(response)).code).toBe('AI_BUSY');
    expect(generate).toHaveBeenCalledTimes(1);
    // The first answer is still served from the cache after the budget is gone.
    expect((await handler(plan())).status).toBe(200);
  });
});

describe('POST /api/ask: the model call', () => {
  it('returns a validated answer and metadata', async () => {
    const generate = answering(JSON.stringify(ANSWER));
    const response = await handlerWith({ generate })(ask());
    expect(response.status).toBe(200);
    const body = z
      .strictObject({ answer: askAnswerSchemaFor(IDS), meta: aiMetaSchema })
      .parse(await response.json());
    expect(body.answer).toEqual(ANSWER);
    expect(body.meta.model).toBe('test-model');
  });

  it('sends the generator exactly the ask prompt for the plan and the question', async () => {
    const generate = answering(JSON.stringify(ANSWER));
    await handlerWith({ generate })(ask());
    const parsed = askRequestSchema.parse(ASK_BODY);
    const expected = buildAskPrompt(
      buildDayPlan(parsed.profile, parsed.forecast, 0),
      parsed.profile,
      parsed.question,
    );
    expect(generate).toHaveBeenCalledWith(expected, expect.any(AbortSignal));
    expect(generate.mock.calls[0]?.[0].user).toContain(QUESTION);
  });

  it('caches per question', async () => {
    const generate = answering(JSON.stringify(ANSWER));
    const handler = handlerWith({ generate });
    await handler(ask());
    await handler(ask());
    expect(generate).toHaveBeenCalledTimes(1);
    await handler(ask({ ...ASK_BODY, question: 'And the day after?' }));
    expect(generate).toHaveBeenCalledTimes(2);
  });

  it('400 for a missing or too-short question, and one over 300 characters', async () => {
    for (const question of [undefined, 'x', '  ', 'q'.repeat(301)]) {
      const response = await handlerWith({ generate: answering() })(
        ask({ ...PLAN_BODY, question }),
      );
      expect(response.status).toBe(400);
      expect((await errorOf(response)).fields).toContain('question');
    }
  });

  it('keeps the plan route from taking a question, and the ask route from a missing one', async () => {
    expect((await handlerWith({ generate: answering() })(plan(ASK_BODY))).status).toBe(400);
    expect((await handlerWith({ generate: answering() })(ask(PLAN_BODY))).status).toBe(400);
  });

  it('502 INVALID_RESPONSE for an answer that cites an unknown fact', async () => {
    const text = JSON.stringify({ answer: 'Maybe.', cites: ['made.up'] });
    const response = await handlerWith({ generate: answering(text) })(ask());
    expect(response.status).toBe(502);
    expect((await errorOf(response)).code).toBe('INVALID_RESPONSE');
  });
});

describe('capacity and cancellation', () => {
  it('429 CAPACITY_LIMITED for the fourth of four simultaneous slow model calls', async () => {
    const release: (() => void)[] = [];
    const generate = vi.fn<Generate>(
      () =>
        new Promise((resolve) => {
          release.push(() => {
            resolve(generation(JSON.stringify(ADVICE)));
          });
        }),
    );
    const handler = handlerWith({ generate, limits: unlimited });
    const calls = [0, 1, 2, 3].map((i) =>
      handler(
        plan({
          ...PLAN_BODY,
          profile: {
            ...SAMPLE_PROFILE,
            place: { ...SAMPLE_PROFILE.place, name: `Place ${String(i)}` },
          },
        }),
      ),
    );
    const refused = await calls[3];
    expect(refused?.status).toBe(429);
    expect(refused?.headers.get('retry-after')).toBe('60');
    expect(await errorOf(refused ?? new Response())).toMatchObject({ code: 'CAPACITY_LIMITED' });
    expect(generate).toHaveBeenCalledTimes(3);
    for (const done of release) done();
    const statuses = (await Promise.all(calls.slice(0, 3))).map((r) => r.status);
    expect(statuses).toEqual([200, 200, 200]);
    // Slots are free again.
    const later = handler(plan({ ...PLAN_BODY, dayIndex: 1 }));
    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalledTimes(4);
    });
    for (const done of release.slice(3)) done();
    expect((await later).status).toBe(200);
  });

  it('frees the slot when a call fails', async () => {
    const generate = vi
      .fn<Generate>()
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockRejectedValueOnce(new Error('x'))
      .mockResolvedValue(generation(JSON.stringify(ADVICE)));
    const handler = handlerWith({ generate, limits: unlimited });
    for (let i = 0; i < 4; i += 1) expect((await handler(plan())).status).toBe(502);
    expect((await handler(plan())).status).toBe(200);
  });

  it('499 REQUEST_CANCELLED without calling the model when the client aborted before', async () => {
    const generate = answering();
    const response = await handlerWith({ generate })(
      plan(undefined, {}, { signal: AbortSignal.abort() }),
    );
    expect(response.status).toBe(499);
    expect((await errorOf(response)).code).toBe('REQUEST_CANCELLED');
    expect(generate).not.toHaveBeenCalled();
  });

  it('499 without calling the model when the client aborts while the request is read', async () => {
    const controller = new AbortController();
    const generate = answering();
    const limits: Limits = {
      request: () => {
        controller.abort();
        return Promise.resolve();
      },
      aiCall: () => Promise.resolve(),
    };
    const response = await handlerWith({ generate, limits })(
      plan(undefined, {}, { signal: controller.signal }),
    );
    expect(response.status).toBe(499);
    expect(generate).not.toHaveBeenCalled();
  });

  it('499 when the client aborts while the model is working, passing the signal through', async () => {
    const controller = new AbortController();
    const generate = vi.fn<Generate>(
      (_prompt, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () => {
            reject(new DOMException('aborted', 'AbortError'));
          });
        }),
    );
    const pending = handlerWith({ generate })(plan(undefined, {}, { signal: controller.signal }));
    await vi.waitFor(() => {
      expect(generate).toHaveBeenCalled();
    });
    controller.abort();
    const response = await pending;
    expect(response.status).toBe(499);
    expect(lastRequestLog()).toMatchObject({ status: 499, route: '/api/plan' });
  });
});

describe('unexpected faults', () => {
  it('500 INTERNAL_ERROR with a generic message, logged as an internal fault without the message', async () => {
    const limits: Limits = {
      request: () => {
        throw new Error('private operational detail');
      },
      aiCall: () => Promise.resolve(),
    };
    const response = await handlerWith({ generate: answering(), limits })(plan());
    expect(response.status).toBe(500);
    const { code, message } = await errorOf(response);
    expect(code).toBe('INTERNAL_ERROR');
    expect(message).not.toContain('private');
    expect(error).toHaveBeenCalledOnce();
    const line = String(error.mock.calls[0]?.[0]);
    expect(line).not.toContain('private');
    expect(JSON.parse(line)).toMatchObject({
      status: 500,
      code: 'INTERNAL_ERROR',
      kind: 'internal',
    });
  });

  it('does not mark expected failures as internal', async () => {
    await handlerWith()(plan());
    expect(lastRequestLog(error)).toMatchObject({ status: 503, code: 'AI_NOT_CONFIGURED' });
    expect(JSON.stringify(logLines())).not.toContain('internal');
  });
});

describe('log privacy', () => {
  const ALLOWED = new Set([
    'requestId',
    'route',
    'status',
    'code',
    'latencyMs',
    'kind',
    'event',
    'cached',
    'source',
    'inputTokens',
    'outputTokens',
    'dropped',
  ]);

  it('writes one line per request holding only ids, numbers and fixed labels', async () => {
    const handler = handlerWith({ generate: answering(JSON.stringify(ANSWER)) });
    await handler(get('/api/health'));
    await handler(get('/api/air?lat=28&lon=77'));
    await handler(get('/api/places?q=Zebra'));
    await handler(ask());
    await handler(ask());
    await handler(plan(undefined, { origin: 'https://evil.example' }));
    await handler(get('/api/nowhere'));
    const lines = logLines();
    expect(lines).toHaveLength(7);
    for (const line of lines) {
      const keys = Object.keys(z.record(z.string(), z.unknown()).parse(line));
      for (const key of keys) expect(ALLOWED.has(key)).toBe(true);
    }
  });

  it('never logs member names, the place, the question, model text or the forecast', async () => {
    const generate = vi
      .fn<Generate>()
      .mockResolvedValueOnce(generation(JSON.stringify(ADVICE)))
      .mockResolvedValueOnce(generation(JSON.stringify(ANSWER)))
      .mockResolvedValueOnce(generation('MODEL-GARBAGE-TEXT not json'));
    const handler = handlerWith({ generate });
    await handler(plan());
    await handler(ask());
    await handler(ask({ ...ASK_BODY, question: `${QUESTION} again` }));
    await handler(plan({ ...PLAN_BODY, question: 'unexpected key' }));
    const everything = JSON.stringify(logLines());
    const secrets = [
      ...SAMPLE_PROFILE.members.map((m) => m.name),
      SAMPLE_PROFILE.place.name,
      'Zebracorn',
      MODEL_SECRET,
      'MODEL-GARBAGE-TEXT',
      'unexpected key',
      'Asia/Kolkata',
      PLAN.facts[0]?.text ?? 'missing fact',
    ];
    for (const secret of secrets) expect(everything).not.toContain(secret);
  });
});

describe('handlerFromEnv', () => {
  const modelReply = (text: string) => ({
    text,
    usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 },
    candidates: [],
  });
  const health = async (env: Record<string, string | undefined>) =>
    z.object({ ai: z.string() }).parse(await (await handlerFromEnv(env)(get('/api/health'))).json())
      .ai;

  it('has no model without a key, and treats a blank key as unset', async () => {
    expect(await health({})).toBe('not_configured');
    expect(await health({ GEMINI_API_KEY: '' })).toBe('not_configured');
    expect(await health({ GEMINI_API_KEY: '   ' })).toBe('not_configured');
    expect(await health({ GEMINI_API_KEY: 'test-key' })).toBe('configured');
  });

  it('answers a plan through the SDK, reporting the configured model', async () => {
    sdk.generateContent.mockResolvedValue(modelReply(JSON.stringify(ADVICE)));
    const handler = handlerFromEnv({ GEMINI_API_KEY: 'test-key', GEMINI_MODEL: ' gemini-test ' });
    const response = await handler(plan());
    expect(response.status).toBe(200);
    const { meta } = z.object({ meta: aiMetaSchema }).parse(await response.json());
    expect(meta).toMatchObject({ model: 'gemini-test', inputTokens: 10, outputTokens: 5 });
    expect(sdk.generateContent).toHaveBeenCalledOnce();
  });

  it('uses the default model when GEMINI_MODEL is blank', async () => {
    sdk.generateContent.mockResolvedValue(modelReply(JSON.stringify(ADVICE)));
    const response = await handlerFromEnv({ GEMINI_API_KEY: 'k', GEMINI_MODEL: '  ' })(plan());
    const { meta } = z.object({ meta: aiMetaSchema }).parse(await response.json());
    expect(meta.model).toBe('gemini-3.5-flash-lite');
  });

  it('accepts APP_ORIGIN, and a blank one means unset', async () => {
    sdk.generateContent.mockResolvedValue(modelReply(JSON.stringify(ADVICE)));
    const foreign = { origin: 'https://app.example' };
    const withOrigin = handlerFromEnv({ GEMINI_API_KEY: 'k', APP_ORIGIN: 'https://app.example' });
    expect((await withOrigin(plan(undefined, foreign))).status).toBe(200);
    const blank = handlerFromEnv({ GEMINI_API_KEY: 'k', APP_ORIGIN: ' ' });
    expect((await blank(plan(undefined, foreign))).status).toBe(403);
  });

  it.each([
    ['1', 1],
    [' 1 ', 1],
    ['2', 2],
  ])('stops model calls after AI_DAILY_LIMIT=%j of them', async (value, limit) => {
    sdk.generateContent.mockResolvedValue(modelReply(JSON.stringify(ADVICE)));
    const handler = handlerFromEnv({ GEMINI_API_KEY: 'k', AI_DAILY_LIMIT: value });
    // The same prompt is cached, so vary the place to force a real call each time.
    const distinct = (i: number) =>
      plan({
        ...PLAN_BODY,
        profile: {
          ...SAMPLE_PROFILE,
          place: { ...SAMPLE_PROFILE.place, name: `Town ${String(i)}` },
        },
      });
    for (let i = 0; i < limit; i += 1) expect((await handler(distinct(i))).status).toBe(200);
    const spent = await handler(distinct(limit));
    expect(spent.status).toBe(503);
    expect((await errorOf(spent)).code).toBe('AI_BUSY');
  });

  it.each(['', '0', '-5', 'abc', '1.5', '1e400', '99999999999999999999'])(
    'falls back to the default budget for AI_DAILY_LIMIT=%j',
    async (value) => {
      sdk.generateContent.mockResolvedValue(modelReply(JSON.stringify(ADVICE)));
      const handler = handlerFromEnv({ GEMINI_API_KEY: 'k', AI_DAILY_LIMIT: value });
      for (let i = 0; i < 3; i += 1) {
        const body = {
          ...PLAN_BODY,
          profile: {
            ...SAMPLE_PROFILE,
            place: { ...SAMPLE_PROFILE.place, name: `Town ${String(i)}` },
          },
        };
        expect((await handler(plan(body))).status).toBe(200);
      }
    },
  );

  it('logs limiter_fallback once, as a warning, when no store is configured', () => {
    handlerFromEnv({});
    expect(warn).toHaveBeenCalledOnce();
    expect(JSON.parse(String(warn.mock.calls[0]?.[0]))).toEqual({
      event: 'limiter_fallback',
      reason: 'not_configured',
    });
  });

  it('treats a store with only a URL, or only a token, or blank values, as not configured', () => {
    handlerFromEnv({ KV_REST_API_URL: 'https://store.example' });
    handlerFromEnv({ KV_REST_API_TOKEN: 'token' });
    handlerFromEnv({ KV_REST_API_URL: '  ', KV_REST_API_TOKEN: '  ' });
    expect(warn).toHaveBeenCalledTimes(3);
  });

  it.each([
    [
      'the KV names',
      { KV_REST_API_URL: 'https://kv.example', KV_REST_API_TOKEN: 'kv-token' },
      'kv-token',
    ],
    [
      'the Upstash names',
      { UPSTASH_REDIS_REST_URL: 'https://up.example', UPSTASH_REDIS_REST_TOKEN: 'up-token' },
      'up-token',
    ],
    [
      'KV over Upstash',
      {
        KV_REST_API_URL: 'https://kv.example',
        KV_REST_API_TOKEN: 'kv-token',
        UPSTASH_REDIS_REST_URL: 'https://up.example',
        UPSTASH_REDIS_REST_TOKEN: 'up-token',
      },
      'kv-token',
    ],
  ])('counts requests in the shared store named by %s', async (_name, env, token) => {
    const seen: { url: string; auth: string | null }[] = [];
    const fetchStub = (url: string, init?: RequestInit): Promise<Response> => {
      seen.push({ url, auth: new Headers(init?.headers).get('authorization') });
      return Promise.resolve(
        url.endsWith('/pipeline')
          ? Response.json([{ result: 1 }, { result: 1 }])
          : new Response('', { status: 503 }),
      );
    };
    vi.stubGlobal('fetch', fetchStub);
    const response = await handlerFromEnv(env)(get('/api/air?lat=28&lon=77'));
    expect(response.status).toBe(200);
    expect(warn).not.toHaveBeenCalled();
    expect(seen[0]).toEqual({
      url: `https://${token === 'kv-token' ? 'kv' : 'up'}.example/pipeline`,
      auth: `Bearer ${token}`,
    });
    // Open-Meteo is unreachable in this stub, so the sample forecast keeps the route working.
    expect(await response.json()).toMatchObject({ source: 'sample' });
  });
});
