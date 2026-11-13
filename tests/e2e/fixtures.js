// 端對端測試用的假倉庫：攔截 GitHub API、raw 檔案、縮圖代理與 fflate CDN，不連外網
import { test as base, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

// fflate 的 package exports 沒有開放 umd 路徑，直接從 node_modules 讀檔
const FFLATE_UMD = readFileSync(resolve(import.meta.dirname, '../../node_modules/fflate/umd/index.js'));

// 1×1 透明 PNG
const PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=',
  'base64',
);

export const ICON_COUNT = 2500;
export const REPO = { owner: 'demo', name: 'assets', branch: 'main' };

const blob = (path, size = 50_000) => ({ path, type: 'blob', size });

export const TREE = [
  { path: 'icons', type: 'tree' },
  ...Array.from({ length: ICON_COUNT }, (_, i) => blob(`icons/icon${String(i + 1).padStart(4, '0')}.png`, 30_000)),
  { path: 'photos', type: 'tree' },
  blob('photos/a.png'),
  blob('photos/b.png'),
  blob('photos/c.jpg'),
  { path: 'docs', type: 'tree' },
  blob('docs/readme.md', 120),
  blob('docs/guide.txt', 80),
  blob('LICENSE', 1000),
];

export const TEXT = {
  'docs/readme.md': '# Demo readme\n\nHello from the fixture.',
  'docs/guide.txt': 'guide text',
  LICENSE: 'MIT License',
};

async function mockGitHub(page) {
  await page.route('https://api.github.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/repos/demo/assets') return route.fulfill({ json: { default_branch: 'main' } });
    if (url.pathname === '/repos/demo/assets/git/trees/main') return route.fulfill({ json: { tree: TREE, truncated: false } });
    return route.fulfill({ status: 404, json: { message: 'Not Found' } });
  });
  await page.route('https://raw.githubusercontent.com/**', (route) => {
    const path = decodeURIComponent(new URL(route.request().url()).pathname).replace('/demo/assets/main/', '');
    if (TEXT[path] != null) return route.fulfill({ body: TEXT[path], contentType: 'text/plain' });
    return route.fulfill({ body: PNG, contentType: 'image/png' });
  });
  await page.route('https://wsrv.nl/**', (route) => route.fulfill({ body: PNG, contentType: 'image/webp' }));
  await page.route('https://cdn.jsdelivr.net/npm/fflate**', (route) =>
    route.fulfill({ body: FFLATE_UMD, contentType: 'application/javascript' }));
}

export const test = base.extend({
  page: async ({ page }, use) => {
    await mockGitHub(page);
    // 每個測試從乾淨狀態開始：英文、不自動開啟上次的倉庫
    await page.addInitScript(() => {
      if (!sessionStorage.getItem('gf-test-init')) {
        localStorage.clear();
        sessionStorage.setItem('gf-test-init', '1');
      }
    });
    await use(page);
  },
});

/** 打開假倉庫的某個資料夾並等它載入完成 */
export async function openFolder(page, path = '') {
  await page.goto(`/demo/assets/tree/main${path ? `/${path}` : ''}`);
  await expect(page.locator('#status')).toContainText('items');
}

export { expect };
