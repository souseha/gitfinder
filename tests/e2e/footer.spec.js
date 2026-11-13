import { test, expect, openFolder, rateHeaders, TREE } from './fixtures.js';

const footer = (page) => page.locator('.side-footer');
const rateChip = (page) => page.locator('#rate');

test('settings, API quota and source link sit on one row', async ({ page }) => {
  await openFolder(page);
  await expect(rateChip(page)).toContainText('57/60');
  const boxes = await Promise.all(['#btn-settings', '#rate', '.source-link'].map((s) => footer(page).locator(s).boundingBox()));
  const middles = boxes.map((b) => Math.round(b.y + b.height / 2));
  expect(Math.max(...middles) - Math.min(...middles)).toBeLessThanOrEqual(2);
  await expect(rateChip(page)).not.toHaveClass(/\blow\b/);
});

test('the quota turns into a warning when it is running low', async ({ page }) => {
  await page.route('https://api.github.com/repos/demo/assets', (route) =>
    route.fulfill({ json: { default_branch: 'main' }, headers: rateHeaders(6) }));
  await page.route('https://api.github.com/repos/demo/assets/git/trees/main**', (route) =>
    route.fulfill({ json: { tree: TREE, truncated: false }, headers: rateHeaders(5) }));
  await openFolder(page);
  await expect(rateChip(page)).toContainText('5/60');
  await expect(rateChip(page)).toHaveClass(/\blow\b/);
});

test('clicking the quota opens Settings with the token field focused', async ({ page }) => {
  await openFolder(page);
  await rateChip(page).click();
  await expect(page.locator('#settings')).toBeVisible();
  await expect(page.locator('#token-input')).toBeFocused();
});
