/**
 * Answers to repeated prompts, so a repeat costs no model call.
 * Does: key each answer body by a SHA-256 of the prompt's system and user text; hold at most
 * `max` bodies and clear them all when full.
 * Never does: evict by age or share entries between instances. shortcut: clearing whole is enough
 * at 200 entries per warm instance; a shared store (Upstash) would replace it if traffic grew.
 */
import { createHash } from 'node:crypto';
import type { Prompt } from '../src/ai/prompt.js';

/** The answer cache's operations. */
export interface AnswerCache {
  /** The body stored for `prompt`, or undefined when it was never answered (or was cleared). */
  readonly get: (prompt: Prompt) => unknown;
  /** Stores `body` as the answer to `prompt`, clearing the cache first when it is full. */
  readonly set: (prompt: Prompt, body: unknown) => void;
}

/** A SHA-256 of a prompt; the NUL separator keeps `("ab", "c")` and `("a", "bc")` apart. */
const promptKey = (prompt: Prompt): string =>
  createHash('sha256').update(prompt.system).update('\u0000').update(prompt.user).digest('hex');

/** An empty cache that holds at most `max` answers. */
export function createAnswerCache(max: number): AnswerCache {
  const answers = new Map<string, unknown>();
  return {
    get: (prompt) => answers.get(promptKey(prompt)),
    set: (prompt, body) => {
      if (answers.size >= max) answers.clear();
      answers.set(promptKey(prompt), body);
    },
  };
}
