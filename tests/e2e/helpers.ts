/**
 * Shared pieces of the browser journeys.
 * Does: serve every response under the production Content-Security-Policy (read from vercel.json),
 * answer the four API routes with fixed, schema-valid data (the preview server has no API), record
 * each request and console error, run axe at WCAG 2.0 to 2.2 A and AA, and open the sample family.
 * Never does: reach a real model, the air-data provider or the network.
 */
import { readFileSync } from 'node:fs';
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page } from '@playwright/test';
import { sampleForecast } from '../../server/sample-forecast.js';

/** The summary the mocked advice route returns. */
export const ADVICE_SUMMARY = 'Keep windows shut today and walk in the cleaner afternoon hours.';

const META = {
  model: 'gemini-test',
  latencyMs: 900,
  inputTokens: 1200,
  outputTokens: 300,
  dropped: 0,
  requestId: '123e4567-e89b-42d3-a456-426614174000',
};

/** WCAG 2.0 to 2.2 at A and AA. */
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

/** The Content-Security-Policy the production deployment sends. */
const CSP = /"Content-Security-Policy",\s*"value":\s*"([^"]+)"/u.exec(
  readFileSync('vercel.json', 'utf8'),
)?.[1];

/** Everything the page asked the mocked API for, and every console error. */
export interface Recorded {
  readonly requests: { readonly path: string; readonly body: unknown }[];
  readonly errors: string[];
}

/**
 * Serves every response under the production CSP, answers `/api/*` with fixed data, and records
 * requests and console errors.
 */
export async function prepare(page: Page): Promise<Recorded> {
  const recorded: Recorded = { requests: [], errors: [] };
  page.on('console', (message) => {
    if (message.type() === 'error') recorded.errors.push(message.text());
  });
  await page.route('**/*', async (route) => {
    try {
      const response = await route.fetch();
      await route.fulfill({
        response,
        headers: { ...response.headers(), 'content-security-policy': CSP ?? '' },
      });
    } catch {
      // The test finished while this request (a late chunk) was in flight; nothing awaits it.
    }
  });
  // Registered last, so it runs before the catch-all above.
  await page.route('**/api/**', async (route) => {
    const { pathname } = new URL(route.request().url());
    const body: unknown =
      route.request().method() === 'POST' ? route.request().postDataJSON() : null;
    recorded.requests.push({ path: pathname, body });
    const answers: Record<string, unknown> = {
      '/api/air': sampleForecast('2026-11-18', '2026-11-19'),
      '/api/places': {
        places: [{ name: 'New Delhi, India', latitude: 28.61, longitude: 77.21 }],
      },
      '/api/plan': {
        advice: {
          summary: ADVICE_SUMMARY,
          routine: [{ text: 'Walk between 14:00 and 16:00.', cites: ['air.cleanest'] }],
          indoor: [{ text: 'Run a purifier in the bedroom.', cites: ['indoor.mean'] }],
          alternatives: [],
        },
        meta: META,
      },
      '/api/ask': {
        answer: { answer: 'Late afternoon is the better time.', cites: ['air.worst'] },
        meta: META,
      },
    };
    const answer = answers[pathname];
    await route.fulfill(
      answer === undefined
        ? { status: 404, json: { error: { code: 'NOT_FOUND', message: 'No such route.' } } }
        : { status: 200, json: answer },
    );
  });
  return recorded;
}

/** Axe violations of {@link AXE_TAGS} on the page as it is now. */
export const axeViolations = async (
  page: Page,
): Promise<Awaited<ReturnType<AxeBuilder['analyze']>>['violations']> =>
  (await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze()).violations;

/** Opens the landing page. */
export async function openLanding(page: Page): Promise<void> {
  await page.goto('/');
  await expect(
    page.getByRole('heading', { level: 1, name: 'Breathe easier through smog season' }),
  ).toBeVisible();
}

/** Opens the sample family's dashboard with the mouse. */
export async function openSample(page: Page): Promise<void> {
  await openLanding(page);
  await page.getByRole('button', { name: 'See the sample family' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New Delhi, India' })).toBeVisible();
  await expect(
    page.getByRole('heading', { level: 2, name: /^Today's air is like smoking/u }),
  ).toBeVisible();
}

/**
 * What makes the page wider than the viewport: empty when it fits, otherwise the outermost
 * elements that cross the right edge, so a failure names its cause.
 */
export const sidewaysOverflow = (page: Page): Promise<string[]> =>
  page.evaluate(() => {
    const root = document.documentElement;
    if (root.scrollWidth <= root.clientWidth) return [];
    const edge = root.clientWidth + 0.5;
    const crosses = (el: Element | null): boolean =>
      el !== null && el.getBoundingClientRect().right > edge;
    return Array.from(document.body.querySelectorAll('*'))
      .filter((el) => crosses(el) && !crosses(el.parentElement))
      .map((el) => `${el.tagName.toLowerCase()}.${el.className}`);
  });
