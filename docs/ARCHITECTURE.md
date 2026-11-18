# Architecture

## Principle: the engine computes, the AI explains

```
 Browser (React SPA)                                   Vercel functions (Node 24)
 ┌──────────────────────────────────────────┐         ┌───────────────────────────────────┐
 │ setup form ──► Profile (zod-validated,   │  GET    │ /api/air    ─► Open-Meteo AQ (cache,│
 │                localStorage clearday.v1) │ ──────► │               sample fallback)      │
 │                                          │         │ /api/places ─► Open-Meteo geocoding │
 │ buildDayPlan(profile, forecast, day)     │         │                                     │
 │   └─ src/domain (pure, deterministic)    │  POST   │ /api/plan, /api/ask                 │
 │ dashboard: AQI, people, routine,         │ ──────► │   gate ─► buildDayPlan (same engine)│
 │ what-if, ledger  (0 AI calls)            │         │        ─► prompt (facts as data)    │
 │                                          │ ◄────── │        ─► Gemini, 1 call, cached    │
 │ AI advice / Ask: cited fact chips        │         │        ─► per-item salvage + cites  │
 └──────────────────────────────────────────┘         └───────────────────────────────────┘
```

1. The browser fetches a 48-hour forecast for the household's place.
2. It runs the engine locally: every number on screen, and every "what if", is computed in the
   browser with **zero AI calls**.
3. Only "Get personal advice" and "Ask Clearday" call Gemini. The server **re-runs the same
   engine** on the validated request, so the facts in the prompt are computed server-side from
   numbers, never taken from client-supplied text.
4. The response schema's `cites` enum is the plan's own fact ids; the server drops any item that
   fails the schema, item by item, and reports how many it dropped.

## Layers (enforced by [`tests/unit/architecture.test.ts`](../tests/unit/architecture.test.ts))

| Layer      | Folder            | May import                                                              |
| ---------- | ----------------- | ----------------------------------------------------------------------- |
| Contracts  | `src/shared`      | nothing but zod                                                         |
| Engine     | `src/domain`      | itself, `import type` from shared, and three import-free shared modules |
| AI prompt  | `src/ai`          | shared, domain                                                          |
| UI wording | `src/ui`          | shared, domain                                                          |
| Features   | `src/features/*`  | the layers below                                                        |
| Server     | `server/`, `api/` | shared, domain, ai                                                      |

The engine may not mention `Date.now`, `Math.random`, `fetch`, `localStorage` or `new Date()`;
the architecture test fails the build if it does.

## Engine modules ([`src/domain`](../src/domain))

| Module                       | Responsibility                                                         |
| ---------------------------- | ---------------------------------------------------------------------- |
| `src/domain/aqi.ts`          | NAQI (6 pollutants) and US AQI (PM2.5)                                 |
| `src/domain/coefficients.ts` | every physical constant, with its source                               |
| `src/domain/indoor.ts`       | hourly indoor PM2.5 mass balance, exact per-hour solution              |
| `src/domain/exposure.ts`     | each member's day in slices; dose, mean exposure, cigarette equivalent |
| `src/domain/household.ts`    | indoor + everyone's exposure; weekly CO2 and street PM2.5              |
| `src/domain/routine.ts`      | moves flexible activities to cleaner hours; best airing time           |
| `src/domain/swaps.ts`        | the choices catalog, each measured by re-running the model             |
| `src/domain/guidance.ts`     | CPCB-based precautions per member                                      |
| `src/domain/plan.ts`         | composes all of the above into a `DayPlan` with citable facts          |

Every "impact" figure is a difference between two runs of the same model, so changes are always
comparable and trade-offs (lungs vs CO2) are visible instead of netted.

## Server ([`server/`](../server))

| Module                 | Responsibility                                                                 |
| ---------------------- | ------------------------------------------------------------------------------ |
| `server/handler.ts`    | routing, gates, answer cache, model call, one log line per request             |
| `server/request.ts`    | content type, origin allowlist, bounded body, strict schema                    |
| `server/air.ts`        | Open-Meteo client: validation, gap filling, 30-minute cache, sample fallback   |
| `server/answer.ts`     | per-item salvage of the model's JSON, sanitizing, cite checking                |
| `server/provider.ts`   | the Gemini SDK call: JSON schema output, minimal thinking, timeout, no retries |
| `server/rate-limit.ts` | per-client and daily quotas, shared through Upstash when configured            |
| `server/capacity.ts`   | at most three model calls in flight per instance                               |
| `server/errors.ts`     | the one catalog of public errors                                               |

## Model-call budget

| Action                                                               | Gemini calls                                   |
| -------------------------------------------------------------------- | ---------------------------------------------- |
| Loading a place, switching day, editing the household, every what-if | 0                                              |
| "Get personal advice"                                                | 1 (0 when the same prompt was answered before) |
| One "Ask Clearday" question                                          | 1 (0 for a repeat)                             |
