/**
 * The air client: gap filling, the Open-Meteo conversion (with CO in mg/m³), the IST sample dates,
 * the 30-minute grid-cell cache, the sample fallback for every upstream failure, and place search.
 * Never calls the network; the fetch and the clock are injected.
 */
import { describe, expect, it, vi } from 'vitest';
import {
  createAirClient,
  fillGaps,
  sampleDates,
  toForecast,
  type Fetch,
} from '../../server/air.js';
import { sampleForecast } from '../../server/sample-forecast.js';

const HOURS = 48;
const START = new Date('2026-11-18T06:00:00Z');
const MINUTE = 60_000;

const timeAxis = (length: number): string[] =>
  Array.from(
    { length },
    (_, i) => `2026-11-${i < 24 ? '18' : '19'}T${String(i % 24).padStart(2, '0')}:00`,
  );

/** An Open-Meteo air-quality answer with 48 rows; `patch` replaces any hourly column. */
function openMeteo(patch: Record<string, unknown> = {}, timezone = 'Asia/Kolkata'): unknown {
  const column = (value: number) => Array.from({ length: HOURS }, () => value);
  return {
    timezone,
    hourly: {
      time: timeAxis(HOURS),
      pm2_5: column(120),
      pm10: column(200),
      nitrogen_dioxide: column(40),
      ozone: column(30),
      carbon_monoxide: column(1500),
      sulphur_dioxide: column(10),
      ...patch,
    },
  };
}

const ok = (body: unknown): Response => new Response(JSON.stringify(body));
const fetching = (answer: () => Promise<Response>) => vi.fn<Fetch>(answer);

/** A client over a clock the test can move. */
function clientWith(fetchImpl: Fetch) {
  let at = START.getTime();
  const client = createAirClient(fetchImpl, () => new Date(at));
  return {
    client,
    advance: (ms: number) => {
      at += ms;
    },
  };
}

describe('fillGaps', () => {
  it('carries the last value over a gap and back-fills a leading one', () => {
    expect(fillGaps([null, null, 4, null, 6, null])).toEqual([4, 4, 4, 4, 6, 6]);
  });

  it('keeps zero as a real value', () => {
    expect(fillGaps([0, null, 2])).toEqual([0, 0, 2]);
  });

  it('is null when no hour is present, even for an empty series', () => {
    expect(fillGaps([null, null])).toBeNull();
    expect(fillGaps([])).toBeNull();
  });
});

describe('toForecast', () => {
  it('maps a valid answer, converting CO from µg/m³ to mg/m³', () => {
    const forecast = toForecast(openMeteo());
    expect(forecast?.source).toBe('open-meteo');
    expect(forecast?.timezone).toBe('Asia/Kolkata');
    expect(forecast?.hours).toHaveLength(HOURS);
    expect(forecast?.hours[0]).toEqual({
      time: '2026-11-18T00:00',
      pm25: 120,
      pm10: 200,
      no2: 40,
      o3: 30,
      co: 1.5,
      so2: 10,
    });
    expect(forecast?.hours[47]?.time).toBe('2026-11-19T23:00');
  });

  it('fills a gap in a column from its neighbour', () => {
    const pm2_5 = Array.from({ length: HOURS }, (_, i) => (i === 5 ? null : i));
    expect(toForecast(openMeteo({ pm2_5 }))?.hours[5]?.pm25).toBe(4);
  });

  it.each([
    ['not an object', 'nope'],
    ['no hourly block', { timezone: 'Asia/Kolkata' }],
    ['a column of the wrong type', openMeteo({ ozone: 'x' })],
    ['a missing column', openMeteo({ ozone: undefined })],
    ['no timezone', { hourly: {} }],
  ])('is null for %s', (_name, json) => {
    expect(toForecast(json)).toBeNull();
  });

  it('is null when the series is not 48 hours', () => {
    expect(toForecast(openMeteo())).not.toBeNull();
    expect(toForecast(openMeteo({ time: timeAxis(47) }))).toBeNull();
  });

  it('is null when a whole column is missing data', () => {
    const empty = Array.from({ length: HOURS }, () => null);
    expect(toForecast(openMeteo({ sulphur_dioxide: empty }))).toBeNull();
  });

  it('fills a column shorter than the time axis with 0, then lets the schema judge', () => {
    const pm2_5 = Array.from({ length: 47 }, () => 80);
    const forecast = toForecast(openMeteo({ pm2_5 }));
    expect(forecast?.hours[46]?.pm25).toBe(80);
    expect(forecast?.hours[47]?.pm25).toBe(0);
  });

  it.each([
    ['pm10', 'pm10'],
    ['nitrogen_dioxide', 'no2'],
    ['ozone', 'o3'],
    ['carbon_monoxide', 'co'],
    ['sulphur_dioxide', 'so2'],
  ] as const)('zero-fills a short %s column too', (column, field) => {
    const forecast = toForecast(openMeteo({ [column]: [7] }));
    expect(forecast?.hours[0]?.[field]).toBe(column === 'carbon_monoxide' ? 0.007 : 7);
    expect(forecast?.hours[1]?.[field]).toBe(0);
  });

  it('is null for an implausible concentration or a malformed time', () => {
    const wild = Array.from({ length: HOURS }, () => 5001);
    expect(toForecast(openMeteo({ pm2_5: wild }))).toBeNull();
    const time = Array.from({ length: HOURS }, () => 'yesterday');
    expect(toForecast(openMeteo({ time }))).toBeNull();
  });
});

describe('sampleDates', () => {
  it('is today and tomorrow in India', () => {
    expect(sampleDates(new Date('2026-11-18T06:00:00Z'))).toEqual(['2026-11-18', '2026-11-19']);
  });

  it('rolls over at 18:30 UTC, midnight in India', () => {
    expect(sampleDates(new Date('2026-11-18T18:29:59Z'))).toEqual(['2026-11-18', '2026-11-19']);
    expect(sampleDates(new Date('2026-11-18T18:30:00Z'))).toEqual(['2026-11-19', '2026-11-20']);
  });

  it('crosses a month and a year end', () => {
    expect(sampleDates(new Date('2026-12-31T20:00:00Z'))).toEqual(['2027-01-01', '2027-01-02']);
  });
});

describe('the forecast client', () => {
  it('asks Open-Meteo for the six pollutants over two days in the place time zone', async () => {
    const fetchImpl = fetching(() => Promise.resolve(ok(openMeteo())));
    const { client } = clientWith(fetchImpl);
    const forecast = await client.forecast(28.61271, 77.20899);
    expect(forecast.source).toBe('open-meteo');
    const [url, init] = fetchImpl.mock.calls[0] ?? [];
    const asked = new URL(url ?? '');
    expect(asked.origin + asked.pathname).toBe(
      'https://air-quality-api.open-meteo.com/v1/air-quality',
    );
    expect(asked.searchParams.get('latitude')).toBe('28.61');
    expect(asked.searchParams.get('longitude')).toBe('77.21');
    expect(asked.searchParams.get('hourly')?.split(',')).toEqual([
      'pm2_5',
      'pm10',
      'nitrogen_dioxide',
      'ozone',
      'carbon_monoxide',
      'sulphur_dioxide',
    ]);
    expect(asked.searchParams.get('forecast_days')).toBe('2');
    expect(asked.searchParams.get('timezone')).toBe('auto');
    expect([...asked.searchParams.keys()]).toHaveLength(5);
    expect(init?.signal).toBeInstanceOf(AbortSignal);
  });

  it('serves a repeat from the cache for 30 minutes, then asks again', async () => {
    const fetchImpl = fetching(() => Promise.resolve(ok(openMeteo())));
    const { client, advance } = clientWith(fetchImpl);
    const first = await client.forecast(28.61, 77.21);
    advance(29 * MINUTE + 59_000);
    expect(await client.forecast(28.61, 77.21)).toBe(first);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    advance(1000);
    await client.forecast(28.61, 77.21);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('reads the real clock when none is injected', async () => {
    const down = fetching(() => Promise.reject(new TypeError('fetch failed')));
    const forecast = await createAirClient(down).forecast(28.61, 77.21);
    expect(forecast.source).toBe('sample');
    expect(forecast.hours).toHaveLength(HOURS);
  });

  it('shares one cache entry across a 0.1 degree cell', async () => {
    const fetchImpl = fetching(() => Promise.resolve(ok(openMeteo())));
    const { client } = clientWith(fetchImpl);
    await client.forecast(28.61, 77.21);
    await client.forecast(28.64, 77.24);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await client.forecast(28.71, 77.21);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it.each([
    ['a non-OK status', () => Promise.resolve(new Response('no', { status: 503 }))],
    ['a network error', () => Promise.reject(new TypeError('fetch failed'))],
    ['a body that is not JSON', () => Promise.resolve(new Response('<html>'))],
    ['a body in the wrong shape', () => Promise.resolve(ok({ hourly: 1 }))],
  ])('falls back to the labelled sample for %s, and does not cache it', async (_name, answer) => {
    const fetchImpl = fetching(answer);
    const { client } = clientWith(fetchImpl);
    const forecast = await client.forecast(28.61, 77.21);
    expect(forecast).toEqual(sampleForecast('2026-11-18', '2026-11-19'));
    expect(forecast.source).toBe('sample');
    await client.forecast(28.61, 77.21);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('drops the whole cache when it holds 500 cells', async () => {
    const fetchImpl = fetching(() => Promise.resolve(ok(openMeteo())));
    const { client } = clientWith(fetchImpl);
    for (let i = 0; i <= 500; i += 1) await client.forecast(10, i / 10);
    expect(fetchImpl).toHaveBeenCalledTimes(501);
    await client.forecast(10, 50); // the newest cell survived the clear
    expect(fetchImpl).toHaveBeenCalledTimes(501);
    await client.forecast(10, 0); // the oldest did not
    expect(fetchImpl).toHaveBeenCalledTimes(502);
  });
});

describe('place search', () => {
  const found = (results: unknown) => fetching(() => Promise.resolve(ok({ results })));

  it('asks the geocoder for five English matches of the text', async () => {
    const fetchImpl = found([]);
    await clientWith(fetchImpl).client.places('New Del');
    const [url] = fetchImpl.mock.calls[0] ?? [];
    const asked = new URL(url ?? '');
    expect(asked.origin + asked.pathname).toBe('https://geocoding-api.open-meteo.com/v1/search');
    expect(Object.fromEntries(asked.searchParams)).toEqual({
      name: 'New Del',
      count: '5',
      language: 'en',
      format: 'json',
    });
  });

  it('names each place with its region and country, skipping what is absent', async () => {
    const { client } = clientWith(
      found([
        { name: 'Delhi', admin1: 'Delhi', country: 'India', latitude: 28.65, longitude: 77.22 },
        { name: 'Pune', country: 'India', latitude: 18.5, longitude: 73.86 },
        { name: 'Atlantis', latitude: 1, longitude: 2 },
      ]),
    );
    expect(await client.places('x')).toEqual([
      { name: 'Delhi, Delhi, India', latitude: 28.65, longitude: 77.22 },
      { name: 'Pune, India', latitude: 18.5, longitude: 73.86 },
      { name: 'Atlantis', latitude: 1, longitude: 2 },
    ]);
  });

  it('caps a name at 80 characters', async () => {
    const { client } = clientWith(
      found([{ name: 'x'.repeat(100), country: 'India', latitude: 1, longitude: 2 }]),
    );
    const [place] = await client.places('x');
    expect(place?.name).toHaveLength(80);
  });

  it('answers no matches, or an unexpected shape, with an empty list', async () => {
    const none = fetching(() => Promise.resolve(ok({})));
    expect(await clientWith(none).client.places('zz')).toEqual([]);
    expect(await clientWith(found('nope')).client.places('zz')).toEqual([]);
  });

  it('throws when the geocoder is down, so the route can say so', async () => {
    const down = fetching(() => Promise.resolve(new Response('', { status: 500 })));
    await expect(clientWith(down).client.places('zz')).rejects.toThrow('status 500');
  });
});
