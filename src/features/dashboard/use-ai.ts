/**
 * The two AI actions of the dashboard, each one explicit click and one model call.
 * Does: ask for advice or answer a question about the current plan, keep the result with the plan
 * it was made for (a different plan hides it, so stale advice never sits beside new numbers),
 * report the failure message, cancel a request that is still running when the page goes away, and
 * pass the call's metadata up for the "AI at work" panel.
 * Never does: call the model on its own, retry, or invent text when a call fails.
 */
import { useEffect, useRef, useState } from 'react';
import type { DayPlan } from '../../domain/plan.js';
import type { Advice, AiMeta, AskAnswer } from '../../shared/schema.js';
import { requestAdvice, requestAnswer, type ApiResult, type PlanInput } from '../client/api.js';

/** One question and the AI's answer to it. */
export interface Exchange {
  readonly question: string;
  readonly answer: AskAnswer;
}

/** The state of one AI action for one plan. */
interface Slot<T> {
  readonly plan: DayPlan | null;
  readonly loading: boolean;
  readonly error: string;
  readonly value: T;
}

const idle = <T>(value: T): Slot<T> => ({ plan: null, loading: false, error: '', value });

/** An AbortController that cancels the pending request when the component unmounts. */
function useCancel(): () => AbortSignal {
  const ref = useRef<AbortController | null>(null);
  useEffect(
    () => () => {
      ref.current?.abort();
    },
    [],
  );
  return () => {
    ref.current?.abort();
    ref.current = new AbortController();
    return ref.current.signal;
  };
}

/** One AI action for the current plan: its state, and a runner that starts a call and files the result. */
function usePlanAction<T>(
  input: PlanInput,
  onMeta: (meta: AiMeta) => void,
  empty: T,
): {
  state: Slot<T>;
  run: <R extends { meta: AiMeta }>(
    call: (signal: AbortSignal) => Promise<ApiResult<R>>,
    keep: (value: R, before: T) => T,
  ) => void;
} {
  const [slot, setSlot] = useState<Slot<T>>(idle(empty));
  const next = useCancel();
  // A result made for another plan is hidden, so stale advice never sits beside new numbers.
  const state = slot.plan === input.plan ? slot : idle(empty);
  const run = <R extends { meta: AiMeta }>(
    call: (signal: AbortSignal) => Promise<ApiResult<R>>,
    keep: (value: R, before: T) => T,
  ): void => {
    const { plan } = input;
    setSlot({ ...state, plan, loading: true, error: '' });
    const signal = next();
    void call(signal).then((result) => {
      if (signal.aborted) return;
      if (!result.ok) {
        setSlot({ ...state, plan, loading: false, error: result.error.message });
        return;
      }
      onMeta(result.value.meta);
      setSlot({ plan, loading: false, error: '', value: keep(result.value, state.value) });
    });
  };
  return { state, run };
}

/** Advice for the plan, fetched on demand. */
export function useAdvice(
  input: PlanInput,
  onMeta: (meta: AiMeta) => void,
): { advice: Advice | null; loading: boolean; error: string; fetchAdvice: () => void } {
  const { state, run } = usePlanAction<Advice | null>(input, onMeta, null);
  const fetchAdvice = (): void => {
    run(
      (signal) => requestAdvice(input, signal),
      ({ advice }) => advice,
    );
  };
  return { advice: state.value, loading: state.loading, error: state.error, fetchAdvice };
}

/** Questions and answers about the plan, asked on demand. */
export function useAsk(
  input: PlanInput,
  onMeta: (meta: AiMeta) => void,
): { exchanges: readonly Exchange[]; loading: boolean; error: string; ask: (q: string) => void } {
  const { state, run } = usePlanAction<readonly Exchange[]>(input, onMeta, []);
  const ask = (question: string): void => {
    run(
      (signal) => requestAnswer(input, question, signal),
      ({ answer }, before) => [...before, { question, answer }],
    );
  };
  return { exchanges: state.value, loading: state.loading, error: state.error, ask };
}
