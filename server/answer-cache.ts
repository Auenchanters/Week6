/**
 * Answers to repeated prompts, so a repeat costs no model call.
 * Does: key each answer body by a SHA-256 of the prompt's system and user text; hold at most
 * `max` bodies, and when full drop the least recently used one (a Map keeps insertion order, so
 * a read moves its entry to the end and the first key is always the stalest).
 * Never does: expire by age or share entries between instances; each warm instance has its own.
 */
import { createHash } from 'node:crypto';
import type { Prompt } from '../src/ai/prompt.js';

/** What identifies a prompt: its two texts. The response schema follows from them. */
type PromptText = Pick<Prompt, 'system' | 'user'>;

/** The answer cache's operations, over answers of type `V`. */
export interface AnswerCache<V> {
  /** The body stored for `prompt`, or undefined when it was never answered (or was cleared). */
  readonly get: (prompt: PromptText) => V | undefined;
  /** Stores `body` as the answer to `prompt`, dropping the least recently used answer when full. */
  readonly set: (prompt: PromptText, body: V) => void;
}

/** A SHA-256 of a prompt; the NUL separator keeps `("ab", "c")` and `("a", "bc")` apart. */
const promptKey = (prompt: PromptText): string =>
  createHash('sha256').update(prompt.system).update('\u0000').update(prompt.user).digest('hex');

/** An empty cache that holds at most `max` answers. */
export function createAnswerCache<V>(max: number): AnswerCache<V> {
  const answers = new Map<string, V>();
  return {
    get: (prompt) => {
      const key = promptKey(prompt);
      const body = answers.get(key);
      if (body !== undefined) {
        answers.delete(key);
        answers.set(key, body);
      }
      return body;
    },
    set: (prompt, body) => {
      const key = promptKey(prompt);
      answers.delete(key);
      const [stalest] = answers.keys();
      if (answers.size >= max && stalest !== undefined) answers.delete(stalest);
      answers.set(key, body);
    },
  };
}
