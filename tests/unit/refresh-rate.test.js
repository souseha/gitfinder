import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { loadCore } from '../helpers/load.js';
import { installFakeCaches } from '../helpers/fakeCaches.js';

let GF;
beforeAll(() => {
  GF = loadCore();
});
afterEach(() => {
  vi.restoreAllMocks();
  localStorage.clear();
  delete globalThis.caches;
});

const json = (body, headers = {}) => new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json', ...headers } });
const TREE = { tree: [{ path: 'a.png', type: 'blob', size: 1 }], truncated: false };
const rateHeaders = (remaining, reset) => ({ 'x-ratelimit-remaining': String(remaining), 'x-ratelimit-limit': '60', 'x-ratelimit-reset': String(reset) });

describe('force refresh', () => {
  it('asks GitHub again for a cached branch tree', async () => {
    installFakeCaches();
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(TREE));
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' });
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' }, { refresh: true });
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('saves the refreshed tree for the next normal open', async () => {
    installFakeCaches();
    let version = 1;
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () =>
      json({ sha: String(version).repeat(40), tree: [{ path: `v${version}.png`, type: 'blob', size: 1 }], truncated: false }));
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' });
    version = 2;
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' }, { refresh: true });
    const again = await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' });
    expect(again.entries[0].path).toBe('v2.png');
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('revalidates with GitHub instead of trusting the browser cache', async () => {
    installFakeCaches();
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(TREE));
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' }, { refresh: true });
    expect(spy.mock.calls[0][1].cache).toBe('no-cache');
  });

  it('keeps using cached content that never changes', async () => {
    installFakeCaches();
    const SHA = 'a'.repeat(40);
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(TREE));
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: SHA });
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: SHA }, { refresh: true });
    expect(spy).toHaveBeenCalledTimes(1);
  });

  it('looks up the default branch again', async () => {
    installFakeCaches();
    const spy = vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) =>
      (String(url).endsWith('/repos/o/r') ? json({ default_branch: 'main' }) : json(TREE)));
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: null });
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: null }, { refresh: true });
    expect(spy).toHaveBeenCalledTimes(4);
  });
});

describe('remaining quota survives a reload', () => {
  it('remembers the last quota GitHub reported', async () => {
    const reset = Math.floor(Date.now() / 1000) + 600;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async () => json(TREE, rateHeaders(42, reset)));
    await GF.github.fetchRepo({ owner: 'o', name: 'r', branch: 'main' });
    expect(GF.github.getRate()).toMatchObject({ remaining: 42, limit: 60 });
    expect(GF.github.savedRate()).toMatchObject({ remaining: 42, limit: 60, reset });
  });

  it('forgets the saved quota once its hour has reset', () => {
    const past = Math.floor(Date.now() / 1000) - 1;
    localStorage.setItem('gitfinder.rate', JSON.stringify({ remaining: 3, limit: 60, reset: past }));
    expect(GF.github.savedRate()).toBeNull();
  });

  it('forgets the saved quota when asked (the token changed)', () => {
    const later = Math.floor(Date.now() / 1000) + 600;
    localStorage.setItem('gitfinder.rate', JSON.stringify({ remaining: 3, limit: 60, reset: later }));
    GF.github.forgetRate();
    expect(GF.github.getRate()).toBeNull();
  });

  it('ignores a malformed saved quota', () => {
    localStorage.setItem('gitfinder.rate', JSON.stringify({ remaining: 'lots' }));
    expect(GF.github.savedRate()).toBeNull();
  });
});
