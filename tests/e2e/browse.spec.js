import { test, expect, openFolder, ICON_COUNT } from './fixtures.js';

const item = (page, path) => page.locator(`[data-path="${path}"]`);

test('opens a repository from the home page', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('.welcome h1')).toHaveText('GitFinder');
  await expect(page.locator('#btn-settings')).toContainText('Settings'); // 預設英文
  await page.locator('#welcome-input').fill('https://github.com/demo/assets');
  await page.locator('#welcome-input').press('Enter');
  await expect(page).toHaveURL(/\/demo\/assets\/tree\/main$/);
  await expect(item(page, 'icons')).toBeVisible();
  await expect(page.locator('#repo-list')).toContainText('assets');
});

test('deep links open the matching folder', async ({ page }) => {
  await openFolder(page, 'photos');
  await expect(page.locator('#title')).toHaveText('photos');
  await expect(item(page, 'photos/a.png')).toBeVisible();
  await expect(page.locator('#status')).toContainText('3 items');
});

test('Back walks up from a deep link', async ({ page }) => {
  await openFolder(page, 'photos');
  await expect(page.locator('#btn-back')).toBeEnabled();
  await page.locator('#btn-back').click();
  await expect(page).toHaveURL(/\/demo\/assets\/tree\/main$/);
  await expect(page.locator('[data-path="photos"]')).toHaveClass(/selected/);
  await expect(page.locator('#btn-back')).toBeDisabled();
  await expect(page.locator('#btn-fwd')).toBeEnabled();
});

test('switches between icon, list and column views', async ({ page }) => {
  await openFolder(page, 'photos');
  await page.locator('[data-view="list"]').click();
  await expect(page.locator('.row[data-path="photos/b.png"]')).toBeVisible();
  await page.locator('[data-view="column"]').click();
  await page.locator('.col-item[data-path="photos/c.jpg"]').click();
  await expect(page.locator('.col-preview .pv-name')).toHaveText('c.jpg');
  await page.locator('[data-view="icon"]').click();
  await expect(page.locator('.icon-item[data-path="photos/c.jpg"]')).toHaveClass(/selected/);
});

test('renders only visible items in very large folders', async ({ page }) => {
  await openFolder(page, 'icons');
  await expect(page.locator('#status')).toContainText(`${ICON_COUNT} items`);
  const rendered = await page.locator('.icon-item').count();
  expect(rendered).toBeGreaterThan(0);
  expect(rendered).toBeLessThan(200);

  await page.locator('#content').evaluate((el) => { el.scrollTop = el.scrollHeight; });
  await expect(item(page, `icons/icon${ICON_COUNT}.png`)).toBeVisible();
  expect(await page.locator('.icon-item').count()).toBeLessThan(200);

  // 列表檢視一樣只畫可見列
  await page.locator('[data-view="list"]').click();
  expect(await page.locator('.row').count()).toBeLessThan(120);
});

test('keyboard selection scrolls far items into view', async ({ page }) => {
  await openFolder(page, 'icons');
  await item(page, 'icons/icon0001.png').click();
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.locator('#status')).toContainText(`${ICON_COUNT} selected`);

  await item(page, 'icons/icon0001.png').click();
  const cols = await page.evaluate(() => window.GF.app.gridCols());
  for (let i = 0; i < 100; i += 1) await page.keyboard.press('ArrowDown');
  const target = `icons/icon${String(1 + cols * 100).padStart(4, '0')}.png`;
  await expect(item(page, target)).toBeInViewport();
  await expect(item(page, target)).toHaveClass(/selected/);
  await expect(page.locator('.icon-item.selected')).toHaveCount(1);
});

test('Quick Look previews images and text, with arrow navigation', async ({ page }) => {
  await openFolder(page, 'photos');
  await item(page, 'photos/a.png').click();
  await page.keyboard.press('Space');
  const ql = page.locator('#ql');
  await expect(ql).toBeVisible();
  await expect(page.locator('#ql-title')).toHaveText('a.png');
  await expect(page.locator('.ql-thumb')).toHaveCount(3);
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#ql-title')).toHaveText('b.png');
  await page.keyboard.press('Escape');
  await expect(ql).toBeHidden();
  await expect(item(page, 'photos/b.png')).toHaveClass(/selected/); // 燈箱切換會同步選取

  await openFolder(page, 'docs');
  await item(page, 'docs/readme.md').dblclick();
  await expect(page.locator('.ql-text')).toContainText('Hello from the fixture.');
});

test('search finds files across the repository', async ({ page }) => {
  await openFolder(page);
  await page.locator('#search').fill('icon2499');
  await expect(page.locator('#status')).toContainText('1 found');
  await expect(item(page, 'icons/icon2499.png')).toBeVisible();
  await page.locator('#search').press('Escape');
  await expect(item(page, 'icons')).toBeVisible();
});

test('multi-select with modifier clicks and marquee', async ({ page }) => {
  await openFolder(page, 'photos');
  await item(page, 'photos/a.png').click();
  await item(page, 'photos/c.jpg').click({ modifiers: ['ControlOrMeta'] });
  await expect(page.locator('#status')).toContainText('2 selected');
  // Shift 從錨點（上一次 ⌘ 點的 c.jpg）選到 a.png → a、b、c
  await item(page, 'photos/a.png').click({ modifiers: ['Shift'] });
  await expect(page.locator('.icon-item.selected')).toHaveCount(3);
  await item(page, 'photos/b.png').click();
  await expect(page.locator('.icon-item.selected')).toHaveCount(1);

  // 從空白處拖曳框選全部三個項目
  const box = await page.locator('#content').boundingBox();
  await page.mouse.move(box.x + box.width - 10, box.y + box.height - 10);
  await page.mouse.down();
  await page.mouse.move(box.x + 5, box.y + 5, { steps: 8 });
  await page.mouse.up();
  await expect(page.locator('.icon-item.selected')).toHaveCount(3);
});

test('context menus depend on where you click and close on outside clicks', async ({ page }) => {
  await openFolder(page, 'photos');
  const menu = page.locator('#ctx');
  await item(page, 'photos/a.png').click({ button: 'right' });
  await expect(menu).toBeVisible();
  await expect(menu).toContainText('Copy Image');
  await expect(menu).toContainText('Copy Name');

  const box = await page.locator('#content').boundingBox();
  await page.mouse.click(box.x + box.width - 20, box.y + box.height - 20); // 空白處
  await expect(menu).toBeHidden();

  await page.mouse.click(box.x + box.width - 20, box.y + box.height - 20, { button: 'right' });
  await expect(menu).toContainText('Select All');
  await expect(menu).toContainText('View as');
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
});

test('sidebar collapses and remembers it', async ({ page }) => {
  await openFolder(page);
  await page.locator('#btn-sidebar').click();
  await expect(page.locator('#app')).toHaveClass(/sidebar-collapsed/);
  await page.reload();
  await expect(page.locator('#app')).toHaveClass(/sidebar-collapsed/);
  await page.keyboard.press('ControlOrMeta+Alt+KeyS');
  await expect(page.locator('#app')).not.toHaveClass(/sidebar-collapsed/);
});

test('settings switch language and theme', async ({ page }) => {
  await page.goto('/');
  await page.locator('#btn-settings').click();
  await page.locator('#lang-select').selectOption('zh-Hant');
  await page.locator('[data-theme-opt="dark"]').click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.getByRole('button', { name: '儲存' }).click();
  await expect(page.locator('#btn-settings')).toContainText('設定');
});
