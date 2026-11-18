/**
 * The request gates. For `POST /api/plan` and `POST /api/ask`, each step throws a catalogued
 * `AppError`, in this order:
 * 1. method, 405 (the handler's route table);
 * 2. JSON content type, 415;
 * 3. an `Origin` on the allowlist, 403;
 * 4. declared `Content-Length` within the cap, 413;
 * 5. the per-client rate limit, 429 (the handler; GET routes start here);
 * 6. streamed body size within the cap, 413;
 * 7. JSON syntax, 400;
 * 8. the strict request schema (profile, forecast, day, question), 400 `INVALID_REQUEST`.
 * For the GET routes it validates the query string the same strict way.
 * Never does: read more than `MAX_BODY_BYTES`, or echo input back in an error.
 */
import type { z } from 'zod';
import { AppError } from './errors.js';

/**
 * The most body bytes the API will read. A full request (eight members, twelve activities, a
 * 48-hour forecast and a question) is about 12 KB; tests/unit/request.test.ts checks it fits.
 */
export const MAX_BODY_BYTES = 32_768;
const MAX_FIELDS = 10;

/**
 * Steps 2 to 4: rejects a non-JSON content type (415), an `Origin` that is absent, empty, opaque
 * (`null`) or not on the allowlist, or a cross-site fetch (403), and a declared `Content-Length`
 * over the cap (413).
 * The allowlist is the request URL's own origin plus `appOrigin` (`APP_ORIGIN`) when set, so a
 * preview deployment calling itself is accepted. Browsers send `Origin` on every POST, same-origin
 * ones included, and set it truthfully. A script outside a browser can forge it, so this is CSRF
 * hygiene and not an abuse control: the size cap, the strict schema and the rate limit are.
 */
export function validateTransport(request: Request, appOrigin: string | undefined): void {
  const type = request.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
  if (type !== 'application/json') throw new AppError('JSON_REQUIRED');
  const origin = request.headers.get('origin');
  const allowed = [new URL(request.url).origin, appOrigin];
  const foreign = origin === null || !allowed.includes(origin);
  if (foreign || request.headers.get('sec-fetch-site') === 'cross-site')
    throw new AppError('ORIGIN_REJECTED');
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES)
    throw new AppError('BODY_TOO_LARGE');
}

/** The body as text, counting the bytes actually streamed since `Content-Length` is optional. */
async function readBoundedText(request: Request): Promise<string> {
  if (!request.body) return '';
  // Typed explicitly: under Node's typings alone the reader's chunks are `any`.
  const reader: ReadableStreamDefaultReader<Uint8Array> = request.body.getReader();
  const decoder = new TextDecoder();
  let bytes = 0;
  let text = '';
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return text + decoder.decode();
    bytes += chunk.value.byteLength;
    if (bytes > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new AppError('BODY_TOO_LARGE');
    }
    text += decoder.decode(chunk.value, { stream: true });
  }
}

/** A zod issue path as a field name: `profile.members.0.age` stays as it is. */
const fieldOf = (path: readonly PropertyKey[]): string => path.map(String).join('.') || 'body';

/** The field paths of a failed parse, at most ten, for the error's `fields`. */
const fieldsOf = (error: z.ZodError): string[] =>
  [...new Set(error.issues.map((issue) => fieldOf(issue.path)))].slice(0, MAX_FIELDS);

/**
 * Steps 6 to 8: reads at most `MAX_BODY_BYTES` (413), parses JSON (400 `INVALID_JSON`) and
 * validates it strictly against `schema` (400 `INVALID_REQUEST` naming up to ten fields).
 */
export async function readJsonBody<T>(request: Request, schema: z.ZodType<T>): Promise<T> {
  const text = await readBoundedText(request);
  let input: unknown;
  try {
    input = JSON.parse(text);
  } catch {
    throw new AppError('INVALID_JSON');
  }
  const parsed = schema.safeParse(input);
  if (!parsed.success) throw new AppError('INVALID_REQUEST', { fields: fieldsOf(parsed.error) });
  return parsed.data;
}

/** The query string as an object, validated strictly against `schema` (400 `INVALID_REQUEST`). */
export function readQuery<T>(request: Request, schema: z.ZodType<T>): T {
  const query = Object.fromEntries(new URL(request.url).searchParams);
  const parsed = schema.safeParse(query);
  if (!parsed.success) throw new AppError('INVALID_REQUEST', { fields: fieldsOf(parsed.error) });
  return parsed.data;
}
