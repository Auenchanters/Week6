# Clearday — breathe easier through winter smog

Clearday is a GenAI assistant for families and communities living through severe winter smog and
urban air pollution. Tell it where you live, who is in your household and how your days go. It
re-plans your day around the cleanest hours, finds the indoor air fixes that matter in _your_ home,
and ranks sustainable alternatives. Every suggestion comes with its direct impact: how much less
PM2.5 each person breathes, in micrograms and cigarette equivalents, and how much CO2 it saves or
costs.

[![Quality](https://github.com/Auenchanters/Week6/actions/workflows/ci.yml/badge.svg)](https://github.com/Auenchanters/Week6/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Auenchanters/Week6/actions/workflows/codeql.yml/badge.svg)](https://github.com/Auenchanters/Week6/actions/workflows/codeql.yml)

**Live:** https://clearday-week6.vercel.app · **Methods:** [docs/METHODS.md](docs/METHODS.md) ·
**Architecture:** [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) · **Code quality:**
[docs/CODE-QUALITY.md](docs/CODE-QUALITY.md) · **Testing:** [docs/TESTING.md](docs/TESTING.md) ·
**Security:** [SECURITY.md](SECURITY.md) · **How it was built:** [docs/BUILD-NOTES.md](docs/BUILD-NOTES.md) ·
**Repo guide for agents:** [AGENTS.md](AGENTS.md)

> Rule of the house: **the engine computes, the AI explains.** A deterministic, tested engine
> produces every number. Google Gemini turns those numbers into advice and may only cite them.

## Chosen Vertical

**Urban Air Quality Assistant** (PromptWars Virtual, Challenge 6). The brief:

> Create a GenAI-powered assistant that helps families and communities navigate severe winter smog
> and urban air pollution. The application should suggest low-emission daily routines, indoor air
> quality hacks, and sustainable alternatives tailored to their location and lifestyle, while
> clearly explaining the direct impact of their choices.

| Brief asks for                       | Clearday delivers                                                                                                                                     | Where                                          |
| ------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------- |
| families and communities             | a household of up to 8 people with ages and health conditions; community actions such as composting instead of burning, with street-level PM2.5 saved | `src/shared/schema.ts`, `src/domain/swaps.ts`  |
| severe winter smog                   | India's NAQI over six pollutants plus US AQI; live 48-hour Open-Meteo forecast; Delhi smog sample                                                     | `src/domain/aqi.ts`, `server/air.ts`           |
| low-emission daily routines          | flexible outings moved to the cleanest hours; cleaner modes per trip; the best time to air the home                                                   | `src/domain/routine.ts`, `src/domain/swaps.ts` |
| indoor air quality hacks             | a physical indoor model (infiltration, windows, cooking, heaters, incense, purifier); live what-if controls                                           | `src/domain/indoor.ts`, dashboard "Home air"   |
| sustainable alternatives             | transport, heating, cooking and waste swaps with CO2 per week, trade-offs shown with both signs                                                       | `src/domain/swaps.ts`, dashboard "Choices"     |
| tailored to location and lifestyle   | place search, the household's own activities, home and habits                                                                                         | setup flow                                     |
| clearly explaining the direct impact | µg of PM2.5 per person per day, cigarette equivalents, kg CO2 per week, g of street PM2.5; AI advice cites the exact facts                            | `src/domain/plan.ts`, `src/ai/facts.ts`        |
| GenAI-powered                        | Gemini writes personal advice and answers questions, grounded in cited engine facts, in six languages                                                 | `src/ai/prompt.ts`, `server/handler.ts`        |

## Approach and Logic

1. **Physics first.** Air quality advice is only as good as its numbers, and language models are
   poor calculators. So the numbers come from published models with sourced coefficients (CPCB
   NAQI tables, EPA breakpoints and inhalation rates, a standard indoor mass balance, DEFRA/CEA
   emission factors). Every coefficient cites its source in
   [`src/domain/coefficients.ts`](src/domain/coefficients.ts) and [METHODS.md](docs/METHODS.md).
2. **One model, two runs, one difference.** Every "impact" figure is computed by applying one
   change to the household and re-running the same model. Impacts are therefore comparable, and
   trade-offs stay visible: a purifier means cleaner lungs but more CO2 on a coal-heavy grid, and
   Clearday shows both.
3. **AI where it adds value.** Gemini personalizes: it prioritizes the most sensitive people,
   explains why a change matters for _this_ family, writes in their language and answers follow-up
   questions. It receives the engine's results as numbered facts and must cite their ids. The
   server checks every item and drops any that cite anything else.
4. **Zero-cost interaction.** The engine runs in the browser, so switching days, editing the
   household and every what-if recompute instantly with no AI call.

## How the Solution Works

1. **Set up** (or load the sample Delhi family): place, household members, home, daily
   activities, language. The profile is validated with zod and saved only in the browser.
2. **Air data:** `GET /api/air` fetches a 48-hour hourly forecast of PM2.5, PM10, NO2, O3, CO and
   SO2 from Open-Meteo, cached for 30 minutes. If Open-Meteo is unavailable, a labelled sample keeps
   the app working.
3. **Engine** (`buildDayPlan`, in the browser): NAQI per hour and for the day → indoor PM2.5 hour
   by hour → each member's inhaled dose → routine moves and airing time → every applicable change
   measured → CPCB-based precautions per person → numbered facts.
4. **Dashboard:** the day's AQI and what it means as cigarettes, a 24-hour air ribbon with the
   cleanest window, a card per person (dose now vs with the plan, precautions), the re-planned day,
   home what-ifs and the choices ledger sorted by lungs or climate.
5. **AI advice** (`POST /api/plan`, one Gemini call): the server re-runs the engine on the validated
   request, builds a prompt with the facts as JSON data and a shape-only JSON schema, then
   salvages, sanitizes and fact-checks the answer item by item: any item citing an id that is not
   one of the plan's facts is dropped and counted. Identical
   prompts are answered from a cache.
6. **Ask Clearday** (`POST /api/ask`): one grounded question, one call, answered with cited facts.
7. **AI at work** panel: the exact system instruction and data sent, plus the call's model, latency,
   tokens and the number of items dropped.

## Assumptions Made

- The indoor model treats the home as one well-mixed space; real homes vary room by room.
- Coefficients are population averages from the cited literature (midpoints where a range is
  given); results are estimates for a typical home and person, not measurements or medical advice.
- Cooking happens at 07:00, 13:00 and 20:00, heaters run in the evening up to 22:00, and a purifier
  runs all day, unless the household says otherwise in the setup.
- The hourly chart's per-hour AQI indicates how the day moves; the official NAQI is the 24-hour
  value shown in the headline.
- Cigarette equivalents use Berkeley Earth's 22 µg/m³ per day rule of thumb to make numbers
  relatable.
- Open-Meteo's CAMS-based forecast is the best free, keyless, worldwide hourly source; ground
  stations can read higher in hotspots.

## Google services

| Service                                               | Use                                                                                                                                                                                             |
| ----------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Gemini** (`gemini-3.5-flash-lite`, `@google/genai`) | personal advice and grounded Q&A, structured JSON output whose fact citations the server checks item by item, minimal thinking, 25 s timeout, one retry only when the model is overloaded (503) |
| **Google AI Studio**                                  | API key management for Gemini                                                                                                                                                                   |

## Run it locally

```bash
npm ci
cp .env.example .env.local   # add GEMINI_API_KEY (optional: the app works without AI)
npm run dev                  # web on 127.0.0.1:5173, API on 127.0.0.1:3001
npm run verify               # lint, typecheck, tests with coverage gates, knip, build, format
npm run test:e2e             # Playwright journeys with axe accessibility scans
```

## Evaluation Map

| Area              | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Code quality      | about 6,900 lines of strict TypeScript, the largest part a pure engine with sourced constants; no `any`, `as` or suppression comments (lint-enforced, tests included); every function held to complexity ≤ 10, ≤ 15 statements, ≤ 80 lines, ≤ 4 parameters and ≤ 3 nesting levels, files to ≤ 250 lines, all gated in [`eslint.config.js`](eslint.config.js); layer order and engine purity enforced by [`tests/unit/architecture.test.ts`](tests/unit/architecture.test.ts); a doc comment on every export, enforced by `eslint-plugin-jsdoc`; one error catalog; design reasons, trade-offs and known limitations in [docs/CODE-QUALITY.md](docs/CODE-QUALITY.md); a repo guide for agents in [AGENTS.md](AGENTS.md) |
| Security          | strict CSP with Trusted Types, origin allowlist, JSON-only POSTs, bounded bodies, strict zod schemas, prompt-injection isolation (user text only as JSON data), output sanitizing, rate limits and a daily AI budget, no secrets in the client, `npm audit` at 0 vulnerabilities across the full tree (CI fails at moderate), CodeQL and Gitleaks: see [SECURITY.md](SECURITY.md)                                                                                                                                                                                                                                                                                                                                      |
| Efficiency        | engine runs in the browser (0 AI calls for every edit), 1 call per advice, prompt-hash answer cache, 30-minute forecast cache, lazy-loaded dashboard, bundle budget gate; Lighthouse 13.6 on the live site (2026-11-19, mobile and desktop): Accessibility 100, Best Practices 100, SEO 100                                                                                                                                                                                                                                                                                                                                                                                                                            |
| Testing           | 738 tests: unit, property-based (fast-check), ground truth (official AQI tables, an analytic steady state), injection corpus, handler matrix, UI and Playwright journeys with axe; 100% statement, branch, function and line coverage enforced; Stryker mutation score 96.1% on the engine, build breaks below 90% (`npm run test:mutation`): see [docs/TESTING.md](docs/TESTING.md)                                                                                                                                                                                                                                                                                                                                   |
| Accessibility     | WCAG 2.2 AA: landmarks, skip link, labelled controls, colour never the only signal, data tables behind every chart, live regions, AI text marked with `lang` and `dir="auto"`, keyboard-only journey, axe scans in E2E, `jsx-a11y` strict in lint                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| Problem alignment | the table under _Chosen Vertical_ maps every phrase of the brief to a feature; the live page's HTML carries the same feature list as JSON-LD and `<noscript>` text for clients that do not run JavaScript                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |

## License

MIT
