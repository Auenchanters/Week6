# Testing

`npm run verify` runs lint, type-checking, the unit and component tests with coverage gates
(100% statements, branches, functions and lines), knip, the production build (with its bundle
budget and runtime smoke) and the Prettier check. CI (`.github/workflows/ci.yml`) runs it on every
push, then the Playwright journeys and `npm audit`.

## Layers

| Layer                       | Where                                                                 | What it proves                                                                                                                                                                                                                                                                                                                     |
| --------------------------- | --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Ground truth                | `tests/unit/aqi.test.ts`                                              | Every official NAQI band edge for all six pollutants (CPCB 2014) and every US EPA PM2.5 band edge (2024) gives the exact published index; truncation and averaging rules.                                                                                                                                                          |
| Property-based (fast-check) | `aqi`, `indoor`, `exposure` tests                                     | Indices are monotone and bounded; indoor air without sources never exceeds outdoor; adding a source never lowers it; a bigger purifier never raises it; dose is non-negative and scales linearly with outdoor air.                                                                                                                 |
| Physics                     | `tests/unit/indoor.test.ts`                                           | Constant outdoor air converges to the analytic steady state of the mass balance; the outdoor share is exact.                                                                                                                                                                                                                       |
| Engine behaviour            | `exposure`, `household`, `routine`, `swaps`, `guidance`, `plan` tests | Partial and overlapping activities, away hours, masks; CO2 accounting; moves go to the cleanest hour with deterministic tie-breaks; every change is measured by re-running the model and ranked; the CPCB rule table for every category and sensitivity; fact ids are unique and stable (one snapshot of the sample plan's facts). |
| Architecture                | `tests/unit/architecture.test.ts`                                     | Folder layer order, the domain's import allowlist, and its ban on `Date.now`, `Math.random`, `fetch(`, `localStorage` and `new Date()`.                                                                                                                                                                                            |
| Handler matrix              | `tests/unit/handler.test.ts`                                          | Every route and status: 404, 405, 415, 403, 413 (declared and streamed), 400 with field paths, 429 (rate and capacity), 503 (not configured, busy, daily budget), 504, 502, 499, 500; the exact prompt sent; cache hits make no call; log lines never hold household, question or model text.                                      |
| Request gates               | `tests/unit/request.test.ts`                                          | Transport rules, bounded reading, and that the largest valid request fits the body cap.                                                                                                                                                                                                                                            |
| Upstream data               | `tests/unit/air.test.ts`                                              | Open-Meteo parsing, CO unit conversion, gap filling, caching, the sample fallback on every failure, place search mapping.                                                                                                                                                                                                          |
| Model answers               | `tests/unit/answer.test.ts`                                           | Item-by-item salvage, unknown cites dropped and counted, list caps, sanitizing, unusable answers rejected.                                                                                                                                                                                                                         |
| Prompt injection            | `tests/unit/prompt.test.ts`, `tests/fixtures/injection.json`          | 16 payloads in names, place and question reach the model only as sanitized data, never in the system instruction; the schema sent to Gemini is shape-only and the caps are stated in the instructions.                                                                                                                             |
| Components                  | `tests/ui/`                                                           | Setup validation and error summary, sample family, day switch, what-if recompute with zero fetches, ledger sort, filter and wording, advice and ask flows with mocked API, storage round trip and corrupt storage.                                                                                                                 |
| End to end                  | `tests/e2e/`                                                          | Chromium on desktop and mobile against the production build under the production CSP with `/api` mocked: the sample journey, a keyboard-only journey, and axe at WCAG 2.2 A/AA with zero violations in light and dark mode.                                                                                                        |
| Runtime and budget          | `scripts/runtime-smoke.mjs`, `scripts/bundle-budget.ts`               | The emitted API loads in plain Node ESM and runs the sample household through the gate and engine; the entry chunk stays under 250 kB raw / 80 kB gzip.                                                                                                                                                                            |
| Live smoke                  | `scripts/live-smoke.ts`, `.github/workflows/live.yml`                 | Against the deployment: health, public page, security headers, and one real advice request validated against the schemas.                                                                                                                                                                                                          |

## Mutation testing

Coverage says a line ran; mutation testing says a test would notice if the line were wrong. Stryker
(`npm run test:mutation`, configured in `stryker.config.json`) makes small changes to the engine in
`src/domain` (flipped comparisons, swapped operators, emptied strings and arrays) and runs the
engine's own tests (`vitest.mutation.config.ts`) against each one. The run fails below 90%.

Last run, 2026-11-19: **96.9%**. Of 890 valid mutants, 851 were killed and 11 timed out (the mutant made a
test hang, which counts as caught); 28 survived. Another 40 did not compile and are not counted.

| Module                       | Score |
| ---------------------------- | ----- |
| `src/domain/coefficients.ts` | 100%  |
| `src/domain/guidance.ts`     | 100%  |
| `src/domain/household.ts`    | 100%  |
| `src/domain/plan.ts`         | 98.0% |
| `src/domain/swaps.ts`        | 96.7% |
| `src/domain/exposure.ts`     | 96.5% |
| `src/domain/aqi.ts`          | 96.1% |
| `src/domain/indoor.ts`       | 93.9% |
| `src/domain/routine.ts`      | 92.2% |

Most survivors are equivalent mutants: changes that cannot alter any output. For example, heater
hours do not matter when there is no heater, so mutating the `heater === 'none'` guard in
`src/domain/indoor.ts` changes nothing a test could observe. The first run (95.4%) found a real gap, the swaps
catalog's wording, costs and patches, which `tests/unit/swaps.test.ts` now pins rule by rule.

Mutation testing is not part of `npm run verify` or CI: a full run takes about 10 minutes. Server
and UI code is held to 100% coverage and the end-to-end suite instead.
