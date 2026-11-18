/**
 * The Gemini adapter, with the SDK mocked so no test touches the network.
 * Does: pins the request config (structured JSON, fixed instruction, bounded output, minimal
 * thinking, abort propagation), the one-time client construction and the token mapping.
 */
import { ApiError, FinishReason, ThinkingLevel } from '@google/genai';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createGeminiGenerator } from '../../server/provider.js';
import type { Prompt } from '../../src/ai/prompt.js';

const mocks = vi.hoisted(() => ({ construct: vi.fn(), generateContent: vi.fn() }));
vi.mock('@google/genai', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@google/genai')>()),
  GoogleGenAI: class {
    models = { generateContent: mocks.generateContent };
    constructor(options: unknown) {
      mocks.construct(options);
    }
  },
}));

const prompt: Prompt = {
  system: 'fixed instruction',
  user: '{"facts":[]}',
  schema: { type: 'object' },
};

describe('createGeminiGenerator', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.generateContent.mockResolvedValue({
      text: '{"summary":""}',
      usageMetadata: { promptTokenCount: 271, candidatesTokenCount: 424, thoughtsTokenCount: 6 },
    });
  });

  it('builds the client once, with a 25 s timeout and no SDK retries', async () => {
    const generate = createGeminiGenerator('test-key-not-a-secret', 'gemini-3.5-flash-lite');
    const signal = new AbortController().signal;
    await generate(prompt, signal);
    await generate(prompt, signal);
    expect(mocks.construct).toHaveBeenCalledOnce();
    expect(mocks.construct).toHaveBeenCalledWith({
      apiKey: 'test-key-not-a-secret',
      httpOptions: { timeout: 25_000, retryOptions: { attempts: 1 } },
    });
    expect(mocks.generateContent).toHaveBeenCalledTimes(2);
  });

  it('asks for schema-constrained JSON with bounded output, minimal thinking and the caller signal', async () => {
    const signal = new AbortController().signal;
    await createGeminiGenerator('test-key-not-a-secret', 'gemini-3.5-flash-lite')(prompt, signal);
    expect(mocks.generateContent).toHaveBeenCalledWith({
      model: 'gemini-3.5-flash-lite',
      contents: prompt.user,
      config: {
        systemInstruction: prompt.system,
        responseMimeType: 'application/json',
        responseJsonSchema: prompt.schema,
        maxOutputTokens: 4096,
        temperature: 0.7,
        thinkingConfig: { thinkingLevel: ThinkingLevel.MINIMAL },
        abortSignal: signal,
      },
    });
  });

  it('returns the text and maps usage, counting thinking tokens as output', async () => {
    const generate = createGeminiGenerator('test-key-not-a-secret', 'm');
    await expect(generate(prompt, new AbortController().signal)).resolves.toEqual({
      text: '{"summary":""}',
      inputTokens: 271,
      outputTokens: 430,
      truncated: false,
    });
  });

  it('reports an answer that stopped at the output cap as truncated', async () => {
    const generate = createGeminiGenerator('test-key-not-a-secret', 'm');
    for (const [finishReason, truncated] of [
      [FinishReason.MAX_TOKENS, true],
      [FinishReason.STOP, false],
    ] as const) {
      mocks.generateContent.mockResolvedValue({ text: '{"sum', candidates: [{ finishReason }] });
      await expect(generate(prompt, new AbortController().signal)).resolves.toMatchObject({
        truncated,
      });
    }
  });

  it('defaults missing text and usage to empty and zero', async () => {
    mocks.generateContent.mockResolvedValue({});
    const generate = createGeminiGenerator('test-key-not-a-secret', 'm');
    await expect(generate(prompt, new AbortController().signal)).resolves.toEqual({
      text: '',
      inputTokens: 0,
      outputTokens: 0,
      truncated: false,
    });
  });

  it('lets SDK errors through untouched for the handler to classify', async () => {
    const failure = Object.assign(new Error('quota detail'), { status: 429 });
    mocks.generateContent.mockRejectedValue(failure);
    const generate = createGeminiGenerator('test-key-not-a-secret', 'm');
    await expect(generate(prompt, new AbortController().signal)).rejects.toBe(failure);
  });

  describe('when Gemini is overloaded (503)', () => {
    const overloaded = () => new ApiError({ message: 'overloaded', status: 503 });
    beforeEach(() => vi.useFakeTimers());
    afterEach(() => vi.useRealTimers());

    it('retries once after a pause and returns the second answer', async () => {
      mocks.generateContent.mockRejectedValueOnce(overloaded());
      const pending = createGeminiGenerator('k', 'm')(prompt, new AbortController().signal);
      await vi.advanceTimersByTimeAsync(1500);
      await expect(pending).resolves.toMatchObject({ inputTokens: 271 });
      expect(mocks.generateContent).toHaveBeenCalledTimes(2);
    });

    it('gives up after the one retry', async () => {
      mocks.generateContent.mockRejectedValue(overloaded());
      const pending = createGeminiGenerator('k', 'm')(prompt, new AbortController().signal);
      const settled = expect(pending).rejects.toMatchObject({ status: 503 });
      await vi.advanceTimersByTimeAsync(1500);
      await settled;
      expect(mocks.generateContent).toHaveBeenCalledTimes(2);
    });

    it('does not retry once the caller has gone', async () => {
      mocks.generateContent.mockRejectedValueOnce(overloaded());
      const controller = new AbortController();
      const pending = createGeminiGenerator('k', 'm')(prompt, controller.signal);
      const settled = expect(pending).rejects.toBeDefined();
      controller.abort();
      await vi.advanceTimersByTimeAsync(1500);
      await settled;
      expect(mocks.generateContent).toHaveBeenCalledOnce();
    });

    it('does not retry a refusal that took too long to arrive', async () => {
      mocks.generateContent.mockImplementationOnce(
        () =>
          new Promise((_, reject) => {
            setTimeout(() => {
              reject(overloaded());
            }, 4000);
          }),
      );
      const pending = createGeminiGenerator('k', 'm')(prompt, new AbortController().signal);
      const settled = expect(pending).rejects.toMatchObject({ status: 503 });
      await vi.advanceTimersByTimeAsync(6000);
      await settled;
      expect(mocks.generateContent).toHaveBeenCalledOnce();
    });

    it('never retries any other failure', async () => {
      mocks.generateContent.mockRejectedValueOnce(new ApiError({ message: 'bad', status: 400 }));
      await expect(
        createGeminiGenerator('k', 'm')(prompt, new AbortController().signal),
      ).rejects.toMatchObject({ status: 400 });
      expect(mocks.generateContent).toHaveBeenCalledOnce();
    });
  });
});
