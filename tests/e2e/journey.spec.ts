/**
 * The sample family's journey in a real browser, on desktop and mobile, under the production CSP.
 * Does: open the sample, read the air and the people, switch to tomorrow, try a what-if (no
 * request), sort the ledger, get advice (exactly one `/api/plan` call) and ask a question, and
 * check there is no console error (a CSP violation would show as one) and no sideways scroll.
 * Never does: reach a real model or the network.
 */
import { expect, test } from '@playwright/test';
import { ADVICE_SUMMARY, openSample, prepare, sidewaysOverflow } from './helpers.js';

test('the sample family, from the air to personal advice', async ({ page }) => {
  const { requests, errors } = await prepare(page);
  await openSample(page);

  await expect(page.getByText('Sample data', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /^Hourly PM2.5 for 2026-11-18/u })).toBeVisible();
  for (const name of ['Ravi', 'Asha', 'Kabir', 'Nani'])
    await expect(page.getByRole('heading', { level: 3, name, exact: true })).toBeVisible();
  await expect(page.getByText(/Nani's walk/u)).toBeVisible();

  await page.getByRole('button', { name: 'Tomorrow' }).click();
  await expect(page.getByRole('heading', { level: 2, name: /^Tomorrow's air/u })).toBeVisible();

  const before = requests.length;
  await page.locator('#wi-purifier').selectOption('large');
  await expect(page.getByText(/lower than now/u).first()).toBeVisible();
  expect(requests.length).toBe(before);
  await page.getByRole('button', { name: 'Reset' }).click();

  await page.getByLabel('Sort by').selectOption('climate');
  await page.getByRole('button', { name: 'Cooking', exact: true }).click();
  await expect(page.getByText(/choices? shown/u)).toBeVisible();

  await page.getByRole('button', { name: 'Get personal advice' }).click();
  await expect(page.locator('.advice__summary')).toHaveText(ADVICE_SUMMARY);
  expect(requests.filter((r) => r.path === '/api/plan')).toHaveLength(1);
  await page
    .getByRole('button', { name: /^Fact \d+$/u })
    .first()
    .click();
  await expect(page.locator('.cites__fact').first()).toBeVisible();

  await page.getByLabel('Your question about this day').fill('When should we open the windows?');
  await page.getByRole('button', { name: 'Ask', exact: true }).click();
  await expect(page.getByText('Late afternoon is the better time.')).toBeVisible();
  expect(requests.filter((r) => r.path === '/api/ask')).toHaveLength(1);

  expect(await sidewaysOverflow(page)).toEqual([]);
  expect(errors).toEqual([]);
});

test('a household built by hand reaches its dashboard', async ({ page }) => {
  const { errors } = await prepare(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Use sample: New Delhi' }).click();
  await page.getByLabel('Name').first().fill('Mira');
  await page.getByRole('button', { name: 'Show my plan' }).click();
  await expect(page.getByRole('heading', { level: 3, name: 'Mira' })).toBeVisible();
  expect(errors).toEqual([]);
});

test('a bad form shows an error summary that leads to the field', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await page.getByRole('button', { name: 'Show my plan' }).click();
  const summary = page.getByRole('alert');
  await expect(summary).toBeFocused();
  await summary.getByRole('link', { name: /Search for your place/u }).click();
  await expect(page.getByLabel('Where do you live?')).toBeFocused();
});
