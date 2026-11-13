import { test, expect } from './fixtures.js';

const TOKEN = 'ghp_test0000000000000000000000000000';

async function openSettings(page) {
  await page.goto('/');
  await page.locator('#btn-settings').click();
  await expect(page.locator('#settings')).toBeVisible();
}

const status = (page) => page.locator('#token-status');
const savedToken = (page) => page.evaluate(() => localStorage.getItem('gitfinder.token'));

test('settings are grouped and closed with a single Done button', async ({ page }) => {
  await openSettings(page);
  await expect(page.locator('#settings .set-section')).toHaveText(['Display', 'GitHub access']);
  await expect(page.locator('#settings menu button')).toHaveText(['Done']);
  await page.getByRole('button', { name: 'Done' }).click();
  await expect(page.locator('#settings')).toBeHidden();
});

test('the token section shows whether a token is set', async ({ page }) => {
  await openSettings(page);
  await expect(status(page)).toContainText('No token');
  await expect(page.locator('#token-clear')).toBeHidden();
  await page.locator('#token-input').fill(TOKEN);
  await page.locator('#token-save').click();
  await expect(status(page)).toContainText('Token set');
  await expect(page.locator('#token-clear')).toBeVisible();
  await expect(page.locator('#settings')).toBeVisible();
  expect(await savedToken(page)).toContain(TOKEN);
});

test('pressing Enter in the token field saves it without closing Settings', async ({ page }) => {
  await openSettings(page);
  await page.locator('#token-input').fill(TOKEN);
  await page.locator('#token-input').press('Enter');
  await expect(status(page)).toContainText('Token set');
  await expect(page.locator('#settings')).toBeVisible();
});

test('clearing the token returns to the no-token state', async ({ page }) => {
  await openSettings(page);
  await page.locator('#token-input').fill(TOKEN);
  await page.locator('#token-save').click();
  await page.locator('#token-clear').click();
  await expect(status(page)).toContainText('No token');
  await expect(page.locator('#token-clear')).toBeHidden();
  await expect(page.locator('#token-input')).toHaveValue('');
  expect(await savedToken(page)).toBeNull();
});

/** 相對亮度（WCAG），用來確認下拉選項的文字和底色有足夠對比 */
const luminance = (rgb) => {
  const [r, g, b] = rgb.match(/\d+(\.\d+)?/g).slice(0, 3).map(Number).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
};
const contrast = (a, b) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi + 0.05) / (lo + 0.05);
};

for (const theme of ['dark', 'light']) {
  test(`the language dropdown stays readable in the ${theme} theme`, async ({ page }) => {
    await openSettings(page);
    await page.locator(`[data-theme-opt="${theme}"]`).click();
    const styles = await page.locator('#lang-select').evaluate((select) => ({
      scheme: getComputedStyle(select).colorScheme,
      options: [...select.options].map((o) => ({ bg: getComputedStyle(o).backgroundColor, fg: getComputedStyle(o).color })),
    }));
    expect(styles.scheme).toBe(theme);
    for (const { bg, fg } of styles.options) {
      expect(bg).not.toBe('rgba(0, 0, 0, 0)');
      expect(contrast(bg, fg)).toBeGreaterThanOrEqual(4.5);
      if (theme === 'dark') expect(luminance(bg)).toBeLessThan(0.2);
      else expect(luminance(bg)).toBeGreaterThan(0.6);
    }
  });
}
