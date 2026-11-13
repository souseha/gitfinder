import { test, expect, openFolder, COMMIT_SHA, PARENT_SHA, PULL_NUMBER, PULL_TITLE } from './fixtures.js';

const item = (page, path) => page.locator(`[data-path="${path}"]`);

async function openPull(page, path = '') {
  await page.goto(`/demo/assets/pull/${PULL_NUMBER}${path ? `/${path}` : ''}`);
  await expect(page.locator('#status')).toContainText('item');
}

test('opens a pull request from a pasted GitHub URL', async ({ page }) => {
  await page.goto('/');
  await page.locator('#welcome-input').fill(`https://github.com/demo/assets/pull/${PULL_NUMBER}/files`);
  await page.locator('#welcome-input').press('Enter');
  await expect(page).toHaveURL(new RegExp(`/demo/assets/pull/${PULL_NUMBER}$`));
  const bar = page.locator('#commit-bar');
  await expect(bar).toContainText(`#${PULL_NUMBER}`);
  await expect(bar).toContainText(PULL_TITLE);
  await expect(bar.locator('.pull-state')).toHaveText('Open');
  await expect(bar.locator('.commit-sha')).toHaveAttribute('href', `https://github.com/demo/assets/pull/${PULL_NUMBER}`);
  await expect(page.locator('.branch-chip')).toHaveText(`#${PULL_NUMBER}`);
  await expect(item(page, 'spine')).toBeVisible();
});

test('opens a folder inside a pull request from the app URL', async ({ page }) => {
  await openPull(page, 'spine/char');
  await expect(page.locator('.icon-item')).toHaveCount(4);
  await expect(page).toHaveURL(new RegExp(`/demo/assets/pull/${PULL_NUMBER}/spine/char$`));
});

test('compares against the merge base', async ({ page }) => {
  await openPull(page, 'spine/char');
  await expect(item(page, 'spine/char/old.png').locator('img')).toHaveAttribute('data-raw', new RegExp(PARENT_SHA));
  await item(page, 'spine/char/mod.png').click();
  await page.keyboard.press('Space');
  await expect(page.locator('.ql-compare img[data-side="before"]')).toHaveAttribute('src', new RegExp(`${PARENT_SHA}/spine/char/mod.png$`));
  await expect(page.locator('.ql-compare img[data-side="after"]')).toHaveAttribute('src', new RegExp(`${COMMIT_SHA}/spine/char/mod.png$`));
});

test('keeps the pull request as its own recent entry', async ({ page }) => {
  await openFolder(page);
  await page.goto(`/demo/assets/commit/${COMMIT_SHA}`);
  await expect(page.locator('#status')).toContainText('item');
  await openPull(page);
  await expect(page.locator('#repo-list .repo-item')).toHaveCount(3);
  await expect(page.locator('#repo-list .repo-item.active')).toContainText(`#${PULL_NUMBER} ${PULL_TITLE}`);
});
