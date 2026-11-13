import { test, expect, COMMIT_SHA } from './fixtures.js';

const stage = (page) => page.locator('#ql-stage');
const zoomLabel = (page) => page.locator('#ql-zoom');
const singleImage = (page) => page.locator('#ql-stage > .ql-img');

async function quickLook(page, folder, file) {
  await page.goto(`/demo/assets/commit/${COMMIT_SHA}/${folder}`);
  await page.locator(`[data-path="${folder}/${file}"]`).click();
  await page.keyboard.press('Space');
  await expect(page.locator('#ql')).toBeVisible();
  await expect(page.locator('#ql-stage img').first()).toHaveJSProperty('complete', true);
  // 開啟時有一小段縮放動畫，動畫中量到的位置會偏移幾個像素，等它跑完再量
  await page.locator('#ql').evaluate((el) => Promise.all(el.getAnimations().map((a) => a.finished)));
}

/** 在元素中心（加上偏移）滾動滑鼠滾輪 */
async function wheelOver(page, locator, ticks, offset = { x: 0, y: 0 }) {
  const box = await locator.boundingBox();
  await page.mouse.move(box.x + box.width / 2 + offset.x, box.y + box.height / 2 + offset.y);
  for (let i = 0; i < Math.abs(ticks); i += 1) await page.mouse.wheel(0, ticks < 0 ? -100 : 100);
}

const transformOf = (locator) => locator.evaluate((el) => el.style.transform);

test('scrolling up over an image zooms in and shows the zoom level', async ({ page }) => {
  await quickLook(page, 'spine/char', 'new1.png');
  await expect(zoomLabel(page)).toHaveText('100%');
  await wheelOver(page, singleImage(page), -3);
  await expect(zoomLabel(page)).toHaveText('173%');
  expect(await transformOf(singleImage(page))).toContain('scale(1.728');
  await wheelOver(page, singleImage(page), 10);
  await expect(zoomLabel(page)).toHaveText('100%');
  expect(await transformOf(singleImage(page))).toBe('');
});

test('dragging pans a zoomed image', async ({ page }) => {
  await quickLook(page, 'spine/char', 'new1.png');
  await wheelOver(page, singleImage(page), -8);
  const before = await transformOf(singleImage(page));
  const box = await stage(page).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 5 });
  await page.mouse.up();
  const after = await transformOf(singleImage(page));
  expect(after).not.toBe(before);
  await expect(page.locator('#ql')).toBeVisible(); // 拖曳放開不能被當成點擊而關閉
});

test('the reset button, double-click and 0 return to the fitted size', async ({ page }) => {
  await quickLook(page, 'spine/char', 'new1.png');
  await wheelOver(page, singleImage(page), -4);
  await page.locator('#ql-zoom-reset').click();
  await expect(zoomLabel(page)).toHaveText('100%');
  expect(await transformOf(singleImage(page))).toBe('');

  await wheelOver(page, singleImage(page), -4);
  await singleImage(page).dblclick();
  await expect(zoomLabel(page)).toHaveText('100%');

  await wheelOver(page, singleImage(page), -4);
  await page.keyboard.press('0');
  await expect(zoomLabel(page)).toHaveText('100%');
});

test('a single click no longer toggles the actual size', async ({ page }) => {
  await quickLook(page, 'spine/char', 'new1.png');
  await singleImage(page).click();
  await expect(stage(page)).not.toHaveClass(/\bzoom\b/);
  await expect(zoomLabel(page)).toHaveText('100%');
});

test('moving to another file resets the zoom', async ({ page }) => {
  await quickLook(page, 'spine/char', 'new1.png');
  await wheelOver(page, singleImage(page), -4);
  await page.keyboard.press('ArrowRight');
  await expect(zoomLabel(page)).toHaveText('100%');
});

test('before and after zoom and pan together', async ({ page }) => {
  await quickLook(page, 'spine/char', 'mod.png');
  const before = page.locator('.ql-compare img[data-side="before"]');
  const after = page.locator('.ql-compare img[data-side="after"]');
  await wheelOver(page, before, -6, { x: 30, y: -20 });
  const zoomed = await transformOf(before);
  expect(zoomed).toContain('scale(');
  expect(await transformOf(after)).toBe(zoomed);

  const box = await after.boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 - 80, box.y + box.height / 2 - 40, { steps: 5 });
  await page.mouse.up();
  const panned = await transformOf(after);
  expect(panned).not.toBe(zoomed);
  expect(await transformOf(before)).toBe(panned);
});

test('zoom controls are hidden for text files', async ({ page }) => {
  await page.goto(`/demo/assets/commit/${COMMIT_SHA}/docs`);
  await page.locator('[data-path="docs/readme.md"]').click();
  await page.keyboard.press('Space');
  await expect(page.locator('#ql')).toBeVisible();
  await expect(page.locator('#ql-zoom-reset')).toBeHidden();
  await expect(zoomLabel(page)).toBeHidden();
});

test('clicking a zoomed image keeps Quick Look open', async ({ page }) => {
  await quickLook(page, 'spine/char', 'new1.png');
  await wheelOver(page, singleImage(page), -4);
  await singleImage(page).click();
  await expect(page.locator('#ql')).toBeVisible();
  await expect(zoomLabel(page)).toHaveText('207%');
});

test('clicking the empty area beside a zoomed-out image still closes Quick Look', async ({ page }) => {
  await quickLook(page, 'spine/char', 'new1.png');
  const box = await stage(page).boundingBox();
  // 點左上角的空白：垂直正中央的左右兩側是「上一張 / 下一張」按鈕
  await page.mouse.click(box.x + 20, box.y + 20);
  await expect(page.locator('#ql')).toBeHidden();
});

test('before and after of different sizes zoom and pan on their own', async ({ page }) => {
  await quickLook(page, 'ui', 'b.png');
  const before = page.locator('.ql-compare img[data-side="before"]');
  const after = page.locator('.ql-compare img[data-side="after"]');
  await expect(before).toHaveJSProperty('naturalWidth', 1800);
  await expect(after).toHaveJSProperty('naturalWidth', 1200);

  await wheelOver(page, before, -4);
  expect(await transformOf(before)).toContain('scale(');
  expect(await transformOf(after)).toBe('');
  await expect(zoomLabel(page)).toHaveText('207%');

  await wheelOver(page, after, -2);
  await expect(zoomLabel(page)).toHaveText('144%');
  expect(await transformOf(before)).toContain('scale(2.07');

  await page.keyboard.press('0');
  expect(await transformOf(before)).toBe('');
  expect(await transformOf(after)).toBe('');
});

test('compare captions show each version size', async ({ page }) => {
  await quickLook(page, 'ui', 'b.png');
  await expect(page.locator('.ql-compare figcaption').first()).toContainText('1800 × 900');
  await expect(page.locator('.ql-compare figcaption').last()).toContainText('1200 × 900');
});
