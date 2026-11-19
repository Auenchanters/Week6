/**
 * The one Vercel function behind every `/api/<route>`: health, air, places, plan and ask.
 * Does: build the shared Fetch handler from the environment once per warm instance and hand it
 * every request; the handler routes by path, so a new route needs no new file here.
 * Never does: anything else.
 */
import { handlerFromEnv } from '../server/env.js';

/** Vercel's Web-standard function export. */
export default { fetch: handlerFromEnv(process.env) };
