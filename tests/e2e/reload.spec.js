import { test, expect, openFolder } from './fixtures.js';

const treeRequests = (page) => {
  const seen = [];
  page.on('request', (req) => { if (req.url().includes('/git/trees/main')) seen.push(req.url()); });
  return seen;
};

test('reloading the page reuses the cached tree and still shows the quota', async ({ page }) => {
  const trees = treeRequests(page);
  await openFolder(page, 'photos');
  await expect(page.locator('#rate')).toContainText('57/60');
  await page.reload();
  await expect(page.locator('#status')).toContainText('items');
  expect(trees).toHaveLength(1);
  await expect(page.locator('#rate')).toContainText('57/60');
});

test('Reload from GitHub skips the cache', async ({ page }) => {
  const trees = treeRequests(page);
  await openFolder(page, 'photos');
  await page.locator('#content').click({ button: 'right', position: { x: 600, y: 500 } });
  await page.getByRole('menuitem', { name: 'Reload from GitHub' }).click();
  await expect.poll(() => trees.length).toBe(2);
  await expect(page.locator('#status')).toContainText('items');
  await expect(page).toHaveURL(/\/demo\/assets\/tree\/main\/photos$/);
});
