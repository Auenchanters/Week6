/**
 * The keyboard-only journey, under the production CSP.
 * Does: reach the sample family and its advice with Tab, Enter and Space alone (skip link, sample
 * button, day switch, advice, a cited fact, the AI-at-work text), and check every stop draws a
 * focus ring and that the scrollable `<pre>` can take focus.
 * Never does: use the mouse.
 */
import { expect, test, type Locator, type Page } from '@playwright/test';
import { ADVICE_SUMMARY, prepare } from './helpers.js';

/** Whether the focused element matches `:focus-visible` and has an outline drawn. */
const focusIsVisible = (page: Page): Promise<boolean> =>
  page.evaluate(() => {
    const el = document.activeElement;
    if (!el || el === document.body) return false;
    const { outlineStyle, outlineWidth } = getComputedStyle(el);
    return el.matches(':focus-visible') && outlineStyle !== 'none' && parseFloat(outlineWidth) > 0;
  });

/** Presses Tab until `target` has focus, checking each stop shows a ring; fails after `max` presses. */
async function tabTo(page: Page, target: Locator, max = 120): Promise<void> {
  for (let i = 0; i < max; i += 1) {
    await page.keyboard.press('Tab');
    expect(await focusIsVisible(page), 'every tab stop shows a focus ring').toBe(true);
    if (await target.evaluate((el) => el === document.activeElement)) return;
  }
  throw new Error('never reached the target with Tab');
}

test('from the first Tab to personal advice without a mouse', async ({ page }) => {
  await prepare(page);
  await page.goto('/');
  await expect(page.getByRole('button', { name: 'See the sample family' })).toBeVisible();

  await page.keyboard.press('Tab');
  await expect(page.getByRole('link', { name: 'Skip to main content' })).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(page.locator('main')).toBeFocused();

  await tabTo(page, page.getByRole('button', { name: 'See the sample family' }));
  await page.keyboard.press('Enter');
  await expect(page.getByRole('heading', { level: 1, name: 'New Delhi, India' })).toBeVisible();
  await expect(page.locator('main')).toBeFocused();

  await tabTo(page, page.getByRole('button', { name: 'Tomorrow' }));
  await page.keyboard.press('Space');
  await expect(page.getByRole('button', { name: 'Tomorrow' })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await tabTo(page, page.getByRole('button', { name: 'Get personal advice' }));
  await page.keyboard.press('Enter');
  await expect(page.locator('.advice__summary')).toHaveText(ADVICE_SUMMARY);

  await tabTo(page, page.getByRole('button', { name: /^Fact \d+$/u }).first());
  await page.keyboard.press('Enter');
  await expect(page.locator('.cites__fact').first()).toBeVisible();

  await tabTo(page, page.getByText('See exactly what the AI is told'));
  await page.keyboard.press('Enter');
  await tabTo(page, page.locator('pre').first());
  await page.keyboard.press('ArrowDown');
});
