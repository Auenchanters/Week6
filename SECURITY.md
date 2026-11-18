# Security policy

## Reporting a vulnerability

Report vulnerabilities privately through GitHub's private vulnerability reporting:
<https://github.com/Auenchanters/Week6/security/advisories/new>. Do not open a public issue. The same
contact is published at `/.well-known/security.txt` on the live site
(`public/.well-known/security.txt`). Only `main` and its live deployment are supported.

## Authentication and authorization

Clearday has no accounts and no server-side store. A household profile lives only in the visitor's
own browser (`src/features/household/storage.ts`), validated with the same zod schema the server
uses, so there is nothing on the server that belongs to one user and must be kept from another.

What the server guards is cost and integrity. `POST /api/plan` and `POST /api/ask` are the only
routes that spend anything (one Gemini call each), and they sit behind, in order: the method, a
JSON-only content type (415), an origin allowlist (403), a body cap of 32 KB (413), per-client rate
limits (429), a strict schema (400), a daily model-call budget (503) and a concurrency gate (429).
`GEMINI_API_KEY` is read only on the server and never appears in a response, a log line or the
client bundle.

## Threats and mitigations

| Threat                                                      | Mitigation                                                                                                                                                                                                                                                                                                                                                      | Where                                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| **Prompt injection** through names, the place or a question | User text is sanitized, capped and sent only as JSON data in the user message; the fixed system instruction says every value is untrusted data. The server **re-runs the engine** on the validated request, so the facts in the prompt are computed numbers, never client-supplied text. A 16-payload injection corpus runs through every free-text field.      | `src/ai/prompt.ts`, `server/handler.ts`, `tests/unit/prompt.test.ts`, `tests/fixtures/injection.json` |
| **Ungrounded or invented model output**                     | The response schema's `cites` enum is the plan's own fact ids; every item is validated on its own and dropped if it cites anything else; lists are capped; the count of dropped items is returned and logged.                                                                                                                                                   | `src/shared/schema.ts`, `server/answer.ts`                                                            |
| **XSS through model output**                                | Tags, stray angle brackets, control and invisible characters (bidi overrides, Unicode tag characters) are removed and link openers neutralized in every model string; React renders text only, no `dangerouslySetInnerHTML`; the CSP has no `unsafe-*` sources and requires Trusted Types (zod runs jitless so it never needs `new Function`).                  | `src/shared/sanitize-text.ts`, `src/zod-setup.ts`, `vercel.json`                                      |
| **CSRF / cross-origin calls**                               | POSTs need `application/json` and an `Origin` equal to the request's own origin or `APP_ORIGIN`; `Sec-Fetch-Site: cross-site` is refused; no cookies or ambient credentials exist.                                                                                                                                                                              | `server/request.ts`                                                                                   |
| **Oversize or malformed input**                             | Declared and streamed body size are both capped; strict schemas reject unknown keys; coordinates must be plain decimals in range (a blank `lat` is not read as 0); place queries are 2–60 characters.                                                                                                                                                           | `server/request.ts`, `server/handler.ts`                                                              |
| **Upstream data**                                           | Open-Meteo responses are schema-validated, gaps filled from neighbours, values bounded (0–5000); a failing or slow upstream (8 s timeout) falls back to a labelled sample forecast; only coordinates or the search text are sent.                                                                                                                               | `server/air.ts`                                                                                       |
| **Abuse and cost**                                          | 10 requests a minute per client (SHA-256 of the forwarded address) and a daily budget of model calls (300 by default), shared through Upstash Redis when configured with an in-memory fallback; 3 model calls in flight per instance; one call per request, no retries, bounded output tokens, 25 s timeout; repeated prompts answered from a cache at no cost. | `server/rate-limit.ts`, `server/capacity.ts`, `server/provider.ts`, `server/handler.ts`               |
| **Secret leakage**                                          | No `VITE_`-prefixed secrets; `.env*` except `.env.example` git-ignored; Gitleaks scans history in CI; error responses carry catalogued messages only.                                                                                                                                                                                                           | `.gitignore`, `.github/workflows/secrets.yml`, `server/errors.ts`                                     |
| **Tampered browser storage**                                | The stored profile is parsed with the strict schema on load; anything invalid is discarded.                                                                                                                                                                                                                                                                     | `src/features/household/storage.ts`                                                                   |
| **Browser hardening**                                       | CSP (`default-src 'self'`, `frame-ancestors 'none'`, `object-src 'none'`, `require-trusted-types-for 'script'`), HSTS two years with preload, `X-Frame-Options: DENY`, `nosniff`, COOP/CORP same-origin, strict referrer, a Permissions-Policy that disables camera, microphone, geolocation, payment and USB; API responses are `no-store`.                    | `vercel.json`                                                                                         |
| **Private data in logs**                                    | One JSON line per request with ids, numbers and fixed labels only: never household details, questions, model text, raw paths or IP addresses (asserted by tests).                                                                                                                                                                                               | `server/log.ts`, `tests/unit/handler.test.ts`                                                         |
| **Supply chain**                                            | Four runtime dependencies pinned exactly with a lockfile; `npm audit` in CI; CodeQL `security-extended`; Actions pinned to commit SHAs; Dependabot alerts on with update PRs off (single-branch repository).                                                                                                                                                    | `package.json`, `.github/`                                                                            |

## The log line

```ts
interface RequestLog {
  requestId: string; // also returned as meta.requestId
  route: '/api/plan' | '/api/ask' | '/api/air' | '/api/places' | '/api/health' | 'unknown';
  status: number;
  code?: ErrorCode; // catalogued error code on failures
  kind?: 'internal'; // an unexpected fault, without its message
  event?: 'truncated'; // the model hit its output cap
  cached?: true; // answered from the prompt cache, no model call
  source?: 'open-meteo' | 'sample'; // where a forecast came from
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  dropped?: number; // answer items that failed validation
}
```
