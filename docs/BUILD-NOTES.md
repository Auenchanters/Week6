# How Clearday was built

One developer built Clearday between 18 and 20 November 2026 for PromptWars Virtual Challenge 6,
working with an AI coding agent. This page records the tools used and why, how the prompts changed
and what made them change, and which parts GenAI did and which a person decided. Commit hashes point
to the change itself.

## Tools and why each was chosen

| Tool                                                            | Used for                                                                                 | Why                                                                                                                     |
| --------------------------------------------------------------- | ---------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Claude Code (Anthropic)                                         | drafting the spec, then writing the code, tests and docs under the developer's direction | one agent that can read the repo, run the checks and deploy, so every change is verified before it lands                |
| Google Gemini (`gemini-3.5-flash-lite`) through `@google/genai` | the personal advice and the answers inside the app                                       | follows a JSON response shape, answers in Indian languages, and with minimal thinking a full answer takes a few seconds |
| Gemini Flash models, as an outside reviewer                     | reading the whole repository and listing its weakest points before a submission          | the event's evaluator is Gemini, so a Gemini review is the closest preview of what it will notice                       |
| Open-Meteo                                                      | the hourly air-quality forecast (CAMS) and place search                                  | free, needs no key, covers every city, and gives all six pollutants hour by hour                                        |
| Vercel                                                          | hosting the page and the one API function                                                | static hosting and a serverless function from one repository, with security headers set in `vercel.json`                |
| Vitest, fast-check, Playwright with axe, Stryker                | unit, property, end-to-end, accessibility and mutation tests                             | see [TESTING.md](TESTING.md)                                                                                            |
| GitHub Actions, CodeQL, Gitleaks                                | continuous checks on every push                                                          | the same bar as `npm run verify`, plus code scanning and secret scanning                                                |

## Who did what

**The developer decided:**

- to build an original entry rather than rework someone else's;
- the rule the whole design follows: **the engine computes, the AI explains**;
- the scope, by approving the written spec before any code was written;
- to give the interface more polish than the first draft had;
- to keep improving code quality after each score, rather than settle;
- what went live: the Gemini key is theirs and was set by them in Vercel.

**GenAI did:**

- **Claude Code** drafted the spec and wrote nearly all of the code, tests and documentation, ran
  every check, deployed, and assembled the demo video. The developer reviewed and steered each step.
- **Gemini, inside the app,** writes the advice and answers. It never computes a number: it receives
  the engine's results as numbered facts and must cite them (see below).
- **Gemini, as a reviewer,** listed weaknesses in the code. Each finding was checked; the ones that
  were real were fixed with tests, and the rest were left with a reason.

**Neither did:** the numbers. Every coefficient comes from a published source (US EPA, CPCB, AHAM
and others, listed in [METHODS.md](METHODS.md)), and the engine is tested against official tables
and analytic solutions.

## How the app's prompt evolved

The prompt lives in `src/ai/prompt.ts` and the facts it carries in `src/ai/facts.ts`. Each change
came from something the live model did:

1. **The schema was too strict for Gemini.** The first response schema listed the plan's fact ids as
   an enum in every list. Gemini rejected it with "too many states". The schema became shape-only,
   and the server now checks every cited id and every length itself, item by item, which is
   stricter than the schema could be (`0741b45`, `server/answer.ts`).
2. **The model was sometimes overloaded.** Gemini answered 503 for minutes at a time in Indian
   evenings. The call now retries once, only when refused fast enough to fit the function's time
   limit, and otherwise tells the person the AI is busy (`9175e7d`, `e3315a0`).
3. **An AQI was read as a concentration.** A live answer described the day's AQI as if it were a
   PM2.5 level in µg/m³. The system instruction now says an AQI is an index, and the fact itself says
   "an index, not µg/m³"
   (`e77102e`).
4. **User text is data, never instructions.** Names, the place and questions are sanitized, capped
   and sent only inside the JSON data block. A corpus of injection attempts is replayed in
   `tests/unit/prompt.test.ts` on every run.
5. **The wording moved out of the engine.** Facts were first written inside the engine. They now
   live in `src/ai/facts.ts`, and each change has one wording that both the screen and the model
   read, so the advice and the page never describe the same change differently (`8e97dfc`,
   `464a1fa`).

## How the development prompts evolved

1. **Spec first.** The problem statement became a written spec, with the engine rule and the
   evaluation axes in it, and the developer approved it before any code.
2. **Build in layers.** Tooling, then the engine, then the API, then the interface, each committed
   with its tests (`c54c129` to `0171530`).
3. **Harden against the real model.** Going live with Gemini exposed the schema, overload and AQI
   problems above; each became a fix and a test.
4. **Review, then fix what is real.** After each evaluation the agent was asked to find the weakest
   code. Asking Gemini directly for a score said little, so the prompt changed to "a strict reviewer
   gave this 89; what kept it from 95?", which produced specific findings. Those led to real fixes:
   a cache that returned another request's metadata, a missing reading silently counted as zero,
   text cut in the middle of an emoji, and two descriptions of the same change (`00a337f` to
   `19d513b`).

## Limits of the AI parts

- The advice is phrasing over the engine's numbers. When Gemini is busy or unavailable, the page
  still shows every number, ranking and what-if; only the written advice is missing.
- The forecast is a model (CAMS through Open-Meteo), not a ground station. The page names its source
  and the time the data was fetched.
