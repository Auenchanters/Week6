/**
 * The one length cap for text: the sanitizer (src/shared/sanitize-text.ts) and the engine's AI
 * normalizer (src/domain/merge.ts) both cut with it, so a cap means the same everywhere.
 * Never does: import anything, so the domain may load it at runtime.
 */

/** Splits text into graphemes, what a reader sees as one character (a ZWJ family is one). */
const GRAPHEMES = new Intl.Segmenter('en', { granularity: 'grapheme' });

/**
 * Trims `text` and keeps at most `max` code points, cutting only between graphemes: a cut never
 * splits a surrogate pair, an accent from its letter, or a ZWJ emoji sequence. The budget stays in
 * code points so the result is never longer than the schemas' limits; then trims the cut.
 */
export function capText(text: string, max: number): string {
  let kept = '';
  let used = 0;
  for (const { segment } of GRAPHEMES.segment(text.trim())) {
    used += Array.from(segment).length;
    if (used > max) break;
    kept += segment;
  }
  return kept.trimEnd();
}
