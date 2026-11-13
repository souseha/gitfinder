import { beforeAll, describe, expect, it } from 'vitest';
import { loadScripts } from '../helpers/load.js';

let T;
let V;
beforeAll(() => {
  const GF = loadScripts('i18n', 'util', 'github', 'tree', 'virtual', 'views');
  T = GF.tree;
  V = GF.views;
});

const C = 'c'.repeat(40);
const P = 'e'.repeat(40);
const commitRepo = (parentSha = P) => ({ owner: 'a', name: 'b', branch: C, commit: { sha: C, parentSha } });
const changed = (path, status) => ({ path, type: 'blob', size: null, change: { status, previousPath: null } });

describe('change badges', () => {
  it('renders a status badge and the parent URL for removed images', () => {
    const { byPath } = T.buildTree([changed('x.png', 'removed')]);
    const html = V.iconItem(commitRepo(), byPath.get('x.png'), false);
    expect(html).toContain('chg chg-removed');
    expect(html).toContain(`data-raw="https://raw.githubusercontent.com/a/b/${P}/x.png"`);
    expect(html).toContain('is-removed');
  });

  it('renders an added count on folders', () => {
    const { byPath } = T.buildTree([changed('d/x.png', 'added')]);
    expect(V.iconItem(commitRepo(null), byPath.get('d'), false)).toContain('+1');
  });

  it('renders badges in list rows and columns too', () => {
    const { root, byPath } = T.buildTree([changed('x.png', 'modified')]);
    const node = byPath.get('x.png');
    expect(V.listRow(commitRepo(), { node, depth: 0 }, new Set(), false)).toContain('chg chg-modified');
    expect(V.columnView(commitRepo(), root, null, new Set(), () => true)).toContain('chg chg-modified');
  });

  it('renders no badge for normal repos', () => {
    const { byPath } = T.buildTree([{ path: 'x.png', type: 'blob', size: 10 }]);
    expect(V.iconItem({ owner: 'a', name: 'b', branch: 'main' }, byPath.get('x.png'), false)).not.toContain('chg');
  });
});

describe('before and after thumbnails', () => {
  it('shows both versions of a modified image', () => {
    const { byPath } = T.buildTree([changed('x.png', 'modified')]);
    const html = V.iconItem(commitRepo(), byPath.get('x.png'), false);
    expect(html).toContain('thumb-pair');
    expect(html).toMatch(new RegExp(`data-side="before"[^>]*data-raw="https://raw.githubusercontent.com/a/b/${P}/x.png"|data-raw="https://raw.githubusercontent.com/a/b/${P}/x.png"[^>]*data-side="before"`));
    expect(html).toContain('data-side="after"');
  });
  it('shows one image when the commit has no parent', () => {
    const { byPath } = T.buildTree([changed('x.png', 'modified')]);
    expect(V.iconItem(commitRepo(null), byPath.get('x.png'), false)).not.toContain('thumb-pair');
  });
  it('shows one image for added files', () => {
    const { byPath } = T.buildTree([changed('x.png', 'added')]);
    expect(V.iconItem(commitRepo(), byPath.get('x.png'), false)).not.toContain('thumb-pair');
  });
});

describe('welcome page mentions commits', () => {
  const EXAMPLE_COMMIT = 'microsoft/fluentui-emoji/commit/b4291bec813f3d1556283ca9fcbdb73c86e2e9f7';

  it('explains that a commit URL can be opened', () => {
    const html = V.welcome([]);
    expect(html).toContain('commit');
    expect(html).toMatch(/placeholder="[^"]*commit[^"]*"/);
  });

  it('offers a commit example that opens through the normal input', () => {
    const html = V.welcome([]);
    expect(html).toContain(`data-example="${EXAMPLE_COMMIT}"`);
  });
});
