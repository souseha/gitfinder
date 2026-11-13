import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { loadCore } from '../helpers/load.js';

let gh;
beforeAll(() => {
  gh = loadCore().github;
});
afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
  localStorage.clear();
});

const json = (body, status = 200, headers = {}) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json', ...headers } });

describe('parseRepoInput', () => {
  it.each([
    ['owner/repo', { owner: 'owner', name: 'repo', refPath: '' }],
    ['https://github.com/microsoft/fluentui-emoji', { owner: 'microsoft', name: 'fluentui-emoji', refPath: '' }],
    ['github.com/a/b/tree/feature/x/assets/icons', { owner: 'a', name: 'b', refPath: 'feature/x/assets/icons' }],
    ['https://github.com/a/b.git', { owner: 'a', name: 'b', refPath: '' }],
    ['https://www.github.com/a/b/blob/main/img/a%20b.png?raw=1#L1', { owner: 'a', name: 'b', refPath: 'main/img/a b.png' }],
    ['  a/b/  ', { owner: 'a', name: 'b', refPath: '' }],
    ['a/b/issues', { owner: 'a', name: 'b', refPath: '' }],
  ])('parses %s', (input, expected) => {
    expect(gh.parseRepoInput(input)).toEqual({ branch: null, path: '', ...expected });
  });

  it.each(['', 'foo', 'not a repo', '-bad/name', 'a/b c'])('rejects %j', (input) => {
    expect(gh.parseRepoInput(input)).toBeNull();
  });
});

describe('parseRoute / routeUrl', () => {
  it('parses an app path with an encoded folder name', () => {
    expect(gh.parseRoute('/microsoft/fluentui-emoji/tree/main/assets/Grinning%20face')).toEqual({
      owner: 'microsoft', name: 'fluentui-emoji', branch: null, path: '', refPath: 'main/assets/Grinning face',
    });
  });

  it('returns null for the home page', () => {
    expect(gh.parseRoute('/')).toBeNull();
  });

  it('builds GitHub-style URLs, encoding each segment', () => {
    expect(gh.routeUrl({ owner: 'a', name: 'b', branch: 'feature/x' }, 'assets/a b')).toBe('/a/b/tree/feature/x/assets/a%20b');
    expect(gh.routeUrl({ owner: 'a', name: 'b', branch: 'main' }, '')).toBe('/a/b/tree/main');
    expect(gh.routeUrl({ owner: 'a', name: 'b', branch: null }, '')).toBe('/a/b');
  });

  it('round-trips through parseRoute', () => {
    const url = gh.routeUrl({ owner: 'o', name: 'r', branch: 'main' }, 'x y/z#1.png');
    expect(gh.parseRoute(url).refPath).toBe('main/x y/z#1.png');
  });
});

describe('asset URLs', () => {
  const repo = { owner: 'o', name: 'r', branch: 'main' };
  const node = (path, size, ext) => ({ path, size, ext, type: 'file' });

  it('builds raw URLs', () => {
    expect(gh.rawUrl(repo, 'a b/c.png')).toBe('https://raw.githubusercontent.com/o/r/main/a%20b/c.png');
  });

  it('skips the thumbnail proxy for SVG, ICO and small images', () => {
    expect(gh.thumbUrl(repo, node('i.svg', 500000, 'svg'), 480)).toMatch(/^https:\/\/raw\./);
    expect(gh.thumbUrl(repo, node('i.ico', 500000, 'ico'), 480)).toMatch(/^https:\/\/raw\./);
    expect(gh.thumbUrl(repo, node('i.png', 1000, 'png'), 480)).toMatch(/^https:\/\/raw\./);
  });

  it('proxies large images through wsrv.nl as WebP', () => {
    const url = new URL(gh.thumbUrl(repo, node('big.png', 500000, 'png'), 480));
    expect(url.origin).toBe('https://wsrv.nl');
    expect(url.searchParams.get('w')).toBe('480');
    expect(url.searchParams.get('output')).toBe('webp');
    expect(url.searchParams.get('url')).toBe('https://raw.githubusercontent.com/o/r/main/big.png');
    expect(url.searchParams.get('n')).toBeNull();
  });

  it('keeps GIF animation', () => {
    expect(new URL(gh.thumbUrl(repo, node('a.gif', 500000, 'gif'), 160)).searchParams.get('n')).toBe('-1');
  });

  it('links to GitHub tree/blob pages', () => {
    expect(gh.webUrl(repo, null)).toBe('https://github.com/o/r/tree/main');
    expect(gh.webUrl(repo, { path: 'docs', type: 'dir' })).toBe('https://github.com/o/r/tree/main/docs');
    expect(gh.webUrl(repo, { path: 'docs/a.md', type: 'file' })).toBe('https://github.com/o/r/blob/main/docs/a.md');
  });
});

describe('fetchRepo', () => {
  const TREE = { tree: [{ path: 'a.png', type: 'blob', size: 1 }], truncated: false };

  function mockApi(routes) {
    return vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => {
      const path = String(url).replace('https://api.github.com', '').replace(/[?&]_=\d+/, '');
      const handler = routes[path];
      if (!handler) return json({ message: 'Not Found' }, 404);
      return typeof handler === 'function' ? handler() : handler;
    });
  }

  it('uses the default branch when none is given', async () => {
    mockApi({
      '/repos/o/r': json({ default_branch: 'main' }),
      '/repos/o/r/git/trees/main?recursive=1': json(TREE),
    });
    const res = await gh.fetchRepo({ owner: 'o', name: 'r', branch: null });
    expect(res).toMatchObject({ branch: 'main', path: '', truncated: false });
    expect(res.entries).toHaveLength(1);
  });

  it('uses an explicit branch without looking up the default', async () => {
    const spy = mockApi({ '/repos/o/r/git/trees/dev?recursive=1': json(TREE) });
    const res = await gh.fetchRepo({ owner: 'o', name: 'r', branch: 'dev', path: 'x' });
    expect(res).toMatchObject({ branch: 'dev', path: 'x' });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('splits refPath using the default branch', async () => {
    mockApi({
      '/repos/o/r': json({ default_branch: 'main' }),
      '/repos/o/r/git/trees/main?recursive=1': json(TREE),
    });
    const res = await gh.fetchRepo({ owner: 'o', name: 'r', branch: null, refPath: 'main/assets/icons' });
    expect(res).toMatchObject({ branch: 'main', path: 'assets/icons' });
  });

  it('finds branch names that contain slashes', async () => {
    mockApi({
      '/repos/o/r': json({ default_branch: 'main' }),
      '/repos/o/r/git/trees/feature%2Fx?recursive=1': json(TREE),
    });
    const res = await gh.fetchRepo({ owner: 'o', name: 'r', branch: null, refPath: 'feature/x/src/lib' });
    expect(res).toMatchObject({ branch: 'feature/x', path: 'src/lib' });
  });

  it('reports not found when no branch prefix exists', async () => {
    mockApi({ '/repos/o/r': json({ default_branch: 'main' }) });
    await expect(gh.fetchRepo({ owner: 'o', name: 'r', branch: null, refPath: 'nope/x' })).rejects.toMatchObject({ status: 404 });
  });

  it('retries GitHub 5xx errors and reports progress', async () => {
    vi.useFakeTimers();
    let calls = 0;
    mockApi({
      '/repos/o/r/git/trees/main?recursive=1': () => (++calls < 3 ? new Response('', { status: 500 }) : json(TREE)),
    });
    const onRetry = vi.fn();
    const pending = gh.fetchRepo({ owner: 'o', name: 'r', branch: 'main' }, { onRetry });
    await vi.runAllTimersAsync();
    await expect(pending).resolves.toMatchObject({ branch: 'main' });
    expect(onRetry.mock.calls).toEqual([[1, 4], [2, 4]]);
  });

  it('gives up after the last retry', async () => {
    vi.useFakeTimers();
    mockApi({ '/repos/o/r/git/trees/main?recursive=1': () => new Response('', { status: 502 }) });
    const pending = gh.fetchRepo({ owner: 'o', name: 'r', branch: 'main' });
    const check = expect(pending).rejects.toMatchObject({ status: 502 });
    await vi.runAllTimersAsync();
    await check;
  });

  it('explains rate limits and records remaining quota', async () => {
    mockApi({
      '/repos/o/r': json({ message: 'rate limited' }, 403, {
        'x-ratelimit-remaining': '0', 'x-ratelimit-limit': '60', 'x-ratelimit-reset': '1800000000',
      }),
    });
    await expect(gh.fetchRepo({ owner: 'o', name: 'r', branch: null })).rejects.toThrow(/rate limit/i);
    expect(gh.getRate()).toMatchObject({ remaining: 0, limit: 60 });
  });

  it.each([[401, /token/i], [409, /empty/i], [418, /HTTP 418/]])('maps HTTP %i to a readable error', async (status, msg) => {
    mockApi({ '/repos/o/r/git/trees/main?recursive=1': json({}, status) });
    await expect(gh.fetchRepo({ owner: 'o', name: 'r', branch: 'main' })).rejects.toThrow(msg);
  });

  it('sends the saved token and reports network failures', async () => {
    localStorage.setItem('gitfinder.token', JSON.stringify('test-token'));
    const spy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new TypeError('offline'));
    await expect(gh.fetchRepo({ owner: 'o', name: 'r', branch: 'main' })).rejects.toThrow(/reach GitHub/);
    expect(spy.mock.calls[0][1].headers.Authorization).toBe('Bearer test-token');
  });
});
