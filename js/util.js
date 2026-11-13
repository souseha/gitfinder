/* 共用工具：副檔名判斷、格式化、localStorage、圖示 */
(function (GF) {
  'use strict';

  const IMG_EXT = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'avif', 'bmp', 'ico', 'apng', 'jfif']);
  const TEXT_EXT = new Set([
    'md', 'markdown', 'mdx', 'txt', 'rst', 'json', 'jsonc', 'js', 'mjs', 'cjs', 'ts', 'tsx', 'jsx',
    'vue', 'svelte', 'astro', 'css', 'scss', 'sass', 'less', 'html', 'htm', 'xml', 'yml', 'yaml',
    'toml', 'ini', 'cfg', 'conf', 'py', 'rb', 'go', 'rs', 'java', 'kt', 'swift', 'c', 'h', 'cpp',
    'hpp', 'cs', 'php', 'sh', 'bash', 'zsh', 'fish', 'sql', 'lua', 'r', 'dart', 'gradle',
    'properties', 'env', 'csv', 'tsv', 'log', 'lock', 'license', 'readme', 'makefile',
    'dockerfile', 'gitignore', 'gitattributes', 'editorconfig', 'npmrc', 'nvmrc', 'prettierrc',
    'eslintrc', 'babelrc', 'graphql', 'gql', 'proto', 'tf', 'vim', 'ex', 'exs', 'erl', 'hs', 'scala',
  ]);

  const KEYS = Object.freeze({
    repos: 'gitfinder.repos',
    token: 'gitfinder.token',
    view: 'gitfinder.view',
    iconSize: 'gitfinder.iconSize',
    theme: 'gitfinder.theme',
    autoOpen: 'gitfinder.autoOpen',
    sidebarCollapsed: 'gitfinder.sidebarCollapsed',
    rate: 'gitfinder.rate',
  });


  function extOf(name) {
    const i = name.lastIndexOf('.');
    return (i > 0 ? name.slice(i + 1) : name.replace(/^\./, '')).toLowerCase();
  }

  const isImage = (node) => !!node && node.type === 'file' && IMG_EXT.has(node.ext);
  const isText = (node) => !!node && node.type === 'file' && TEXT_EXT.has(node.ext);

  function formatSize(bytes) {
    if (bytes == null) return '—';
    if (bytes < 1024) return `${bytes} B`;
    const units = ['KB', 'MB', 'GB'];
    let value = bytes / 1024;
    let i = 0;
    while (value >= 1024 && i < units.length - 1) {
      value /= 1024;
      i += 1;
    }
    return `${value < 10 ? value.toFixed(1) : Math.round(value)} ${units[i]}`;
  }

  function kindOf(node) {
    const { t } = GF.i18n;
    if (node.type === 'dir') return t('kind.dir');
    const ext = node.ext.toUpperCase();
    if (isImage(node)) return t('kind.image', { ext });
    if (isText(node)) return t('kind.text', { ext });
    return t('kind.file', { ext });
  }

  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  const MOD_LABEL = IS_MAC ? '⌘' : 'Ctrl+';

  const ESC_MAP = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ESC_MAP[c]);

  const store = {
    get(key, fallback) {
      try {
        const raw = localStorage.getItem(key);
        return raw == null ? fallback : JSON.parse(raw);
      } catch {
        return fallback;
      }
    },
    set(key, value) {
      try {
        localStorage.setItem(key, JSON.stringify(value));
        return true;
      } catch {
        return false;
      }
    },
    remove(key) {
      try {
        localStorage.removeItem(key);
      } catch {
        /* 無痕模式等情況下忽略 */
      }
    },
  };

  function debounce(fn, ms) {
    let timer = null;
    return (...args) => {
      clearTimeout(timer);
      timer = setTimeout(() => fn(...args), ms);
    };
  }

  const folderIcon = () =>
    '<svg class="ico-folder" viewBox="0 0 64 50" aria-hidden="true">' +
    '<path d="M3 7a4 4 0 0 1 4-4h15.3a4 4 0 0 1 2.9 1.2L29 8h28a4 4 0 0 1 4 4v31a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" fill="var(--folder-back)"/>' +
    '<path d="M3 16a3 3 0 0 1 3-3h52a3 3 0 0 1 3 3v27a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4z" fill="var(--folder-front)"/></svg>';

  function fileIcon(ext) {
    const label = (ext || '').slice(0, 5).toUpperCase();
    const text = label
      ? `<text x="24" y="45" text-anchor="middle" font-size="${label.length > 4 ? 8 : 9.5}" font-weight="700" fill="var(--file-label)" font-family="-apple-system,system-ui,sans-serif">${esc(label)}</text>`
      : '';
    return (
      '<svg class="ico-file" viewBox="0 0 48 60" aria-hidden="true">' +
      '<path d="M6 1.5h26L46.5 16v38.5a4 4 0 0 1-4 4H6a4 4 0 0 1-4-4v-49a4 4 0 0 1 4-4z" fill="var(--file-bg)" stroke="var(--file-stroke)" stroke-width="1.5"/>' +
      '<path d="M32 1.5V12a4 4 0 0 0 4 4h10.5" fill="var(--file-fold)" stroke="var(--file-stroke)" stroke-width="1.5" stroke-linejoin="round"/>' +
      `${text}</svg>`
    );
  }

  /** GitFinder 標誌：顏色由 CSS 變數決定，會跟著網站主題（含手動切換）變化 */
  const logoIcon = (cls = '') =>
    `<svg class="${cls}" viewBox="0 0 64 64" aria-hidden="true">` +
    '<rect class="bi-tile" width="64" height="64" rx="14"/>' +
    '<rect class="bi-border" x="1" y="1" width="62" height="62" rx="13" fill="none" stroke-width="2"/>' +
    '<path class="bi-glyph" d="M9 19a4 4 0 0 1 4-4h10.6a4 4 0 0 1 3 1.4l3 3.6H51a4 4 0 0 1 4 4v24a4 4 0 0 1-4 4H13a4 4 0 0 1-4-4z"/>' +
    '<g class="bi-cut" fill="none" stroke-width="4" stroke-linecap="round"><path d="M22 30v14"/><path d="M42 30c0 10-20 5-20 14"/></g>' +
    '<g class="bi-tile"><circle cx="22" cy="30" r="4.5"/><circle cx="22" cy="44" r="4.5"/><circle cx="42" cy="30" r="4.5"/></g></svg>';

  const repoIcon = () =>
    '<svg class="ri-svg" viewBox="0 0 16 16" aria-hidden="true"><path fill="currentColor" d="M2 2.5A2.5 2.5 0 0 1 4.5 0h8.75a.75.75 0 0 1 .75.75v12.5a.75.75 0 0 1-.75.75h-2.5a.75.75 0 0 1 0-1.5h1.75v-2h-8a1 1 0 0 0-.71 1.71.75.75 0 0 1-1.06 1.06A2.49 2.49 0 0 1 2 11.5Zm10.5-1h-8a1 1 0 0 0-1 1v6.71A2.49 2.49 0 0 1 4.5 9h8ZM5 12.25a.25.25 0 0 1 .25-.25h3.5a.25.25 0 0 1 .25.25v3.25a.25.25 0 0 1-.4.2l-1.45-1.09a.25.25 0 0 0-.3 0L5.4 15.7a.25.25 0 0 1-.4-.2Z"/></svg>';

  /**
   * 最近清單的 key：每個倉庫一筆一般瀏覽，加上一筆「最近看的 commit」與一筆「最近看的 PR」
   * （新的取代舊的）
   */
  const recentKey = (r) => `${r.owner}/${r.name}`.toLowerCase() + (r.pull ? '#pull' : r.commit ? '#commit' : '');

  GF.util = Object.freeze({
    IMG_EXT, KEYS, recentKey, extOf, isImage, isText, formatSize, kindOf, esc, store, debounce,
    folderIcon, fileIcon, repoIcon, logoIcon, IS_MAC, MOD_LABEL,
  });
})((window.GF = window.GF || {}));
