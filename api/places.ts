/**
 * Vercel function for `GET /api/places`.
 * Does: build the shared Fetch handler from the environment once per warm instance and hand it
 * every request. Never does: anything else.
 */
import { handlerFromEnv } from '../server/handler.js';

/** Vercel's Web-standard function export. */
export default { fetch: handlerFromEnv(process.env) };
