# Code quality: the design and the reasons behind it

This document explains how Clearday's code is shaped, why, and what it costs. The rules themselves
are enforced by tooling; the table at the end links each one to the config that enforces it.

## 1. The shape of the code

About 6,900 lines of TypeScript ship (excluding tests and styles). The largest part, about 1,400
lines, is the engine in `src/domain`: nine pure modules that turn a forecast and a household into
numbers. Everything else is arranged around it.

```
src/shared   contracts (zod), limits, sanitizer, Result        imports: zod only
src/domain   the engine                                        imports: itself, types from shared
src/ai       system instructions and prompt builders           imports: shared, domain
src/ui       wording and formats                               imports: shared, domain
src/features React features                                    imports: the layers above
server/      handler, gates, Open-Meteo, Gemini, answer salvage imports: shared, domain, ai
```

The order is a test, not a convention: `tests/unit/architecture.test.ts` parses every import and
fails the build when a layer reaches upward or the engine touches the clock, randomness, the network
or storage.

**Why this split.** Air-quality advice is only as good as its numbers, and a language model is a poor
calculator. Putting every number in a deterministic engine means the numbers can be tested against
published tables and analytic solutions, the browser can recompute every what-if with no AI call, and
the server can re-run the same engine on the validated request, so the facts in a prompt are never
text a client typed. The AI layer is then small and replaceable: it phrases and prioritizes; it does
not compute.

## 2. Decisions and their trade-offs

| Decision                                                                                                                                                                           | Why                                                                                                                                                                                | Cost                                                                                                                                       |
| ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| One zod schema per contract (`src/shared/profile-schema.ts`, `forecast-schema.ts`, `ai-schema.ts`), all imported through `src/shared/schema.ts` by both the browser and the server | One source of truth: types are inferred from the schemas, so the client and the server cannot drift apart                                                                          | zod ships in the client bundle (it is inside the 250 kB budget); zod runs jitless so the Trusted Types CSP never needs `new Function`      |
| Every impact is the difference of two runs of the same model (`src/domain/swaps.ts`)                                                                                               | Impacts are comparable, and trade-offs keep both signs: a purifier on a coal-heavy grid shows cleaner lungs **and** more CO2                                                       | Each change costs a full model run; about 20 runs of a 24-hour simulation take a few milliseconds, so it never mattered                    |
| The swaps catalog is a table of rules (`HOME_RULES`, `PURIFIER_RULES`), each a `when` predicate and a `patch`                                                                      | Adding a change is adding a row; nothing else moves. Ranking ties are broken by id, so row order cannot change the output                                                          | The purifier takes three rows, one per size, each applying only when that size fits the home                                               |
| The indoor model is solved exactly per hour (`src/domain/indoor.ts`), not stepped numerically                                                                                      | No step-size error, and a test can compare it with the analytic steady state                                                                                                       | Sources are treated as constant within an hour                                                                                             |
| Gemini gets a shape-only JSON schema; ids and caps are enforced on the server (`server/answer.ts`)                                                                                 | Gemini rejects a schema with a fact-id enum in every list ("too many states"); server checks are stricter anyway, and per-item salvage keeps the good items of a partly bad answer | The model can return an item that is then dropped; the count is returned in `meta.dropped` and logged, so it is visible rather than silent |
| Expected failures are values (`Result<T, E>` in `src/shared/result.ts`); the server throws catalogued `AppError`s only                                                             | The browser's control flow shows every failure a call can have; the server has one place (`server/errors.ts`) that decides what a client may see                                   | Two error styles exist, one per side of the network, on purpose                                                                            |
| No type assertions, no `any`, no suppression comments anywhere, tests included                                                                                                     | Every value's type is proven by the compiler or a schema, so a lint pass means what it says                                                                                        | Some test fixtures are built through schemas instead of cast literals, which is longer                                                     |
| The engine is the only unit of mutation testing                                                                                                                                    | Every number on screen comes from it, so a surviving mutant there is a wrong number nobody would notice                                                                            | Server and UI code is held to 100% coverage and the E2E suite instead of mutation scores                                                   |

## 3. How the code reads

- Every module opens with a header saying what it does and what it never does, so a reader knows the
  module's boundary before reading its code.
- Every exported symbol has a doc comment, and `eslint-plugin-jsdoc` fails the build when one is missing (adding the rule found 24 exported types without one); every physical constant names its source and units in
  `src/domain/coefficients.ts`, and [METHODS.md](METHODS.md) shows the formulas.
- Names carry units (`doseSavedUg`, `co2SavedKg`, `HEATER_EMISSION_MG_PER_H`), so a mismatched unit
  reads wrong at the call site.
- Functions stay small: lint fails any function above complexity 10, 15 statements, 80 lines, four
  parameters, three levels of nesting or three nested callbacks, and any file above 250 lines of code.
  When a function grew past that, it was split by responsibility: the Gemini adapter is
  `withOverloadRetry` and `toGeneration`; the request handler is a route table (`HANDLERS`) over
  small functions, with model-failure handling in `server/model-call.ts` and the answer cache in
  `server/answer-cache.ts`; each setup editor is a list of cards built from named parts
  (`KindAndMode`, `WhoGoes`, `Timing`, `FlexibleWindow`; `NameAndAge`, `Conditions`, `AwayHours`).

## 4. Known limitations

Stated plainly, so a reader does not have to discover them:

- **The indoor model is one well-mixed room.** Real homes vary room by room; a kitchen is worse than a
  bedroom while cooking. The numbers are estimates for a typical home, not measurements.
- **Rate limits and the answer cache are per instance unless a shared store is configured.** With
  Upstash Redis set, quotas are shared; without it (the default), each warm instance counts on its own,
  which is logged once at start-up. The answer cache is always per instance; at 200 entries it drops
  the least recently used answer.
- **The page is rendered in the browser.** A client that does not run JavaScript sees the
  `<noscript>` summary and the structured data in `index.html`, not the dashboard.
- **The interface is in English; the AI writes in six languages.** The engine's numbers are
  language-free, and model text is marked with `lang` and `dir="auto"`.
- **The forecast is a model, not a station.** Open-Meteo's CAMS forecast is the best free, keyless,
  worldwide source; ground stations in hotspots can read higher.

## 5. Enforced metrics

| Metric                                      | Gate                                                                | Where                             |
| ------------------------------------------- | ------------------------------------------------------------------- | --------------------------------- |
| Lint (strict type-checked, jsx-a11y strict) | 0 errors, 0 warnings, suppression comments disallowed               | `eslint.config.js`                |
| Function size and shape                     | complexity ≤ 10, ≤ 15 statements, ≤ 80 lines, ≤ 4 params, depth ≤ 3 | `eslint.config.js`                |
| File size                                   | ≤ 250 lines of code                                                 | `eslint.config.js`                |
| Documentation                               | a doc comment on every export                                       | `eslint.config.js` (jsdoc)        |
| Type assertions, `any`, `@ts-` comments     | none, tests included                                                | `eslint.config.js`                |
| Types                                       | `strict`, `noUncheckedIndexedAccess`, `exactOptionalPropertyTypes`  | `tsconfig.base.json`              |
| Coverage                                    | 100% statements, branches, functions, lines                         | `vitest.config.ts`                |
| Mutation score (engine)                     | build breaks below 90%; last measured in [TESTING.md](TESTING.md)   | `stryker.config.json`             |
| Layer boundaries and engine purity          | a test parses every import                                          | `tests/unit/architecture.test.ts` |
| Dead code and unused dependencies           | none                                                                | `knip.json`                       |
| Bundle                                      | entry chunk < 250 kB raw / 80 kB gzip                               | `scripts/bundle-budget.ts`        |
| Dependencies                                | `npm audit` reports 0 at the moderate level, full tree              | `.github/workflows/ci.yml`        |
| Formatting                                  | Prettier check                                                      | `.prettierrc.json`                |

All of it runs with one command, `npm run verify`, and in CI on every push.
