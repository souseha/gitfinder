import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import * as fflate from 'fflate';
import { loadCore, loadScripts } from '../helpers/load.js';

let GF;
let D;
beforeAll(() => {
  loadCore();
  GF = loadScripts('download');
  D = GF.download;
  window.fflate = fflate; // 測試中直接提供，不從 CDN 載入
});
afterEach(() => vi.restoreAllMocks());

const ENTRIES = [
  { path: 'icons', type: 'tree' },
  { path: 'icons/a.png', type: 'blob', size: 3 },
  { path: 'icons/sub/b.png', type: 'blob', size: 4 },
  { path: 'other/a.png', type: 'blob', size: 5 },
  { path: 'readme.md', type: 'blob', size: 6 },
];
const repo = { owner: 'o', name: 'repo', branch: 'main' };

describe('zipEntries / summary', () => {
  it('keeps folder structure and numbers duplicate names', () => {
    const { byPath, root } = GF.tree.buildTree(ENTRIES);
    const names = D.zipEntries([byPath.get('icons'), byPath.get('icons/a.png'), byPath.get('other/a.png')], 'repo').map((e) => e.name);
    // 資料夾內與畫面相同：子資料夾在前
    expect(names).toEqual(['icons/sub/b.png', 'icons/a.png', 'a.png', 'a (2).png']);
    expect(D.zipEntries([root], 'repo').map((e) => e.name)).toContain('repo/icons/sub/b.png');
  });

  it('sums files and bytes and asks before very large downloads', () => {
    const { byPath } = GF.tree.buildTree(ENTRIES);
    expect(D.summary([byPath.get('icons'), byPath.get('readme.md')])).toEqual({ files: 3, bytes: 13 });
    expect(D.needsConfirm([byPath.get('icons')])).toBe(false);
    expect(D.needsConfirm([{ type: 'file', size: 400 * 1024 * 1024 }])).toBe(true);
  });
});

describe('downloadZip', () => {
  function captureSave() {
    const saved = {};
    vi.spyOn(URL, 'createObjectURL').mockImplementation((blob) => { saved.blob = blob; return 'blob:test'; });
    vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function click() { saved.name = this.download; });
    return saved;
  }

  it('fetches every file and saves a zip with the right contents', async () => {
    const { byPath } = GF.tree.buildTree(ENTRIES);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => new Response(`data:${String(url).split('/main/')[1]}`));
    const saved = captureSave();
    const progress = vi.fn();
    const result = await D.downloadZip(repo, [byPath.get('icons')], 'icons', { onProgress: progress, signal: new AbortController().signal });
    expect(result).toEqual({ saved: 2, failed: [] });
    expect(saved.name).toBe('icons.zip');
    expect(progress).toHaveBeenLastCalledWith(2, 2);
    const files = fflate.unzipSync(new Uint8Array(await saved.blob.arrayBuffer()));
    expect(Object.keys(files).sort()).toEqual(['icons/a.png', 'icons/sub/b.png']);
    expect(fflate.strFromU8(files['icons/sub/b.png'])).toBe('data:icons/sub/b.png');
  });

  it('reports files that fail after a retry', async () => {
    const { byPath } = GF.tree.buildTree(ENTRIES);
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (url) => (
      String(url).includes('/sub/') ? new Response('', { status: 404 }) : new Response('ok')
    ));
    captureSave();
    const result = await D.downloadZip(repo, [byPath.get('icons')], 'icons', { onProgress: () => {}, signal: new AbortController().signal });
    expect(result).toEqual({ saved: 1, failed: ['icons/sub/b.png'] });
  });

  it('refuses empty selections and downloads single files directly', async () => {
    await expect(D.downloadZip(repo, [], 'x', { onProgress: () => {}, signal: new AbortController().signal })).rejects.toThrow(/Nothing/);
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('png'));
    const saved = captureSave();
    await D.downloadFile(repo, { path: 'readme.md', name: 'readme.md' });
    expect(saved.name).toBe('readme.md');
  });
});
