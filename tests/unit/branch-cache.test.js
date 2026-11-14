import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { loadCore } from '../helpers/load.js';
import { installFakeCaches } from '../helpers/fakeCaches.js';

let GF;
beforeAll(() => {
  GF = loadCore();
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
  delete globalThis.caches;
});

const MINUTE = 60 * 1000;
const SHA_A = 'a'.repeat(40);
const SHA_B = 'b'.repeat(40);
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
/** GitHub 用分支名稱回檔案樹時，sha 欄位是該分支最新的 commit sha */
const treeAt = (sha, file = 'a.png') => ({ sha, tree: [{ path: file, type: 'blob', size: 1 }], truncated: false });
const open = (opts) => GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' }, opts);

/** @param {{ head?: () => Response, tree?: () => Response }} routes */
function mockGitHub(routes) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const path = String(url).replace('https://api.github.com', '').replace(/[?&]_=\d+/, '');
    if (path === '/repos/o/r/commits/main' && routes.head) return routes.head();
    if (path === '/repos/o/r/git/trees/main?recursive=1' && routes.tree) return routes.tree();
    return json({ message: 'Not Found' }, 404);
  });
}
const calledPaths = (spy) => spy.mock.calls.map(([u]) => String(u).replace('https://api.github.com', ''));

describe('branch tree cache keyed by commit sha', () => {
  it('costs one request the first time and none while it is fresh', async () => {
    installFakeCaches();
    vi.useFakeTimers({ toFake: ['Date'] });
    const spy = mockGitHub({ tree: () => json(treeAt(SHA_A)) });
    await open();
    vi.setSystemTime(Date.now() + 29 * MINUTE);
    const again = await open();
    expect(again.entries[0].path).toBe('a.png');
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('after 30 minutes only asks for the latest sha when the branch has not moved', async () => {
    installFakeCaches();
    vi.useFakeTimers({ toFake: ['Date'] });
    const spy = mockGitHub({ tree: () => json(treeAt(SHA_A)), head: () => new Response(SHA_A) });
    await open();
    vi.setSystemTime(Date.now() + 31 * MINUTE);
    const again = await open();
    expect(again.entries[0].path).toBe('a.png');
    expect(calledPaths(spy)).toEqual(['/repos/o/r/git/trees/main?recursive=1', '/repos/o/r/commits/main']);
    expect(spy.mock.calls[1][1].headers.Accept).toBe('application/vnd.github.sha');
  });

  it('renews the check, so the next 30 minutes cost nothing again', async () => {
    installFakeCaches();
    vi.useFakeTimers({ toFake: ['Date'] });
    const spy = mockGitHub({ tree: () => json(treeAt(SHA_A)), head: () => new Response(SHA_A) });
    await open();
    vi.setSystemTime(Date.now() + 31 * MINUTE);
    await open();
    vi.setSystemTime(Date.now() + 20 * MINUTE);
    await open();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('loads the tree again when the branch has a new commit', async () => {
    installFakeCaches();
    vi.useFakeTimers({ toFake: ['Date'] });
    let tree = treeAt(SHA_A, 'old.png');
    const spy = mockGitHub({ tree: () => json(tree), head: () => new Response(SHA_B) });
    await open();
    tree = treeAt(SHA_B, 'new.png');
    vi.setSystemTime(Date.now() + 31 * MINUTE);
    const again = await open();
    expect(again.entries[0].path).toBe('new.png');
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('never sends a custom Accept header for the tree itself', async () => {
    installFakeCaches();
    const spy = mockGitHub({ tree: () => json(treeAt(SHA_A)) });
    await open();
    expect(spy.mock.calls[0][1].headers.Accept).toBeUndefined();
  });

  it('Reload from GitHub skips the sha check and loads the tree', async () => {
    installFakeCaches();
    const spy = mockGitHub({ tree: () => json(treeAt(SHA_A)), head: () => new Response(SHA_A) });
    await open();
    await open({ refresh: true });
    expect(calledPaths(spy)).toEqual(['/repos/o/r/git/trees/main?recursive=1', '/repos/o/r/git/trees/main?recursive=1']);
  });

  it('reports a deleted branch as not found', async () => {
    installFakeCaches();
    vi.useFakeTimers({ toFake: ['Date'] });
    let tree = () => json(treeAt(SHA_A));
    mockGitHub({ tree: () => tree(), head: () => json({ message: 'No commit found' }, 422) });
    await open();
    tree = () => json({ message: 'Not Found' }, 404);
    vi.setSystemTime(Date.now() + 31 * MINUTE);
    await expect(open()).rejects.toMatchObject({ status: 404 });
  });

  it.each([
    ['the quota is used up', () => json({ message: 'rate limited' }, 403)],
    ['GitHub keeps failing', () => new Response('', { status: 502 })],
  ])('keeps the saved tree when the sha check fails because %s', async (_, head) => {
    installFakeCaches();
    vi.useFakeTimers({ toFake: ['Date'] });
    const spy = mockGitHub({ tree: () => json(treeAt(SHA_A)), head });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await open();
    vi.setSystemTime(Date.now() + 31 * MINUTE);
    const again = await open();
    expect(again.entries[0].path).toBe('a.png');
    // 已經有樹可用：sha 確認失敗不重試，不讓使用者多等
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('keeps the saved tree when GitHub cannot be reached', async () => {
    installFakeCaches();
    vi.useFakeTimers({ toFake: ['Date'] });
    mockGitHub({ tree: () => json(treeAt(SHA_A)), head: () => { throw new TypeError('offline'); } });
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    await open();
    vi.setSystemTime(Date.now() + 31 * MINUTE);
    await expect(open()).resolves.toMatchObject({ branch: 'main' });
  });

  it('loads the tree again with the new token instead of reusing the old one', async () => {
    const store = installFakeCaches();
    vi.useFakeTimers({ toFake: ['Date'] });
    localStorage.setItem('gitfinder.token', JSON.stringify('old-token'));
    let head = () => new Response(SHA_A);
    const spy = mockGitHub({ tree: () => json(treeAt(SHA_A)), head: () => head() });
    await open();
    head = () => {
      localStorage.setItem('gitfinder.token', JSON.stringify('new-token'));
      store.clear(); // 設定頁換 token 時會清掉 API 快取
      return new Response(SHA_A);
    };
    vi.setSystemTime(Date.now() + 31 * MINUTE);
    await open();
    expect(calledPaths(spy)).toEqual([
      '/repos/o/r/git/trees/main?recursive=1', '/repos/o/r/commits/main', '/repos/o/r/git/trees/main?recursive=1',
    ]);
    expect(spy.mock.calls[2][1].headers.Authorization).toBe('Bearer new-token');
  });

  it('loads the tree again when the saved tree was evicted but the record is still there', async () => {
    const store = installFakeCaches();
    const spy = mockGitHub({ tree: () => json(treeAt(SHA_A)) });
    await open();
    [...store.keys()].filter((k) => k.includes('/git/trees/')).forEach((k) => store.delete(k));
    await expect(open()).resolves.toMatchObject({ branch: 'main' });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('does not cache a tree that comes back without a commit sha', async () => {
    installFakeCaches();
    const spy = mockGitHub({ tree: () => json({ tree: [], truncated: false }) });
    await open();
    await open();
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('a stored tree is also used when the same commit is opened by sha', async () => {
    installFakeCaches();
    const spy = mockGitHub({ tree: () => json(treeAt(SHA_A)) });
    await open();
    const bySha = await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: SHA_A });
    expect(bySha.entries[0].path).toBe('a.png');
    expect(spy).toHaveBeenCalledTimes(1);
  });
});
