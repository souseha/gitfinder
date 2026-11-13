import { beforeAll, describe, expect, it } from 'vitest';
import { loadCore } from '../helpers/load.js';

let T;
beforeAll(() => {
  T = loadCore().tree;
});

const blob = (path, size = 10) => ({ path, type: 'blob', size });
const ENTRIES = [
  { path: 'assets', type: 'tree' },
  blob('assets/icon10.png', 100),
  blob('assets/icon2.png', 200),
  blob('assets/notes.md', 50),
  blob('assets/deep/nested/a.svg', 30), // 父資料夾沒有 tree 項目也要自動建立
  blob('README.md', 5),
  blob('b.txt', 1),
  { path: 'sub', type: 'commit' }, // submodule 不列入
];

describe('buildTree', () => {
  it('builds folders, including implicit ones', () => {
    const { root, byPath } = T.buildTree(ENTRIES);
    expect(byPath.get('assets/deep/nested').type).toBe('dir');
    expect(byPath.get('assets/deep/nested/a.svg').parent.path).toBe('assets/deep/nested');
    expect(byPath.has('sub')).toBe(false);
    expect(root.children.map((n) => n.name)).toEqual(['assets', 'b.txt', 'README.md']);
  });

  it('sorts folders first, then names with natural number order', () => {
    const { byPath } = T.buildTree(ENTRIES);
    expect(byPath.get('assets').children.map((n) => n.name)).toEqual(['deep', 'icon2.png', 'icon10.png', 'notes.md']);
  });

  it('computes recursive folder stats', () => {
    const { root, byPath } = T.buildTree(ENTRIES);
    expect(byPath.get('assets').stats).toEqual({ files: 4, images: 3, size: 380 });
    expect(root.stats).toEqual({ files: 6, images: 3, size: 386 });
  });

  it('records extension and label', () => {
    const { byPath } = T.buildTree([blob('Makefile'), blob('pic.JPG')]);
    expect(byPath.get('Makefile')).toMatchObject({ ext: 'makefile', label: '' });
    expect(byPath.get('pic.JPG')).toMatchObject({ ext: 'jpg', label: 'jpg' });
  });

  it('ignores duplicate blob entries', () => {
    const { root } = T.buildTree([blob('a.png'), blob('a.png')]);
    expect(root.children).toHaveLength(1);
  });
});

describe('search', () => {
  const tree = () => T.buildTree(ENTRIES);

  it('matches file names case-insensitively', () => {
    expect(T.search(tree().all, 'ICON').map((n) => n.path)).toEqual(['assets/icon10.png', 'assets/icon2.png']);
  });

  it('requires every term, and matches full paths for terms with a slash', () => {
    expect(T.search(tree().all, 'icon 2').map((n) => n.name)).toEqual(['icon2.png']);
    expect(T.search(tree().all, 'deep/ .svg').map((n) => n.name)).toEqual(['a.svg']);
  });

  it('returns nothing for blank queries and respects the limit', () => {
    expect(T.search(tree().all, '   ')).toEqual([]);
    expect(T.search(tree().all, '.', 2)).toHaveLength(2);
  });
});

describe('flatten / ancestors', () => {
  it('lists only expanded folders, with depth', () => {
    const { root } = T.buildTree(ENTRIES);
    const rows = T.flatten(root, new Set(['assets']), () => true);
    expect(rows.map((r) => `${r.depth}:${r.node.name}`)).toEqual([
      '0:assets', '1:deep', '1:icon2.png', '1:icon10.png', '1:notes.md', '0:b.txt', '0:README.md',
    ]);
  });

  it('applies the filter at every level', () => {
    const { root } = T.buildTree(ENTRIES);
    const rows = T.flatten(root, new Set(['assets']), (n) => n.type === 'dir' || n.ext === 'png');
    expect(rows.map((r) => r.node.name)).toEqual(['assets', 'deep', 'icon2.png', 'icon10.png']);
  });

  it('returns the chain from the root', () => {
    const { byPath } = T.buildTree(ENTRIES);
    expect(T.ancestors(byPath.get('assets/deep/nested/a.svg')).map((n) => n.path)).toEqual([
      '', 'assets', 'assets/deep', 'assets/deep/nested', 'assets/deep/nested/a.svg',
    ]);
  });
});

describe('buildTree with commit changes', () => {
  const c = (path, status) => ({ path, type: 'blob', size: null, change: { status, previousPath: null } });
  it('carries change onto nodes and counts per folder', () => {
    const { root, byPath } = T.buildTree([c('a/x.png', 'added'), c('a/y.png', 'added'), c('a/b/z.png', 'removed'), c('r.md', 'modified')]);
    expect(byPath.get('a/x.png').change.status).toBe('added');
    expect(byPath.get('a').changes).toEqual({ added: 2, removed: 1, renamed: 0, modified: 0 });
    expect(root.changes).toEqual({ added: 2, removed: 1, renamed: 0, modified: 1 });
  });
  it('leaves change info empty for normal trees', () => {
    const { root, byPath } = T.buildTree(ENTRIES);
    expect(root.changes).toBeNull();
    expect(byPath.get('README.md').change).toBeNull();
  });
});
