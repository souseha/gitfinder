import { beforeAll, afterEach, describe, expect, it, vi } from 'vitest';
import { loadCore } from '../helpers/load.js';

let U;
let I;
beforeAll(() => {
  localStorage.clear();
  const GF = loadCore();
  U = GF.util;
  I = GF.i18n;
});
afterEach(() => {
  I.setLang('en');
  vi.useRealTimers();
});

describe('util', () => {
  it.each([
    ['photo.PNG', 'png'], ['archive.tar.gz', 'gz'], ['Makefile', 'makefile'], ['.gitignore', 'gitignore'],
  ])('extOf(%s) = %s', (name, ext) => {
    expect(U.extOf(name)).toBe(ext);
  });

  it('classifies images and text files', () => {
    expect(U.isImage({ type: 'file', ext: 'webp' })).toBe(true);
    expect(U.isImage({ type: 'dir', ext: '' })).toBe(false);
    expect(U.isText({ type: 'file', ext: 'md' })).toBe(true);
    expect(U.isText({ type: 'file', ext: 'png' })).toBe(false);
  });

  it.each([[null, '—'], [0, '0 B'], [1023, '1023 B'], [1536, '1.5 KB'], [20 * 1024, '20 KB'], [5 * 1024 ** 3, '5.0 GB']])(
    'formatSize(%s) = %s', (bytes, text) => {
      expect(U.formatSize(bytes)).toBe(text);
    },
  );

  it('describes kinds in the current language', () => {
    expect(U.kindOf({ type: 'dir' })).toBe('Folder');
    expect(U.kindOf({ type: 'file', ext: 'png' })).toBe('PNG image');
    expect(U.kindOf({ type: 'file', ext: 'md' })).toBe('MD text');
    expect(U.kindOf({ type: 'file', ext: 'bin' })).toBe('BIN file');
  });

  it('escapes HTML', () => {
    expect(U.esc(`<a href="x">'&'</a>`)).toBe('&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;');
  });

  it('reads and writes localStorage safely', () => {
    expect(U.store.get('missing', 'fallback')).toBe('fallback');
    U.store.set('k', { a: 1 });
    expect(U.store.get('k')).toEqual({ a: 1 });
    localStorage.setItem('broken', '{not json');
    expect(U.store.get('broken', 'ok')).toBe('ok');
    U.store.remove('k');
    expect(U.store.get('k', null)).toBeNull();
  });

  it('debounces calls', () => {
    vi.useFakeTimers();
    const fn = vi.fn();
    const d = U.debounce(fn, 100);
    d(1);
    d(2);
    vi.advanceTimersByTime(99);
    expect(fn).not.toHaveBeenCalled();
    vi.advanceTimersByTime(1);
    expect(fn).toHaveBeenCalledExactlyOnceWith(2);
  });

  it('renders file icons with an optional label', () => {
    expect(U.fileIcon('png')).toContain('>PNG<');
    expect(U.fileIcon('')).not.toContain('<text');
    expect(U.logoIcon('x')).toContain('class="x"');
  });
});

describe('i18n', () => {
  it('defaults to English', () => {
    expect(I.getLang()).toBe('en');
  });

  it('interpolates variables and keeps unknown placeholders', () => {
    expect(I.t('count.items', { n: 3 })).toBe('3 items');
    expect(I.t('count.items')).toBe('{n} items');
  });

  it('falls back to the key for unknown strings', () => {
    expect(I.t('no.such.key')).toBe('no.such.key');
  });

  it('switches language, persists it, and notifies listeners', () => {
    const listener = vi.fn();
    I.onChange(listener);
    I.setLang('zh-Hant');
    expect(I.t('count.items', { n: 2 })).toBe('2 個項目');
    expect(localStorage.getItem('gitfinder.lang')).toBe('zh-Hant');
    expect(listener).toHaveBeenCalledWith('zh-Hant');
    I.setLang('xx'); // 不支援的語言會被忽略
    expect(I.getLang()).toBe('zh-Hant');
  });

  it('fills platform shortcuts into hints', () => {
    expect(I.t('tb.sidebar')).toMatch(/\((⌥⌘S|Ctrl\+Alt\+S)\)$/);
  });

  it('applies translations to static markup', () => {
    document.body.innerHTML =
      '<span data-i18n="common.open"></span><input data-i18n-ph="tb.searchPh"><button data-i18n-tip="tb.back"></button><p data-i18n-html="token.desc"></p>';
    I.applyStatic();
    expect(document.querySelector('span').textContent).toBe('Open');
    expect(document.querySelector('input').placeholder).toBe('Search repository');
    expect(document.querySelector('button').dataset.tip).toBe('Back');
    expect(document.querySelector('button').getAttribute('aria-label')).toBe('Back');
    expect(document.querySelector('p a').href).toContain('github.com/settings');
    expect(document.documentElement.lang).toBe('en');
  });
});

describe('i18n plurals', () => {
  it('uses the singular form when n is 1 and the plural otherwise', () => {
    expect(I.t('count.items', { n: 1 })).toBe('1 item');
    expect(I.t('count.items', { n: 2 })).toBe('2 items');
    expect(I.t('count.images', { n: 1 })).toBe('1 image');
    expect(I.t('count.found', { n: 1 })).toBe('1 found'); // 沒有單數字串時沿用一般字串
  });
});
