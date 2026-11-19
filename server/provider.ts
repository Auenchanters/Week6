/**
 * The Gemini adapter: one `generateContent` call per prompt through the official SDK.
 * Does: build the SDK client once, ask for schema-constrained JSON with bounded output and minimal
 * thinking, pass the request's abort signal through, and report token usage and whether the
 * answer hit the output cap.
 * Retries exactly once, after a short pause, when Gemini answers 503 (model overloaded) within a
 * few seconds: that refusal is transient and not billed, and a quick one leaves room for a second
 * 25-second call inside the function's 30-second limit. Anything else is never retried.
 * Never does: retry inside the SDK (attempts = 1), log model text, or interpret errors; the
 * handler classifies them without ever echoing their messages.
 */
import {
  ApiError,
  FinishReason,
  GoogleGenAI,
  ThinkingLevel,
  type GenerateContentResponse,
} from '@google/genai';
import type { Prompt } from '../src/ai/prompt.js';

/** What one model call returns. */
export interface Generation {
  readonly text: string;
  readonly inputTokens: number;
  /** Response tokens plus any thinking tokens, since both are billed as output. */
  readonly outputTokens: number;
  /** The model stopped at the output-token cap (`MAX_TOKENS`), so the text is probably cut off. */
  readonly truncated?: boolean;
}

/** One model call; injectable so every handler test runs offline. */
export type Generate = (prompt: Prompt, signal: AbortSignal) => Promise<Generation>;

const TIMEOUT_MS = 25_000;
/**
 * Room for the largest answer the schema allows (every list full, every string at its cap) with
 * margin; a typical answer uses about 1,000.
 */
const MAX_OUTPUT_TOKENS = 4096;
const TEMPERATURE = 0.7;
/** Gemini's "model overloaded" status, and how long to wait before the one retry it earns. */
const OVERLOADED = 503;
const OVERLOAD_PAUSE_MS = 1500;
/** A refusal slower than this leaves no room for a second call inside the 30-second limit. */
const RETRY_WINDOW_MS = 3000;

/**
 * A generator for `model`. The client is created here, once, and reused by every call.
 * Minimal thinking is `thinkingLevel: MINIMAL`; `gemini-3.5-flash-lite` rejects `thinkingBudget: 0`
 * with 400 INVALID_ARGUMENT (checked live on 2026-10-21).
 */
export function createGeminiGenerator(apiKey: string, model: string): Generate {
  const client = new GoogleGenAI({
    apiKey,
    httpOptions: { timeout: TIMEOUT_MS, retryOptions: { attempts: 1 } },
  });
  const call = (prompt: Prompt, signal: AbortSignal) =>
    client.models.generateContent({
      model,
      contents: prompt.user,
      config: {
        systemInstruction: prompt.system,
        responseMimeType: 'application/json',
        responseJsonSchema: prompt.schema,
        maxOutputTokens: MAX_OUTPUT_TOKENS,
        temperature: TEMPERATURE,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        abortSignal: signal,
      },
    });
  return async (prompt, signal) =>
    toGeneration(await withOverloadRetry(() => call(prompt, signal), signal));
}

/** Runs `attempt`; after a fast 503 refusal, pauses and runs it once more. */
async function withOverloadRetry<T>(attempt: () => Promise<T>, signal: AbortSignal): Promise<T> {
  const started = Date.now();
  try {
    return await attempt();
  } catch (error) {
    const overloaded = error instanceof ApiError && error.status === OVERLOADED;
    if (!overloaded || Date.now() - started > RETRY_WINDOW_MS) throw error;
    await new Promise((resolve) => setTimeout(resolve, OVERLOAD_PAUSE_MS));
    signal.throwIfAborted();
    return attempt();
  }
}

/** The text, billed token counts and cut-off flag of one SDK response. */
function toGeneration(response: GenerateContentResponse): Generation {
  const usage = response.usageMetadata;
  return {
    text: response.text ?? '',
    inputTokens: usage?.promptTokenCount ?? 0,
    outputTokens: (usage?.candidatesTokenCount ?? 0) + (usage?.thoughtsTokenCount ?? 0),
    truncated: response.candidates?.[0]?.finishReason === FinishReason.MAX_TOKENS,
  };
}
