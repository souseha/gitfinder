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

// 單一 commit：新增 / 刪除 / 修改 / 改名都有
export const COMMIT_SHA = 'c'.repeat(40);
export const NEXT_COMMIT_SHA = 'd'.repeat(40);
export const NEXT_COMMIT_MESSAGE = 'feat: more assets';
export const PARENT_SHA = 'e'.repeat(40);
export const COMMIT_MESSAGE = 'feat: assets update';
export const COMMIT_README = '# Readme at the commit';
const changed = (filename, status, previous_filename, changes = 0) => ({ filename, status, changes, ...(previous_filename && { previous_filename }) });
export const COMMIT_FILES = [
  changed('spine/char/new1.png', 'added'),
  changed('spine/char/new2.png', 'added'),
  changed('spine/char/old.png', 'removed'),
  changed('spine/char/mod.png', 'modified'),
  // 改名而且內容也變了（changes > 0），前後並排比較
  changed('ui/b.png', 'renamed', 'ui/a.png', 1),
  changed('docs/readme.md', 'modified'),
];

function commitResponse(url, sha) {
  const page = Number(url.searchParams.get('page') || '1');
  const isNext = sha === NEXT_COMMIT_SHA;
  return {
    sha,
    parents: [{ sha: isNext ? COMMIT_SHA : PARENT_SHA }],
    commit: { message: `${isNext ? NEXT_COMMIT_MESSAGE : COMMIT_MESSAGE}\n\nmore details` },
    // 第二個 commit 只改了一個文字檔，用來測「沒有符合的變動」
    files: page !== 1 ? [] : isNext ? [changed('docs/readme.md', 'modified')] : COMMIT_FILES,
  };
}

/** 模擬 GitHub 的額度 header（瀏覽器要能讀到，所以一併開放 CORS） */
export const rateHeaders = (remaining, limit = 60) => ({
  'access-control-allow-origin': '*',
  'access-control-expose-headers': 'x-ratelimit-remaining, x-ratelimit-limit, x-ratelimit-reset',
  'x-ratelimit-remaining': String(remaining),
  'x-ratelimit-limit': String(limit),
  'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 3600),
});

async function mockGitHub(page) {
  await page.route('https://api.github.com/**', (route) => {
    const url = new URL(route.request().url());
    if (url.pathname === '/repos/demo/assets') return route.fulfill({ json: { default_branch: 'main' }, headers: rateHeaders(58) });
    if (url.pathname === '/repos/demo/assets/git/trees/main') return route.fulfill({ json: { tree: TREE, truncated: false }, headers: rateHeaders(57) });
    if (url.pathname === `/repos/demo/assets/git/trees/${COMMIT_SHA}`) return route.fulfill({ json: { tree: TREE, truncated: false } });
    const commit = url.pathname.match(/^\/repos\/demo\/assets\/commits\/([0-9a-f]{40})$/);
    if (commit && [COMMIT_SHA, NEXT_COMMIT_SHA].includes(commit[1])) return route.fulfill({ json: commitResponse(url, commit[1]) });
    return route.fulfill({ status: 404, json: { message: 'Not Found' } });
  });
  await page.route('https://raw.githubusercontent.com/**', (route) => {
    const [, ref, path] = decodeURIComponent(new URL(route.request().url()).pathname).match(/^\/demo\/assets\/([^/]+)\/(.*)$/);
    if (ref === COMMIT_SHA && path === 'docs/readme.md') return route.fulfill({ body: COMMIT_README, contentType: 'text/plain' });
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
