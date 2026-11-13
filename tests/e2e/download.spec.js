import { readFileSync } from 'node:fs';
import { unzipSync, strFromU8 } from 'fflate';
import { test, expect, openFolder } from './fixtures.js';

const item = (page, path) => page.locator(`[data-path="${path}"]`);

async function unzipDownload(download) {
  return unzipSync(new Uint8Array(readFileSync(await download.path())));
}

test('downloads a single file from Quick Look', async ({ page }) => {
  await openFolder(page, 'docs');
  await item(page, 'docs/readme.md').click();
  await page.keyboard.press('Space');
  const [download] = await Promise.all([page.waitForEvent('download'), page.locator('#ql-dl').click()]);
  expect(download.suggestedFilename()).toBe('readme.md');
  expect(readFileSync(await download.path(), 'utf8')).toContain('Demo readme');
});

test('downloads a folder as a zip from the context menu', async ({ page }) => {
  await openFolder(page);
  await item(page, 'docs').click({ button: 'right' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#ctx .ctx-item', { hasText: 'Download Folder' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('docs.zip');
  const files = await unzipDownload(download);
  expect(Object.keys(files).sort()).toEqual(['docs/guide.txt', 'docs/readme.md']);
  expect(strFromU8(files['docs/guide.txt'])).toBe('guide text');
  await expect(page.locator('#toast')).toContainText('2 files');
});

test('downloads a multi-selection as one zip', async ({ page }) => {
  await openFolder(page, 'photos');
  await item(page, 'photos/a.png').click();
  await item(page, 'photos/b.png').click({ modifiers: ['ControlOrMeta'] });
  await item(page, 'photos/b.png').click({ button: 'right' });
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.locator('#ctx .ctx-item', { hasText: 'Download 2 Items' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('photos.zip');
  expect(Object.keys(await unzipDownload(download)).sort()).toEqual(['a.png', 'b.png']);
});
