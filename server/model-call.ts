/**
 * What a failed model call means, for the client and for the log.
 * Does: run one generation; turn a provider failure into a catalogued public code (`AI_BUSY`,
 * `AI_TIMEOUT`, `AI_UNAVAILABLE`) and record the provider's HTTP status and a fixed reason label on
 * the request's log facts.
 * Never does: retry (the provider adapter owns its one overload retry), or keep the provider's
 * error text anywhere.
 */
import { ApiError } from '@google/genai';
import { AppError, type ErrorCode } from './errors.js';
import type { RequestFacts } from './log.js';
import type { Generation } from './provider.js';

/** Why a provider refused, as the fixed label the log carries. */
type RefusalReason = NonNullable<RequestFacts['providerReason']>;

/** A busy provider: the SDK's `ApiError` with 429 (quota spent) or 503 (model overloaded). */
const isBusy = (error: unknown): boolean =>
  error instanceof ApiError && (error.status === 429 || error.status === 503);

/** The SDK's own timeout aborts its fetch, which rejects with an AbortError. */
const isTimeout = (error: unknown): boolean =>
  error instanceof Error && (error.name === 'AbortError' || error.name === 'TimeoutError');

/**
 * The public code for a failed model call, chosen by the error's shape. Inspecting a hostile value
 * (a throwing getter or Proxy trap) must not escape as a 500, so that falls back to unavailable.
 */
function modelFailure(error: unknown): ErrorCode {
  try {
    if (isBusy(error)) return 'AI_BUSY';
    if (isTimeout(error)) return 'AI_TIMEOUT';
  } catch {
    // Fall through: an error we cannot even inspect is just an unavailable provider.
  }
  return 'AI_UNAVAILABLE';
}

/** A fixed label for the provider's error text: the text itself never leaves this function. */
function refusalReason(message: string): RefusalReason {
  if (/api.?key/iu.test(message)) return 'api-key';
  if (/schema|states/iu.test(message)) return 'schema';
  return 'other';
}

/**
 * Records the provider's HTTP status and refusal reason on `trace`. Does nothing for anything that
 * is not the SDK's `ApiError`, or that cannot be inspected.
 */
function noteRefusal(error: unknown, trace: RequestFacts): void {
  try {
    if (!(error instanceof ApiError)) return;
    const reason = refusalReason(error.message);
    trace.providerStatus = error.status;
    trace.providerReason = reason;
  } catch {
    // An uninspectable error leaves the log without provider fields; the public code still follows.
  }
}

/**
 * Runs `call`. A failure is noted on `trace` and rethrown as the public `AppError` for it; an
 * `AppError` the call raised itself (the concurrency gate's `AI_BUSY`) passes through unchanged.
 */
export async function guardedGeneration(
  call: () => Promise<Generation>,
  trace: RequestFacts,
): Promise<Generation> {
  try {
    return await call();
  } catch (error) {
    if (error instanceof AppError) throw error;
    noteRefusal(error, trace);
    throw new AppError(modelFailure(error));
  }
}
