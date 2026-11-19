# AGENTS.md: a guide for coding agents and automated reviewers

This file tells an agent working in or reviewing this repository where things are, which commands
prove what, and which rules the code keeps. People should start with the [README](README.md).

## What this is

Clearday is a GenAI air-quality assistant for families living through winter smog (PromptWars
Virtual, Challenge 6). It is a Vite + React 19 single-page app with one Vercel function serving five API routes. Google
Gemini writes the advice. A deterministic TypeScript engine computes every number the advice uses.

Live: <https://clearday-week6.vercel.app> (health check: `/api/health`).

## The one rule

**The engine computes, the AI explains.** `src/domain` is pure and deterministic and produces every
number. The model receives those numbers as facts with stable ids and may only cite them. The server
drops any answer item that cites an id the plan does not contain. Do not move a calculation into a
prompt, and do not let model text reach the page without passing through `server/answer.ts`.

## Map

| Path                                  | What lives there                                                                                 | Read first                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| `src/domain/`                         | the engine: AQI, indoor mass balance, exposure, routine, swaps, guidance, `buildDayPlan`         | `src/domain/plan.ts`, then `src/domain/coefficients.ts` |
| `src/shared/`                         | zod contracts shared by browser and server, limits, sanitizer, `Result`, sample household        | `src/shared/schema.ts`                                  |
| `src/ai/`                             | the system instructions and the prompt builders (facts sent as JSON data)                        | `src/ai/prompt.ts`                                      |
| `src/features/`                       | React features: `setup`, `dashboard`, `household` (local storage), `client` (typed API calls)    | `src/features/dashboard/dashboard.tsx`                  |
| `src/ui/`                             | shared fields, number formats and labels                                                         |                                                         |
| `server/`                             | the request handler and everything behind it: gates, Open-Meteo, Gemini, answer salvage          | `server/handler.ts`                                     |
| `api/`                                | `api/[route].ts`, the one Vercel function: a two-line call to `handlerFromEnv` (`server/env.ts`) |                                                         |
| `tests/unit`, `tests/ui`, `tests/e2e` | Vitest (Node), Vitest + Testing Library (jsdom), Playwright with axe                             | [docs/TESTING.md](docs/TESTING.md)                      |
| `scripts/`                            | dev server, bundle budget, runtime smoke, live smoke, preflight                                  |                                                         |
| `docs/`                               | methods (every coefficient and its source), architecture, testing, code quality                  |                                                         |

## Commands

```bash
npm ci                 # install exactly what the lockfile pins
npm run dev            # web on 127.0.0.1:5173, API on 127.0.0.1:3001 (GEMINI_API_KEY optional)
npm run verify         # the whole bar: lint, typecheck, tests + 100% coverage, knip, build, format
npm run test:e2e       # Playwright journeys with axe scans (builds and serves production first)
npm run test:mutation  # Stryker over src/domain (slow; the score is recorded in docs/TESTING.md)
npm run preflight      # repo size, single branch, file hygiene, README headings and links
```

`npm run verify` must pass before every commit. CI runs it on every push, then the E2E suite and
`npm audit` at the moderate level, which must report 0.

## Rules the code keeps (enforced, not aspirational)

| Rule                                                                              | Enforced by                                   |
| --------------------------------------------------------------------------------- | --------------------------------------------- |
| No `any`, no type assertions (`as`), no `@ts-` comments, no lint-disable comments | `eslint.config.js` (`noInlineConfig`, rules)  |
| Strict type-checked lint, accessible JSX, zero warnings                           | `npm run lint` (`--max-warnings=0`)           |
| Functions: complexity ≤ 10, ≤ 15 statements, ≤ 80 lines, ≤ 4 params, nesting ≤ 3  | `eslint.config.js` (shipped code)             |
| Files ≤ 250 lines of code; every export has a doc comment                         | `eslint.config.js` (`eslint-plugin-jsdoc`)    |
| Engine mutation score ≥ 90%                                                       | `stryker.config.json` (`break: 90`)           |
| Layer order: shared → domain → ai/ui → features; server uses shared, domain, ai   | `tests/unit/architecture.test.ts`             |
| The engine never reads the clock, randomness, network or storage                  | `tests/unit/architecture.test.ts`             |
| 100% statements, branches, functions and lines                                    | `vitest.config.ts` thresholds                 |
| No unused files, exports or dependencies                                          | `knip.json`                                   |
| Entry chunk under 250 kB raw / 80 kB gzip                                         | `scripts/bundle-budget.ts`                    |
| Every external input validated with a strict zod schema; unknown keys rejected    | `src/shared/schema.ts`, `server/request.ts`   |
| Logs carry ids, numbers and fixed labels only, never household data or model text | `server/log.ts`, `tests/unit/handler.test.ts` |

## Conventions

- Every module opens with a header comment saying what it does and what it never does.
- Every exported symbol has a doc comment (lint fails without one). Physical constants cite their source in
  `src/domain/coefficients.ts` and [docs/METHODS.md](docs/METHODS.md).
- Errors cross the server boundary only as catalogued codes from `server/errors.ts`.
- Expected failures in the browser are values (`Result<T, E>` in `src/shared/result.ts`), not throws.
- Commits follow Conventional Commits. The repository has one branch, `main`.

## Changing things safely

- A new engine number: add it to `src/domain`, cite its source, expose it as a fact in `src/domain/plan.ts`,
  and test it against an external truth (a published table or an analytic solution) where one exists.
- A new route: add it to `ROUTES` and `HANDLERS` in `server/handler.ts`, a schema in
  `src/shared/schema.ts`, and rows in the handler test matrix. `api/[route].ts` needs no change.
- A prompt change: update `src/ai/prompt.ts` and its injection-corpus test; the instruction text is
  shown to users in the "AI at work" panel, so keep it readable.
