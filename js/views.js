/* 三種檢視（圖像 / 列表 / 直欄）與歡迎頁的 HTML 產生器，皆為純函式 */
(function (GF) {
  'use strict';

  const { esc, folderIcon, fileIcon, repoIcon, logoIcon, isImage, formatSize, kindOf, MOD_LABEL } = GF.util;
  const { rawUrl, thumbUrl, webUrl } = GF.github;
  const { ancestors } = GF.tree;
  const { t } = GF.i18n;

  /** 各處縮圖的請求尺寸（最長邊，已含 2x） */
  const THUMB = Object.freeze({ icon: 480, mini: 48, strip: 160, preview: 1040 });

  /**
   * @param {'icon'|'mini'|'strip'|'preview'|'full'} size full = 直接載入原圖
   * 代理圖載入失敗時，events.js 會改用 data-raw 的原圖，再失敗才換成檔案圖示
   */
  function thumbHtml(repo, node, size = 'mini', eager = false) {
    if (node.type === 'dir') return folderIcon();
    if (!isImage(node)) return fileIcon(node.label);
    const raw = rawUrl(repo, node.path);
    const src = size === 'full' ? raw : thumbUrl(repo, node, THUMB[size]);
    return `<img src="${esc(src)}" data-raw="${esc(raw)}" alt="" data-ext="${esc(node.label)}" loading="${eager ? 'eager' : 'lazy'}" decoding="async" draggable="false">`;
  }

  const parentLabel = (node) => (node.parent && node.parent.path ? node.parent.path : '/');

  /* 圖像 / 列表改為「一次一個項目」的產生器，交給 virtual.js 只畫出可見範圍 */
  function iconItem(repo, node, showPath) {
    const sub = showPath ? `<div class="sub">${esc(parentLabel(node))}</div>` : '';
    return (
      `<div class="icon-item" data-path="${esc(node.path)}">` +
      `<div class="thumb">${thumbHtml(repo, node, 'icon')}</div>` +
      `<div class="label"><span>${esc(node.name)}</span></div>${sub}</div>`
    );
  }

  const iconShell = () => '<div class="icon-grid"></div>';

  const sizeLabel = (node) => (node.type === 'dir' ? t('count.items', { n: node.children.length }) : formatSize(node.size));

  function listRow(repo, { node, depth }, expanded, showPath) {
    let disc = '';
    if (node.type === 'dir' && !showPath) disc = expanded.has(node.path) ? 'open' : 'closed';
    const loc = showPath ? `<div class="c-loc">${esc(parentLabel(node))}</div>` : '';
    return (
      `<div class="row" data-path="${esc(node.path)}" style="--depth:${depth}">` +
      `<div class="c-name"><span class="disc ${disc}" data-disc></span>` +
      `<span class="mini">${thumbHtml(repo, node)}</span><span class="nm">${esc(node.name)}</span></div>` +
      `<div class="c-size">${sizeLabel(node)}</div><div class="c-kind">${esc(kindOf(node))}</div>${loc}</div>`
    );
  }

  function listShell(showPath) {
    const head =
      `<div class="list-head"><div>${t('list.name')}</div><div>${t('list.size')}</div><div>${t('list.kind')}</div>` +
      `${showPath ? `<div>${t('list.where')}</div>` : ''}</div>`;
    return `<div class="list${showPath ? ' with-loc' : ''}">${head}<div class="list-body"></div></div>`;
  }

  function previewColumn(repo, node) {
    const media = isImage(node) ? thumbHtml(repo, node, 'preview', true) : fileIcon(node.label);
    return (
      '<div class="col col-preview">' +
      `<div class="pv-media">${media}</div>` +
      `<div class="pv-name">${esc(node.name)}</div>` +
      `<div class="pv-meta">${esc(kindOf(node))} · ${formatSize(node.size)}</div>` +
      `<div class="pv-actions"><button class="btn" type="button" data-action="quicklook">${t('pv.quicklook')} <kbd>Space</kbd></button>` +
      `<a class="btn" href="${esc(webUrl(repo, node))}" target="_blank" rel="noopener noreferrer">${t('pv.openGh')}</a></div></div>`
    );
  }

  function multiColumn(count) {
    return (
      `<div class="col col-preview"><div class="pv-media">${fileIcon('')}</div>` +
      `<div class="pv-name">${t('pv.multi', { n: count })}</div>` +
      `<div class="pv-actions"><button class="btn" type="button" data-action="quicklook">${t('pv.quicklook')} <kbd>Space</kbd></button>` +
      `<button class="btn" type="button" data-action="download">${t('pv.download')}</button></div></div>`
    );
  }

  function columnItem(repo, n, cls) {
    const chev = n.type === 'dir' ? '<span class="chev">›</span>' : '';
    return (
      `<div class="col-item${cls}" data-path="${esc(n.path)}">` +
      `<span class="mini">${thumbHtml(repo, n)}</span><span class="nm">${esc(n.name)}</span>${chev}</div>`
    );
  }

  /** 直欄：從根一路顯示到選取項目所在的資料夾；選到檔案則多一欄預覽 */
  function columnView(repo, cwd, selected, picked, filter) {
    const anchor = selected ? (selected.type === 'dir' && picked.size <= 1 ? selected : selected.parent) : cwd;
    const chain = ancestors(anchor);
    const cols = chain.map((dir, i) => {
      const next = chain[i + 1] || null;
      const items = dir.children.filter(filter);
      const html = items.length
        ? items.map((n) => {
            let cls = '';
            if (picked.has(n.path) && n.parent === (selected && selected.parent)) cls = ' selected';
            else if (n === next) cls = ' trail';
            return columnItem(repo, n, cls);
          }).join('')
        : `<div class="col-empty">${t('empty.column')}</div>`;
      return `<div class="col" data-dir="${esc(dir.path)}">${html}</div>`;
    });
    if (picked.size > 1) cols.push(multiColumn(picked.size));
    else if (selected && selected.type === 'file') cols.push(previewColumn(repo, selected));
    return `<div class="columns">${cols.join('')}</div>`;
  }

  const EXAMPLES = ['microsoft/fluentui-emoji', 'simple-icons/simple-icons', 'github/explore'];
  const MAX_WELCOME_RECENTS = 5;

  /** 「3 分鐘前」這類相對時間 */
  function timeAgo(ms) {
    if (!ms) return '';
    const rtf = new Intl.RelativeTimeFormat(GF.i18n.getLang(), { numeric: 'auto' });
    const sec = Math.round((ms - Date.now()) / 1000);
    const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
    const hit = units.find(([, size]) => Math.abs(sec) >= size);
    return hit ? rtf.format(Math.round(sec / hit[1]), hit[0]) : t('time.now');
  }

  function recentList(recents) {
    if (!recents.length) return '';
    const rows = recents
      .slice()
      .sort((a, b) => (b.openedAt || 0) - (a.openedAt || 0)) // 首頁依開啟時間排序，側邊欄則保留使用者順序
      .slice(0, MAX_WELCOME_RECENTS)
      .map((r) => {
        const key = `${r.owner}/${r.name}`.toLowerCase();
        const where = [r.branch, r.path].filter(Boolean).join(' · ');
        return (
          `<button type="button" class="recent-row" data-recent="${esc(key)}">` +
          `<span class="rc-icon">${repoIcon()}</span><span class="rc-text"><span class="rc-name">${esc(r.owner)}/${esc(r.name)}</span>` +
          `<span class="rc-sub">${esc(where)}</span></span><span class="rc-time">${esc(timeAgo(r.openedAt))}</span>` +
          '<span class="rc-chev">›</span></button>'
        );
      })
      .join('');
    return `<div class="recents"><div class="recents-title">${t('welcome.recent')}</div><div class="recent-list">${rows}</div></div>`;
  }

  function welcome(recents = []) {
    const examples = EXAMPLES.map((r) => `<button type="button" data-example="${esc(r)}">${esc(r)}</button>`).join('');
    const hint = (key, label) => `<span><kbd>${key}</kbd> ${t(label)}</span>`;
    return (
      '<div class="welcome">' +
      `<div class="welcome-icon">${logoIcon()}</div>` +
      '<h1>GitFinder</h1>' +
      `<p>${t('welcome.tagline')}</p>` +
      `<form id="welcome-form" autocomplete="off"><input id="welcome-input" type="text" spellcheck="false" placeholder="${esc(t('welcome.inputPh'))}"><button type="submit">${t('common.open')}</button></form>` +
      `<div class="examples">${t('welcome.try')}${examples}</div>` +
      recentList(recents) +
      `<div class="hints">${hint('Space', 'hint.quicklook')}${hint('← →', 'hint.switch')}${hint('Enter', 'hint.open')}` +
      `${hint('⌫', 'hint.up')}${hint('/', 'hint.search')}${hint(`${MOD_LABEL.replace('+', '')} / Shift`, 'hint.multi')}<span>${t('hint.menu')}</span></div>` +
      `<div class="welcome-foot">${t('welcome.foot')} · <a href="https://github.com/souseha/gitfinder" target="_blank" rel="noopener noreferrer">GitHub</a></div></div>`
    );
  }

  const loading = () => '<div class="empty"><div class="spinner"></div></div>';

  GF.views = Object.freeze({ thumbHtml, iconItem, iconShell, listRow, listShell, columnView, welcome, loading });
})(window.GF);
