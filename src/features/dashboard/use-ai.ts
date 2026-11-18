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
import { requestAdvice, requestAnswer, type PlanInput } from '../client/api.js';

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

/** Advice for the plan, fetched on demand. */
export function useAdvice(
  input: PlanInput,
  onMeta: (meta: AiMeta) => void,
): { advice: Advice | null; loading: boolean; error: string; fetchAdvice: () => void } {
  const [slot, setSlot] = useState<Slot<Advice | null>>(idle(null));
  const next = useCancel();
  const mine = slot.plan === input.plan ? slot : idle(null);
  const fetchAdvice = (): void => {
    const { plan } = input;
    setSlot({ plan, loading: true, error: '', value: null });
    const signal = next();
    void requestAdvice(input, signal).then((result) => {
      if (signal.aborted) return;
      if (result.ok) onMeta(result.value.meta);
      setSlot(
        result.ok
          ? { plan, loading: false, error: '', value: result.value.advice }
          : { plan, loading: false, error: result.error.message, value: null },
      );
    });
  };
  return { advice: mine.value, loading: mine.loading, error: mine.error, fetchAdvice };
}

/** Questions and answers about the plan, asked on demand. */
export function useAsk(
  input: PlanInput,
  onMeta: (meta: AiMeta) => void,
): { exchanges: readonly Exchange[]; loading: boolean; error: string; ask: (q: string) => void } {
  const [slot, setSlot] = useState<Slot<readonly Exchange[]>>(idle([]));
  const next = useCancel();
  const mine = slot.plan === input.plan ? slot : idle([]);
  const ask = (question: string): void => {
    const { plan } = input;
    setSlot({ ...mine, plan, loading: true, error: '' });
    const signal = next();
    void requestAnswer(input, question, signal).then((result) => {
      if (signal.aborted) return;
      if (result.ok) onMeta(result.value.meta);
      setSlot(
        result.ok
          ? {
              plan,
              loading: false,
              error: '',
              value: [...mine.value, { question, answer: result.value.answer }],
            }
          : { ...mine, plan, loading: false, error: result.error.message },
      );
    });
  };
  return { exchanges: mine.value, loading: mine.loading, error: mine.error, ask };
}
