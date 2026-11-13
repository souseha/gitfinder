import { test, expect, openFolder } from './fixtures.js';

/** 找出畫面上「只有圖示、沒有文字」的按鈕與連結，回傳不是正方形的那些 */
const nonSquareIconButtons = (page) =>
  page.evaluate(() => {
    const isIconOnly = (el) => !!el.querySelector('svg') && el.textContent.trim() === '';
    return [...document.querySelectorAll('button, a')]
      .filter((el) => el.offsetParent !== null && isIconOnly(el))
      .map((el) => {
        const r = el.getBoundingClientRect();
        return { id: el.id || el.className, w: Math.round(r.width * 10) / 10, h: Math.round(r.height * 10) / 10 };
      })
      .filter(({ w, h }) => w !== h);
  });

test('icon-only buttons in the main window are square', async ({ page }) => {
  await openFolder(page, 'photos');
  expect(await nonSquareIconButtons(page)).toEqual([]);
});

test('icon-only buttons in Quick Look are square', async ({ page }) => {
  await openFolder(page, 'photos');
  await page.locator('[data-path="photos/a.png"]').click();
  await page.keyboard.press('Space');
  await expect(page.locator('#ql')).toBeVisible();
  expect(await nonSquareIconButtons(page)).toEqual([]);
});

/** 只有圖示的按鈕，圖示中心要和按鈕中心對齊（誤差 0.5px 內） */
const offCenterIcons = (page) =>
  page.evaluate(() => {
    const isIconOnly = (el) => !!el.querySelector('svg') && el.textContent.trim() === '';
    return [...document.querySelectorAll('button, a')]
      .filter((el) => el.offsetParent !== null && isIconOnly(el))
      .map((el) => {
        const b = el.getBoundingClientRect();
        const s = el.querySelector('svg').getBoundingClientRect();
        const dx = s.left + s.width / 2 - (b.left + b.width / 2);
        const dy = s.top + s.height / 2 - (b.top + b.height / 2);
        return { id: el.id || el.className || el.dataset.view, dx: Math.round(dx * 10) / 10, dy: Math.round(dy * 10) / 10 };
      })
      .filter(({ dx, dy }) => Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5);
  });

test('icons sit in the center of icon-only buttons', async ({ page }) => {
  await openFolder(page, 'photos');
  expect(await offCenterIcons(page)).toEqual([]);
  await page.locator('[data-path="photos/a.png"]').click();
  await page.keyboard.press('Space');
  await expect(page.locator('#ql')).toBeVisible();
  expect(await offCenterIcons(page)).toEqual([]);
});
