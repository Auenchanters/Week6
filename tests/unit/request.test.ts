/**
 * The request gate, step by step: transport (content type, origin, declared size), the streamed
 * body (size, JSON, strict schema, field paths), the largest realistic request against the size
 * cap, and the strict query reader.
 */
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import {
  MAX_BODY_BYTES,
  readJsonBody,
  readQuery,
  validateTransport,
} from '../../server/request.js';
import { LIMITS } from '../../src/shared/limits.js';
import { SAMPLE_PROFILE } from '../../src/shared/samples.js';
import {
  askRequestSchema,
  type Activity,
  type AirHour,
  type Forecast,
  type Member,
  type Profile,
} from '../../src/shared/schema.js';

const URL_ = 'https://clearday.example/api/plan';
const OWN = { origin: 'https://clearday.example' };
const post = (body: BodyInit | null, headers: Record<string, string> = {}) =>
  new Request(URL_, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body,
  });

/** A body stream with no Content-Length, delivered in `chunks` pieces of `size` bytes. */
function streamed(chunks: number, size: number, onCancel?: () => void): ReadableStream<Uint8Array> {
  let sent = 0;
  return new ReadableStream({
    pull(controller) {
      if (sent === chunks) {
        controller.close();
        return;
      }
      sent += 1;
      controller.enqueue(new Uint8Array(size).fill(0x20));
    },
    cancel() {
      onCancel?.();
    },
  });
}

/** A POST init for a streamed body; Node requires `duplex`, which the DOM typings lack. */
function streamInit(body: ReadableStream<Uint8Array>): RequestInit {
  const init = { method: 'POST', body, duplex: 'half' };
  return init;
}

describe('validateTransport', () => {
  it('accepts JSON (any case, with a charset) from this origin', () => {
    expect(() => {
      validateTransport(post('{}', OWN), undefined);
    }).not.toThrow();
    const charset = { ...OWN, 'content-type': 'Application/JSON; charset=utf-8' };
    expect(() => {
      validateTransport(post('{}', charset), undefined);
    }).not.toThrow();
    for (const site of ['same-origin', 'same-site', 'none']) {
      const headers = { ...OWN, 'sec-fetch-site': site };
      expect(() => {
        validateTransport(post('{}', headers), undefined);
      }).not.toThrow();
    }
  });

  it.each(['text/plain', 'application/jsonp', 'multipart/form-data'])(
    'rejects %s with 415',
    (type) => {
      expect(() => {
        validateTransport(post('{}', { ...OWN, 'content-type': type }), undefined);
      }).toThrow(expect.objectContaining({ code: 'JSON_REQUIRED', status: 415 }));
    },
  );

  it('rejects a request with no content type with 415', () => {
    const request = new Request(URL_, { method: 'POST', headers: OWN });
    expect(() => {
      validateTransport(request, undefined);
    }).toThrow(expect.objectContaining({ code: 'JSON_REQUIRED' }));
  });

  it.each([
    ['an absent Origin', {}],
    ['an empty Origin', { origin: '' }],
    ['an opaque Origin', { origin: 'null' }],
    ['a foreign Origin', { origin: 'https://evil.example' }],
    ['a look-alike Origin', { origin: 'https://clearday.example.evil.example' }],
    ['a different scheme', { origin: 'http://clearday.example' }],
    ['a cross-site fetch', { ...OWN, 'sec-fetch-site': 'cross-site' }],
  ])('rejects %s with 403', (_name, headers) => {
    expect(() => {
      validateTransport(post('{}', headers), undefined);
    }).toThrow(expect.objectContaining({ code: 'ORIGIN_REJECTED', status: 403 }));
  });

  it('accepts the configured APP_ORIGIN as well as its own', () => {
    const app = 'https://app.example';
    expect(() => {
      validateTransport(post('{}', { origin: app }), app);
    }).not.toThrow();
    expect(() => {
      validateTransport(post('{}', OWN), app);
    }).not.toThrow();
    expect(() => {
      validateTransport(post('{}', { origin: app }), undefined);
    }).toThrow(expect.objectContaining({ code: 'ORIGIN_REJECTED' }));
  });

  it('rejects a declared length over the cap with 413, and takes one at the cap', () => {
    const over = post('{}', { ...OWN, 'content-length': String(MAX_BODY_BYTES + 1) });
    expect(() => {
      validateTransport(over, undefined);
    }).toThrow(expect.objectContaining({ code: 'BODY_TOO_LARGE', status: 413 }));
    const at = post('{}', { ...OWN, 'content-length': String(MAX_BODY_BYTES) });
    expect(() => {
      validateTransport(at, undefined);
    }).not.toThrow();
  });

  it('checks type, then origin, then declared size', () => {
    const everything = { 'content-type': 'text/plain', 'content-length': '99999999' };
    expect(() => {
      validateTransport(post('{}', everything), undefined);
    }).toThrow(expect.objectContaining({ code: 'JSON_REQUIRED' }));
    const noOrigin = { 'content-length': '99999999' };
    expect(() => {
      validateTransport(post('{}', noOrigin), undefined);
    }).toThrow(expect.objectContaining({ code: 'ORIGIN_REJECTED' }));
  });
});

describe('readJsonBody', () => {
  const schema = z.strictObject({ n: z.number() });

  it('parses and validates a body', async () => {
    await expect(readJsonBody(post('{"n":1}'), schema)).resolves.toEqual({ n: 1 });
  });

  it('decodes multi-byte text split across chunks', async () => {
    const bytes = new TextEncoder().encode('{"n":"héllo ✓"}');
    const cut = bytes.indexOf(0xc3) + 1; // between the two bytes of "é"
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(bytes.slice(0, cut));
        controller.enqueue(bytes.slice(cut));
        controller.close();
      },
    });
    const request = new Request(URL_, streamInit(body));
    await expect(readJsonBody(request, z.object({ n: z.string() }))).resolves.toEqual({
      n: 'héllo ✓',
    });
  });

  it('answers a missing body with INVALID_JSON', async () => {
    const request = new Request(URL_, { method: 'POST' });
    await expect(readJsonBody(request, schema)).rejects.toMatchObject({ code: 'INVALID_JSON' });
  });

  it.each(['{not json', '', '{"n":1}{"n":2}', 'undefined'])(
    'rejects %j as INVALID_JSON',
    async (text) => {
      await expect(readJsonBody(post(text), schema)).rejects.toMatchObject({
        code: 'INVALID_JSON',
        status: 400,
      });
    },
  );

  it('reads a body of exactly the cap and rejects one byte more, cancelling the stream', async () => {
    const quoted = (size: number) => `"${'a'.repeat(size - 2)}"`;
    await expect(readJsonBody(post(quoted(MAX_BODY_BYTES)), z.string())).resolves.toHaveLength(
      MAX_BODY_BYTES - 2,
    );
    await expect(readJsonBody(post(quoted(MAX_BODY_BYTES + 1)), z.string())).rejects.toMatchObject({
      code: 'BODY_TOO_LARGE',
      status: 413,
    });
  });

  it('stops reading a stream with no length once it passes the cap', async () => {
    let cancelled = false;
    const body = streamed(1000, 1024, () => {
      cancelled = true;
    });
    const request = new Request(URL_, streamInit(body));
    await expect(readJsonBody(request, schema)).rejects.toMatchObject({ code: 'BODY_TOO_LARGE' });
    expect(cancelled).toBe(true);
  });

  it('names failing fields by dotted path, without echoing their values', async () => {
    const nested = z.strictObject({ a: z.array(z.strictObject({ b: z.number() })) });
    const failure = await readJsonBody(post('{"a":[{"b":"SECRET"}]}'), nested).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ code: 'INVALID_REQUEST', detail: { fields: ['a.0.b'] } });
    expect(JSON.stringify(failure)).not.toContain('SECRET');
  });

  it('calls a whole-body failure "body", and lists a field once', async () => {
    await expect(readJsonBody(post('[]'), schema)).rejects.toMatchObject({
      detail: { fields: ['body'] },
    });
    const twice = z.number().min(5).max(1);
    await expect(readJsonBody(post('3'), twice)).rejects.toMatchObject({
      detail: { fields: ['body'] },
    });
  });

  it('names an unknown key and caps the list at ten fields', async () => {
    await expect(readJsonBody(post('{"n":1,"extra":2}'), schema)).rejects.toMatchObject({
      detail: { fields: ['body'] },
    });
    const many = JSON.stringify(Array.from({ length: 12 }, () => 'x'));
    const failure = await readJsonBody(post(many), z.array(z.number())).catch(
      (error: unknown) => error,
    );
    expect(failure).toMatchObject({ code: 'INVALID_REQUEST' });
    const fields = z.object({ detail: z.object({ fields: z.array(z.string()) }) }).parse(failure)
      .detail.fields;
    expect(fields).toEqual(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);
  });
});

/** The largest request the schema admits: every list full, every string near its cap. */
function biggestRequest(): { profile: Profile; forecast: Forecast; dayIndex: 1; question: string } {
  const P = LIMITS.profile;
  const members: Member[] = Array.from({ length: P.membersMax }, (_, i) => ({
    id: `member-${String(i)}`,
    name: 'Ñ'.repeat(P.memberNameMax),
    age: 'senior',
    conditions: ['asthma', 'heart-lung', 'pregnant'],
    away: { from: 10, to: 18 },
  }));
  const activities: Activity[] = Array.from({ length: P.activitiesMax }, (_, i) => ({
    id: `activity-${String(i)}`,
    kind: 'school-run',
    memberIds: members.map((m) => m.id),
    startHour: 7,
    durationMinutes: 600,
    mode: 'car-recirculation',
    distanceKm: 119.99,
    daysPerWeek: 7,
    window: { earliest: 6, latest: 17 },
  }));
  const profile: Profile = {
    place: { name: 'P'.repeat(P.placeNameMax), latitude: -89.123456789, longitude: -179.123456789 },
    language: 'hi',
    members,
    home: SAMPLE_PROFILE.home,
    activities,
  };
  const hours: AirHour[] = Array.from({ length: LIMITS.forecast.hours }, (_, i) => ({
    time: `2026-11-${i < 24 ? '18' : '19'}T${String(i % 24).padStart(2, '0')}:00`,
    pm25: 4999.99,
    pm10: 4999.99,
    no2: 4999.99,
    o3: 4999.99,
    co: 4.99999,
    so2: 4999.99,
  }));
  return {
    profile,
    forecast: { source: 'open-meteo', timezone: 'America/Argentina/ComodRivadavia', hours },
    dayIndex: 1,
    question: 'q'.repeat(LIMITS.ai.questionMax),
  };
}

describe('the maximum-size request', () => {
  it('is a valid ask request that fits under the body cap with room to spare', async () => {
    const body = JSON.stringify(biggestRequest());
    expect(new TextEncoder().encode(body).byteLength).toBeLessThan(MAX_BODY_BYTES);
    const request = post(body, { ...OWN, 'content-length': String(body.length) });
    expect(() => {
      validateTransport(request, undefined);
    }).not.toThrow();
    const read = await readJsonBody(request, askRequestSchema);
    expect(read.profile.members).toHaveLength(LIMITS.profile.membersMax);
    expect(read.profile.activities).toHaveLength(LIMITS.profile.activitiesMax);
    expect(read.forecast.hours).toHaveLength(LIMITS.forecast.hours);
    expect(read.question).toHaveLength(LIMITS.ai.questionMax);
  });
});

describe('readQuery', () => {
  const schema = z.strictObject({ n: z.coerce.number().min(0).max(10) });
  const get = (query: string) => new Request(`https://clearday.example/api/x${query}`);

  it('reads and coerces valid parameters', () => {
    expect(readQuery(get('?n=4'), schema)).toEqual({ n: 4 });
  });

  it.each([
    ['a missing parameter', ''],
    ['an out-of-range value', '?n=11'],
    ['a non-number', '?n=abc'],
    ['an extra parameter', '?n=4&x=1'],
  ])('rejects %s with 400 and names the fields', (_name, query) => {
    expect(() => readQuery(get(query), schema)).toThrow(
      expect.objectContaining({ code: 'INVALID_REQUEST', status: 400 }),
    );
  });

  it('names the failing field, and the unknown key as the whole body', () => {
    expect(() => readQuery(get('?n=99'), schema)).toThrow(
      expect.objectContaining({ detail: { fields: ['n'] } }),
    );
    expect(() => readQuery(get('?n=1&x=1'), schema)).toThrow(
      expect.objectContaining({ detail: { fields: ['body'] } }),
    );
  });

  it('lets the last of a repeated parameter win and never reads the fragment', () => {
    expect(readQuery(get('?n=1&n=5#n=9'), schema)).toEqual({ n: 5 });
  });
});
