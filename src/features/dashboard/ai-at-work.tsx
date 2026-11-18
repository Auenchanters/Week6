/**
 * "AI at work": what the model is told and what its last answer cost, so nothing is hidden.
 * Does: rebuild the exact system instruction and data JSON the server sends (with the same pure
 * `buildAdvicePrompt`), and show the last response's model, latency, tokens and dropped items.
 * Never does: send anything; it only shows. The text areas are focusable so keyboard users can
 * scroll them.
 */
import { useMemo, type ReactElement } from 'react';
import { buildAdvicePrompt } from '../../ai/prompt.js';
import type { DayPlan } from '../../domain/plan.js';
import type { AiMeta, Profile } from '../../shared/schema.js';
import { whole } from '../../ui/format.js';

/** The AI-at-work disclosure. */
export function AiAtWork(props: {
  readonly plan: DayPlan;
  readonly profile: Profile;
  readonly meta: AiMeta | null;
}): ReactElement {
  const { plan, profile, meta } = props;
  const prompt = useMemo(() => buildAdvicePrompt(plan, profile), [plan, profile]);
  return (
    <section aria-labelledby="ai-title">
      <h2 id="ai-title">AI at work</h2>
      <details>
        <summary>See exactly what the AI is told</summary>
        <p className="muted">
          The model gets these instructions and this data, nothing else. Every number in it was
          computed by Clearday&apos;s engine, not by the model.
        </p>
        <h3>Instruction</h3>
        <pre tabIndex={0}>{prompt.system}</pre>
        <h3>Data</h3>
        <pre tabIndex={0}>{prompt.user}</pre>
        <h3>Last response</h3>
        {meta ? (
          <dl className="stats">
            <div>
              <dt>Model</dt>
              <dd>{meta.model}</dd>
            </div>
            <div>
              <dt>Time</dt>
              <dd>{whole(meta.latencyMs)} ms</dd>
            </div>
            <div>
              <dt>Tokens in / out</dt>
              <dd>
                {whole(meta.inputTokens)} / {whole(meta.outputTokens)}
              </dd>
            </div>
            <div>
              <dt>Items dropped by checks</dt>
              <dd>{meta.dropped}</dd>
            </div>
          </dl>
        ) : (
          <p>No AI call yet. Ask for advice or a question to see its details here.</p>
        )}
      </details>
    </section>
  );
}
