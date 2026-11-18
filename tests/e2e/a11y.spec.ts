/**
 * Accessibility scans with axe at WCAG 2.0 to 2.2 A and AA, in light and dark colour schemes, on
 * desktop and mobile: the landing page with its form, the form with errors showing, and the
 * dashboard with its details open and AI advice on screen.
 * Never does: accept a violation; each scan must find none.
 */
import { expect, test } from '@playwright/test';
import { axeViolations, openLanding, openSample, prepare, sidewaysOverflow } from './helpers.js';

for (const colorScheme of ['light', 'dark'] as const) {
  test.describe(`${colorScheme} scheme`, () => {
    test.use({ colorScheme });

    test('the landing page and form have no violations', async ({ page }) => {
      await prepare(page);
      await openLanding(page);
      expect(await axeViolations(page)).toEqual([]);
      await page.getByRole('button', { name: 'Show my plan' }).click();
      await expect(page.getByRole('alert')).toBeVisible();
      expect(await axeViolations(page)).toEqual([]);
    });

    test('the dashboard has no violations, with details and advice open', async ({ page }) => {
      await prepare(page);
      await openSample(page);
      expect(await axeViolations(page)).toEqual([]);
      await page.getByText('Show the hourly numbers as a table').click();
      await page.getByText('See exactly what the AI is told').click();
      await page.getByRole('button', { name: 'Get personal advice' }).click();
      await expect(page.locator('.advice__summary')).toBeVisible();
      await page
        .getByRole('button', { name: /^Fact \d+$/u })
        .first()
        .click();
      expect(await axeViolations(page)).toEqual([]);
      expect(await sidewaysOverflow(page)).toEqual([]);
    });
  });
}

test('there is exactly one h1 and one main on each screen', async ({ page }) => {
  await prepare(page);
  await openLanding(page);
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
  await page.getByRole('button', { name: 'See the sample family' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'New Delhi, India' })).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByRole('main')).toHaveCount(1);
});
