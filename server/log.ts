/**
 * One structured log line per API request, and one for each limiter fallback.
 * Does: write a JSON line of ids, numbers and fixed labels: `console.info` normally,
 * `console.error` for a 5xx, `console.warn` when the rate limits fall back to memory.
 * Never does: log household details, questions, model text, provider messages, request paths or IP addresses; the
 * line's type only has room for the fields below.
 */
import type { ErrorCode } from './errors.js';

/** The API's routes. */
export type Route = '/api/plan' | '/api/ask' | '/api/air' | '/api/places' | '/api/health';

/** What a request learns about itself as handling proceeds; every field is optional. */
export interface RequestFacts {
  /** `internal` marks an unexpected fault (a bug), so it can be traced without its message. */
  kind?: 'internal';
  /** Something worth noticing: `truncated` when the model hit its output cap. */
  event?: 'truncated';
  /** The answer came from the cache, so no model call was made. */
  cached?: true;
  /** Where a forecast came from: live Open-Meteo data or the bundled sample. */
  source?: 'open-meteo' | 'sample';
  inputTokens?: number;
  outputTokens?: number;
  /** Items of the model's answer left out because they failed the schema; absent when none. */
  dropped?: number;
  /** The model provider's HTTP status when a call failed (a number only, never its message). */
  providerStatus?: number;
  /** Why the provider refused, as a fixed label derived from its error; never the text itself. */
  providerReason?: 'api-key' | 'schema' | 'other';
}

/** Everything a request log line may hold. */
export interface RequestLog extends Readonly<RequestFacts> {
  readonly requestId: string;
  /** A known route, or `unknown`; never the raw path. */
  readonly route: Route | 'unknown';
  readonly status: number;
  readonly code?: ErrorCode;
  readonly latencyMs: number;
}

/** Writes one request's log line. */
export function logRequest(line: RequestLog): void {
  const text = JSON.stringify(line);
  if (line.status >= 500) console.error(text);
  else console.info(text);
}

/**
 * An infrastructure event, not tied to one request: the rate limits fell back to this instance's
 * memory because no shared store is configured, or because it failed or timed out.
 */
export interface EventLog {
  readonly event: 'limiter_fallback';
  readonly reason: 'not_configured' | 'error' | 'timeout';
}

/** Writes one event's log line, as a warning. */
export function logEvent(line: EventLog): void {
  console.warn(JSON.stringify(line));
}
