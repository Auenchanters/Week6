/**
 * The reply to a model route: from the answer cache when the same prompt was answered before,
 * otherwise one model call, read and fact-checked by the route's parser.
 * Does: count a real call against the daily budget before making it (the provider bills a failed
 * call too), make it inside the concurrency gate, note tokens on the request's log facts, and
 * return the parsed value with this request's own call metadata.
 * Never does: retry, cache metadata, or let model text out without its parser.
 */
import type { z } from 'zod';
import { factsFor } from '../src/ai/facts.js';
import { factIds, type Prompt } from '../src/ai/prompt.js';
import { buildDayPlan, type DayPlan } from '../src/domain/plan.js';
import {
  aiMetaSchema,
  type AdviceRequest,
  type AiMeta,
  type FactIds,
} from '../src/shared/schema.js';
import type { Read } from './answer.js';
import { noStoreJson, type Deps, type InFlight, type RouteHandler } from './context.js';
import { AppError } from './errors.js';
import { guardedGeneration } from './model-call.js';
import type { Generation } from './provider.js';
import { readJsonBody } from './request.js';

/** One model job: the prompt, the fact ids its answer may cite, how to read it, and its body key. */
export interface Job<T> {
  readonly prompt: Prompt;
  readonly ids: FactIds;
  readonly parse: (text: string, ids: FactIds) => Read<T>;
  readonly key: 'advice' | 'answer';
}

/** A finished model call and how long it took, in whole milliseconds. */
interface Generated {
  readonly generation: Generation;
  readonly latencyMs: number;
}

/** What one reply cost: the model call's latency and tokens. */
interface Usage {
  readonly latencyMs: number;
  readonly inputTokens: number;
  readonly outputTokens: number;
}

/** A reply from the cache made no model call, so it cost nothing. */
const FROM_CACHE: Usage = { latencyMs: 0, inputTokens: 0, outputTokens: 0 };

const usageOf = ({ generation, latencyMs }: Generated): Usage => ({
  latencyMs,
  inputTokens: generation.inputTokens,
  outputTokens: generation.outputTokens,
});

/**
 * One real model call for `prompt`: counted against the daily budget before it is made (the
 * provider bills a failed call too) and made inside the concurrency gate. Returns the generation
 * and its latency, with token counts noted on the trace.
 */
async function generateFor(deps: Deps, call: InFlight, prompt: Prompt): Promise<Generated> {
  const { generate } = deps;
  if (!generate) throw new AppError('AI_NOT_CONFIGURED');
  const { request, trace } = call;
  request.signal.throwIfAborted();
  await deps.limits.aiCall(deps.now().getTime());
  const started = performance.now();
  const generation = await guardedGeneration(
    () => deps.withCapacity(() => generate(prompt, request.signal)),
    trace,
  );
  trace.inputTokens = generation.inputTokens;
  trace.outputTokens = generation.outputTokens;
  // A cut-off answer rarely parses; if one does, what it holds is still used.
  if (generation.truncated === true) trace.event = 'truncated';
  return { generation, latencyMs: Math.round(performance.now() - started) };
}

/**
 * The call metadata returned with an answer. Checked at runtime too: a bad model id or token count
 * must not reach the client's store.
 */
function callMeta(deps: Deps, call: InFlight, usage: Usage, dropped: number): AiMeta {
  const meta = aiMetaSchema.safeParse({
    model: deps.model,
    ...usage,
    dropped,
    requestId: call.requestId,
  });
  if (!meta.success) throw new AppError('INVALID_RESPONSE');
  return meta.data;
}

/**
 * The answer to `job`: from the cache when the same prompt was answered before, otherwise one
 * model call read by `job.parse`. The body holds the parsed value under `job.key` plus this
 * request's own metadata (a cached reply reports its own request id and no model cost).
 */
async function answer<T>(deps: Deps, call: InFlight, job: Job<T>): Promise<Response> {
  const cached = deps.cache.get(job.prompt);
  if (cached !== undefined) {
    call.trace.cached = true;
    const meta = callMeta(deps, call, FROM_CACHE, cached.dropped);
    return noStoreJson({ [job.key]: cached.value, meta });
  }
  const made = await generateFor(deps, call, job.prompt);
  const read = job.parse(made.generation.text, job.ids);
  if (read.dropped > 0) call.trace.dropped = read.dropped;
  deps.cache.set(job.prompt, read);
  return noStoreJson({
    [job.key]: read.value,
    meta: callMeta(deps, call, usageOf(made), read.dropped),
  });
}

/**
 * A route that asks the model: read and validate the body, rebuild the day plan from it with the
 * same engine the browser ran, then answer the job `toJob` phrases from that plan. The facts the
 * model may cite are always the plan's own.
 */
export function modelRoute<B extends AdviceRequest, T>(
  schema: z.ZodType<B>,
  toJob: (plan: DayPlan, body: B) => Omit<Job<T>, 'ids'>,
): RouteHandler {
  return async (deps, call) => {
    const body = await readJsonBody(call.request, schema);
    const plan = buildDayPlan(body.profile, body.forecast, body.dayIndex);
    return answer(deps, call, { ...toJob(plan, body), ids: factIds(factsFor(plan, body.profile)) });
  };
}
