/**
 * The data contracts every boundary validates against, in one import: the household profile
 * (./profile-schema.ts), the hourly air forecast (./forecast-schema.ts), the AI answers and call
 * metadata (./ai-schema.ts), and the two request bodies built from them here.
 * Does: define each contract once as a zod schema and derive its TypeScript type from it, so a type
 * can never drift from its runtime check.
 * Never does: compute anything; the engine in src/domain imports these types only, never zod.
 */
import { z } from 'zod';
import { forecastSchema } from './forecast-schema.js';
import { LIMITS } from './limits.js';
import { profileSchema } from './profile-schema.js';

export * from './ai-schema.js';
export * from './forecast-schema.js';
export * from './profile-schema.js';

/** `POST /api/plan`: the household and the forecast the browser planned with. */
export const adviceRequestSchema = z.strictObject({
  profile: profileSchema,
  forecast: forecastSchema,
  dayIndex: z.union([z.literal(0), z.literal(1)]),
});

/** A validated `POST /api/plan` body; the ask body extends it. */
export type AdviceRequest = z.infer<typeof adviceRequestSchema>;

/** `POST /api/ask`: the same, plus one question. */
export const askRequestSchema = adviceRequestSchema.extend({
  question: z.string().trim().min(2).max(LIMITS.ai.questionMax),
});
