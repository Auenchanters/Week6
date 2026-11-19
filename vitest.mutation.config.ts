/**
 * The test run Stryker uses for mutation testing (see stryker.config.json): only the engine's own
 * tests, against the engine. Server and UI tests exercise the engine only incidentally, and their
 * timers slow every mutant down without killing any more of them.
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    env: { TZ: 'America/New_York' },
    environment: 'node',
    include: [
      'tests/unit/{aqi,coefficients,indoor,exposure,household,routine,swaps,guidance,plan}.test.ts',
    ],
  },
});
