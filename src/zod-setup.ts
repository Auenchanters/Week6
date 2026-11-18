/**
 * Switches zod to its interpreter ("jitless") before any schema is built.
 * Does: stop zod from probing `new Function`, which the page's Content-Security-Policy forbids (no
 * `unsafe-eval`, Trusted Types required); the probe is caught, but the browser reports it as a
 * violation. Validation behaves the same, only without zod's code-generation speed-up, which a
 * form this size does not need. It lives in the entry chunk and imports only zod's core config, so
 * it always runs before the lazily loaded schemas.
 * Never does: validate anything itself.
 */
import { config } from 'zod/v4/core';

config({ jitless: true });
