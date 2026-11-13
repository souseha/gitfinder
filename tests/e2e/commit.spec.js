import { test, expect, openFolder, COMMIT_SHA, NEXT_COMMIT_SHA, NEXT_COMMIT_MESSAGE, PARENT_SHA, COMMIT_MESSAGE, COMMIT_README } from './fixtures.js';

const item = (page, path) => page.locator(`[data-path="${path}"]`);

async function openCommit(page, path = '') {
  await page.goto(`/demo/assets/commit/${COMMIT_SHA}${path ? `/${path}` : ''}`);
  await expect(page.locator('#status')).toContainText('item');
}

test('opens a commit from a pasted GitHub URL', async ({ page }) => {
  await page.goto('/');
  await page.locator('#welcome-input').fill(`https://github.com/demo/assets/commit/${COMMIT_SHA}.patch`);
  await page.locator('#welcome-input').press('Enter');
  await expect(page).toHaveURL(new RegExp(`/demo/assets/commit/${COMMIT_SHA}$`));
  await expect(page.locator('#commit-bar')).toContainText(COMMIT_MESSAGE);
  await expect(page.locator('#commit-bar')).toContainText(COMMIT_SHA.slice(0, 7));
  await expect(item(page, 'spine')).toBeVisible();
  await expect(item(page, 'ui')).toBeVisible();
  await expect(item(page, 'docs')).toBeVisible();
});

test('filters by status together with images only', async ({ page }) => {
  await openCommit(page, 'spine/char');
  await expect(page.locator('.icon-item')).toHaveCount(4);
  await page.locator('[data-change-filter="added"]').click();
  await expect(page.locator('.icon-item')).toHaveCount(2);
  await expect(item(page, 'spine/char/new1.png')).toBeVisible();
  await expect(item(page, 'spine/char/new2.png')).toBeVisible();
  await page.locator('#btn-images').click();
  await expect(page.locator('.icon-item')).toHaveCount(2);
  await page.locator('[data-change-filter="all"]').click();
  await expect(page.locator('.icon-item')).toHaveCount(4);
});

test('removed images load from the parent commit', async ({ page }) => {
  await openCommit(page, 'spine/char');
  await expect(item(page, 'spine/char/old.png').locator('img')).toHaveAttribute('data-raw', new RegExp(PARENT_SHA));
  await expect(item(page, 'spine/char/new1.png').locator('img')).toHaveAttribute('data-raw', new RegExp(COMMIT_SHA));
});

test('keeps branch and commit as separate recents', async ({ page }) => {
  await openFolder(page);
  await openCommit(page);
  await expect(page.locator('#repo-list .repo-item')).toHaveCount(2);
});

async function quickLook(page, path) {
  await item(page, path).click();
  await page.keyboard.press('Space');
  await expect(page.locator('#ql')).toBeVisible();
}

test('compares modified images side by side', async ({ page }) => {
  await openCommit(page, 'spine/char');
  await quickLook(page, 'spine/char/mod.png');
  await expect(page.locator('.ql-compare img[data-side="before"]')).toHaveAttribute('src', new RegExp(`${PARENT_SHA}/spine/char/mod.png$`));
  await expect(page.locator('.ql-compare img[data-side="after"]')).toHaveAttribute('src', new RegExp(`${COMMIT_SHA}/spine/char/mod.png$`));
});

test('renamed images compare against the old path', async ({ page }) => {
  await openCommit(page, 'ui');
  await quickLook(page, 'ui/b.png');
  await expect(page.locator('.ql-compare img[data-side="before"]')).toHaveAttribute('src', new RegExp(`${PARENT_SHA}/ui/a.png$`));
});

test('added images show a single image', async ({ page }) => {
  await openCommit(page, 'spine/char');
  await quickLook(page, 'spine/char/new1.png');
  await expect(page.locator('#ql-stage .ql-img')).toHaveCount(1);
  await expect(page.locator('.ql-compare')).toHaveCount(0);
});

async function openFromSidebar(page, input) {
  await page.locator('#repo-input').fill(input);
  await page.locator('#repo-input').press('Enter');
}

test('a tree at the same sha shows the full tree, not the commit', async ({ page }) => {
  await openCommit(page);
  await openFromSidebar(page, `demo/assets/tree/${COMMIT_SHA}`);
  await expect(page).toHaveURL(new RegExp(`/demo/assets/tree/${COMMIT_SHA}$`));
  await expect(item(page, 'icons')).toBeVisible();
  await expect(page.locator('#commit-bar')).toBeHidden();
});

test('a commit at a sha already opened as a tree shows the commit', async ({ page }) => {
  await page.goto(`/demo/assets/tree/${COMMIT_SHA}`);
  await expect(item(page, 'icons')).toBeVisible();
  await openFromSidebar(page, `https://github.com/demo/assets/commit/${COMMIT_SHA}`);
  await expect(page).toHaveURL(new RegExp(`/demo/assets/commit/${COMMIT_SHA}$`));
  await expect(page.locator('#commit-bar')).toBeVisible();
  await expect(item(page, 'icons')).toHaveCount(0);
});

test('clicking an image in the compare view does not zoom', async ({ page }) => {
  await openCommit(page, 'spine/char');
  await quickLook(page, 'spine/char/mod.png');
  await page.locator('.ql-compare img[data-side="before"]').click();
  await expect(page.locator('#ql-stage')).not.toHaveClass(/zoom/);
});

test('Quick Look text shows the version at the commit', async ({ page }) => {
  await openFolder(page, 'docs');
  await quickLook(page, 'docs/readme.md');
  await expect(page.locator('#ql-stage')).toContainText('Demo readme');
  await page.keyboard.press('Escape');
  await openFromSidebar(page, `demo/assets/commit/${COMMIT_SHA}/docs`);
  await expect(page.locator('#commit-bar')).toBeVisible();
  await quickLook(page, 'docs/readme.md');
  await expect(page.locator('#ql-stage')).toContainText(COMMIT_README);
});

test('sidebar Open in New Tab keeps a commit as a commit', async ({ page }) => {
  await openCommit(page);
  await page.locator('#repo-list .repo-item').first().click({ button: 'right' });
  const popup = page.waitForEvent('popup');
  await page.getByText('Open in New Tab').click();
  await expect(await popup).toHaveURL(new RegExp(`/demo/assets/commit/${COMMIT_SHA}$`));
});

test('a newer commit replaces the older commit in the sidebar', async ({ page }) => {
  await openFolder(page);
  await openFromSidebar(page, `demo/assets/commit/${COMMIT_SHA}`);
  await expect(page.locator('#commit-bar')).toContainText(COMMIT_MESSAGE);
  await openFromSidebar(page, `demo/assets/commit/${NEXT_COMMIT_SHA}`);
  await expect(page.locator('#commit-bar')).toContainText(NEXT_COMMIT_MESSAGE);
  const items = page.locator('#repo-list .repo-item');
  await expect(items).toHaveCount(2);
  await expect(items.filter({ hasText: NEXT_COMMIT_MESSAGE })).toHaveCount(1);
  await expect(items.filter({ hasText: COMMIT_MESSAGE })).toHaveCount(0);
});

test('the modified filter includes renamed files', async ({ page }) => {
  await openCommit(page);
  await expect(page.locator('#commit-bar [data-change-filter]')).toHaveCount(4);
  await expect(page.locator('[data-change-filter="renamed"]')).toHaveCount(0);
  await expect(page.locator('[data-change-filter="modified"] .n')).toHaveText('3');
  await page.locator('[data-change-filter="modified"]').click();
  await expect(item(page, 'ui')).toBeVisible();
  await expect(item(page, 'docs')).toBeVisible();
  await expect(item(page, 'spine')).toBeVisible();
});

const flatButton = (page) => page.locator('#commit-bar [data-scope="flat"]');
const folderButton = (page) => page.locator('#commit-bar [data-scope="folders"]');
const showFlat = (page) => flatButton(page).click();
const showFolders = (page) => folderButton(page).click();

test('overview flattens every changed file with its folder', async ({ page }) => {
  await openCommit(page);
  await showFlat(page);
  await expect(page.locator('.icon-item')).toHaveCount(6);
  await expect(item(page, 'spine')).toHaveCount(0);
  await expect(item(page, 'spine/char/new1.png').locator('.sub')).toContainText('spine/char');
  await expect(page.locator('#title')).toHaveText('All changes');
  await expect(flatButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(folderButton(page)).toHaveAttribute('aria-pressed', 'false');
});

test('overview works with the status filter', async ({ page }) => {
  await openCommit(page);
  await showFlat(page);
  await page.locator('[data-change-filter="added"]').click();
  await expect(page.locator('.icon-item')).toHaveCount(2);
  await page.locator('[data-change-filter="removed"]').click();
  await expect(page.locator('.icon-item')).toHaveCount(1);
  await expect(item(page, 'spine/char/old.png')).toBeVisible();
});

test('column view shows the icon grid in overview', async ({ page }) => {
  await openCommit(page);
  await showFlat(page);
  await page.locator('[data-view="column"]').click();
  await expect(page.locator('.icon-item')).toHaveCount(6);
});

test('opening a file in overview starts Quick Look', async ({ page }) => {
  await openCommit(page);
  await showFlat(page);
  await item(page, 'spine/char/new1.png').click();
  await page.keyboard.press('Enter');
  await expect(page.locator('#ql')).toBeVisible();
  await expect(flatButton(page)).toHaveAttribute('aria-pressed', 'true');
});

test('overview turns off for another commit', async ({ page }) => {
  await openCommit(page);
  await showFlat(page);
  await openFromSidebar(page, `demo/assets/commit/${NEXT_COMMIT_SHA}`);
  await expect(page.locator('#commit-bar')).toContainText(NEXT_COMMIT_MESSAGE);
  await expect(folderButton(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(item(page, 'docs')).toBeVisible();
});

test('empty overview shows a commit message', async ({ page }) => {
  await page.goto(`/demo/assets/commit/${NEXT_COMMIT_SHA}`);
  await expect(item(page, 'docs')).toBeVisible();
  await showFlat(page);
  await page.locator('#btn-images').click();
  await expect(page.locator('.empty')).toContainText('No matching changes in this commit');
});

test('overview pins the location to the repository root', async ({ page }) => {
  await openCommit(page, 'spine/char');
  await showFlat(page);
  await expect(page).toHaveURL(new RegExp(`/demo/assets/commit/${COMMIT_SHA}$`));
  await expect(page.locator('#crumbs .crumb')).toHaveCount(1);
  await expect(page.locator('#btn-back')).toBeDisabled();
  await page.locator('#content').focus();
  await page.keyboard.press('Backspace');
  await expect(page).toHaveURL(new RegExp(`/demo/assets/commit/${COMMIT_SHA}$`));
  await expect(page.locator('.icon-item')).toHaveCount(6);
});

test('closing overview returns to the folder you were in', async ({ page }) => {
  await openCommit(page, 'spine/char');
  await showFlat(page);
  await showFolders(page);
  await expect(page).toHaveURL(new RegExp(`/demo/assets/commit/${COMMIT_SHA}/spine/char$`));
  await expect(page.locator('.icon-item')).toHaveCount(4);
  await expect(page.locator('#btn-back')).toBeEnabled();
});

test('the commit sha links to the commit on GitHub', async ({ page }) => {
  await openCommit(page);
  const link = page.locator('#commit-bar a.commit-sha');
  await expect(link).toHaveText(COMMIT_SHA.slice(0, 7));
  await expect(link).toHaveAttribute('href', `https://github.com/demo/assets/commit/${COMMIT_SHA}`);
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('rel', /noopener/);
  await expect(link).toHaveAttribute('aria-label', 'Open this commit on GitHub');
});
