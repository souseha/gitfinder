import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { loadCore } from '../helpers/load.js';

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

/** 只實作 App 用到的 Cache Storage 介面，用 Map 存放 */
function installFakeCaches() {
  const store = new Map();
  const cache = {
    match: async (url) => (store.has(url) ? store.get(url).clone() : undefined),
    put: async (url, res) => {
      store.set(url, res);
    },
    delete: async (url) => store.delete(url),
    keys: async () => [...store.keys()].map((url) => ({ url })),
  };
  globalThis.caches = {
    open: async () => cache,
    delete: async () => {
      store.clear();
      return true;
    },
  };
  return store;
}

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const TREE = { tree: [{ path: 'a.png', type: 'blob', size: 1 }], truncated: false };
const SHA = 'a'.repeat(40);
const MINUTE = 60 * 1000;

function mockApi(routes) {
  return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
    const path = String(url).replace('https://api.github.com', '').replace(/[?&]_=\d+/, '');
    const handler = routes[path];
    if (!handler) return json({ message: 'Not Found' }, 404);
    return typeof handler === 'function' ? handler() : handler;
  });
}

describe('apiCache', () => {
  it('reads nothing and does not throw when Cache Storage is unavailable', async () => {
    await GF.apiCache.write('https://x/a', '{}');
    await expect(GF.apiCache.read('https://x/a', MINUTE)).resolves.toBeNull();
    await expect(GF.apiCache.clear()).resolves.toBeUndefined();
  });

  it('returns a saved body while it is fresh', async () => {
    installFakeCaches();
    await GF.apiCache.write('https://x/a', '{"ok":1}');
    await expect(GF.apiCache.read('https://x/a', MINUTE)).resolves.toBe('{"ok":1}');
  });

  it('ignores a saved body older than the allowed age', async () => {
    installFakeCaches();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    await GF.apiCache.write('https://x/a', '{}');
    now.mockReturnValue(1_000_000 + MINUTE + 1);
    await expect(GF.apiCache.read('https://x/a', MINUTE)).resolves.toBeNull();
  });

  it('keeps only the most recently saved entries', async () => {
    const store = installFakeCaches();
    const now = vi.spyOn(Date, 'now');
    for (let i = 0; i <= GF.apiCache.MAX_ENTRIES; i += 1) {
      now.mockReturnValue(1_000_000 + i);
      await GF.apiCache.write(`https://x/${i}`, '{}');
    }
    expect(store.size).toBe(GF.apiCache.MAX_ENTRIES);
    expect(store.has('https://x/0')).toBe(false);
  });

  it('clears every entry', async () => {
    const store = installFakeCaches();
    await GF.apiCache.write('https://x/a', '{}');
    await GF.apiCache.clear();
    expect(store.size).toBe(0);
  });
});

describe('GitHub requests reuse the cache', () => {
  it('opens the same branch again without calling GitHub', async () => {
    installFakeCaches();
    const spy = mockApi({ '/repos/o/r/git/trees/main?recursive=1': () => json(TREE) });
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' });
    const again = await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' });
    expect(again.entries).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('reloads a branch tree after ten minutes', async () => {
    installFakeCaches();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const spy = mockApi({ '/repos/o/r/git/trees/main?recursive=1': () => json(TREE) });
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' });
    now.mockReturnValue(1_000_000 + 10 * MINUTE + 1);
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('keeps a tree addressed by a full sha much longer', async () => {
    installFakeCaches();
    const now = vi.spyOn(Date, 'now').mockReturnValue(1_000_000);
    const spy = mockApi({ [`/repos/o/r/git/trees/${SHA}?recursive=1`]: () => json(TREE) });
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: SHA });
    now.mockReturnValue(1_000_000 + 24 * 60 * MINUTE);
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: SHA });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('remembers the default branch so reopening a repo URL costs nothing', async () => {
    installFakeCaches();
    const spy = mockApi({
      '/repos/o/r': () => json({ default_branch: 'main' }),
      '/repos/o/r/git/trees/main?recursive=1': () => json(TREE),
    });
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: null, refPath: 'main/assets' });
    const again = await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: null, refPath: 'main/assets' });
    expect(again).toMatchObject({ branch: 'main', path: 'assets' });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('reopens a branch whose name contains slashes without guessing again', async () => {
    installFakeCaches();
    const spy = mockApi({
      '/repos/o/r': () => json({ default_branch: 'main' }),
      '/repos/o/r/git/trees/feature%2Fx?recursive=1': () => json(TREE),
    });
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: null, refPath: 'feature/x/src' });
    const used = spy.mock.calls.length;
    const again = await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: null, refPath: 'feature/x/src' });
    expect(again).toMatchObject({ branch: 'feature/x', path: 'src' });
    expect(spy).toHaveBeenCalledTimes(used);
  });

  it('looks up the default branch again when the remembered one is gone', async () => {
    installFakeCaches();
    let defaultBranch = 'master';
    const spy = mockApi({
      '/repos/o/r': () => json({ default_branch: defaultBranch }),
      '/repos/o/r/git/trees/master?recursive=1': () => (defaultBranch === 'master' ? json(TREE) : json({}, 404)),
      '/repos/o/r/git/trees/main?recursive=1': () => json(TREE),
    });
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: null });
    defaultBranch = 'main';
    await GF.apiCache.clear();
    await GF.apiCache.write('https://api.github.com/repos/o/r', JSON.stringify({ default_branch: 'master' }));
    const res = await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: null });
    expect(res.branch).toBe('main');
    expect(spy).toHaveBeenCalled();
  });

  it('does not save a response when the token changed while it was loading', async () => {
    const store = installFakeCaches();
    localStorage.setItem('gitfinder.token', JSON.stringify('test-token'));
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      localStorage.removeItem('gitfinder.token');
      return json(TREE);
    });
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' });
    expect(store.size).toBe(0);
  });

  it('keeps only the merge base of a pull request comparison', async () => {
    const store = installFakeCaches();
    const HEAD = 'f'.repeat(40);
    const BASE = 'b'.repeat(40);
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const u = new URL(String(url));
      if (u.pathname === '/repos/a/b/pulls/12') return json({ number: 12, title: 't', state: 'open', head: { sha: HEAD }, base: { sha: BASE } });
      if (u.pathname === '/repos/a/b/pulls/12/files') return json([{ filename: 'a.png', status: 'added' }]);
      if (u.pathname === `/repos/a/b/compare/${BASE}...${HEAD}`) {
        return json({ merge_base_commit: { sha: SHA }, files: Array.from({ length: 300 }, () => ({ patch: 'x'.repeat(100) })) });
      }
      return json({}, 404);
    });
    await GF.github.fetchPull({ owner: 'a', name: 'b', pull: 12 });
    const cachedCompare = [...store.entries()].find(([url]) => url.includes('/compare/'));
    expect(cachedCompare).toBeDefined();
    expect((await cachedCompare[1].clone().text()).length).toBeLessThan(200);
    const again = await GF.github.fetchPull({ owner: 'a', name: 'b', pull: 12 });
    expect(again.parentSha).toBe(SHA);
    expect(spy).toHaveBeenCalledTimes(3);
  });

  it('does not cache failed responses', async () => {
    installFakeCaches();
    let calls = 0;
    const spy = mockApi({
      '/repos/o/r/git/trees/main?recursive=1': () => (++calls === 1 ? json({}, 404) : json(TREE)),
    });
    await expect(GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' })).rejects.toMatchObject({ status: 404 });
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('caches commit pages', async () => {
    installFakeCaches();
    const spy = mockApi({
      [`/repos/a/b/commits/${SHA}?per_page=300&page=1`]: () =>
        json({ sha: SHA, parents: [], commit: { message: 'm' }, files: [{ filename: 'x.png', status: 'added' }] }),
    });
    await GF.github.fetchCommit({ owner: 'a', name: 'b', commit: SHA });
    await GF.github.fetchCommit({ owner: 'a', name: 'b', commit: SHA });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('falls back to GitHub when a cached body is not valid JSON', async () => {
    installFakeCaches();
    await GF.apiCache.write('https://api.github.com/repos/o/r/git/trees/main?recursive=1', 'not json');
    const spy = mockApi({ '/repos/o/r/git/trees/main?recursive=1': () => json(TREE) });
    const res = await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' });
    expect(res.entries).toHaveLength(1);
    expect(spy).toHaveBeenCalledTimes(1);
  });
});

describe('retries spend less quota without a token', () => {
  it('retries three times without a token', async () => {
    vi.useFakeTimers();
    mockApi({ '/repos/o/r/git/trees/main?recursive=1': () => new Response('', { status: 500 }) });
    const onRetry = vi.fn();
    const pending = GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' }, { onRetry });
    const check = expect(pending).rejects.toMatchObject({ status: 500 });
    await vi.runAllTimersAsync();
    await check;
    expect(onRetry.mock.calls).toEqual([[1, 3], [2, 3], [3, 3]]);
  });

  it('retries four times with a token', async () => {
    vi.useFakeTimers();
    localStorage.setItem('gitfinder.token', JSON.stringify('test-token'));
    mockApi({ '/repos/o/r/git/trees/main?recursive=1': () => new Response('', { status: 500 }) });
    const onRetry = vi.fn();
    const pending = GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' }, { onRetry });
    const check = expect(pending).rejects.toMatchObject({ status: 500 });
    await vi.runAllTimersAsync();
    await check;
    expect(onRetry).toHaveBeenCalledTimes(4);
  });
});
