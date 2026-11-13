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
