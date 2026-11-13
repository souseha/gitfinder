/* 右鍵選單：依點擊位置提供不同的操作，盡量貼近桌面 App 的體驗 */
(function (GF) {
  'use strict';

  const { esc, formatSize, isImage, MOD_LABEL } = GF.util;
  const { t } = GF.i18n;
  const { webUrl } = GF.github;
  const A = GF.app;
  const QL = GF.quicklook;
  const X = GF.actions;
  const D = GF.download;

  const menu = document.getElementById('ctx');
  let items = [];
  let focusIndex = -1;

  const SEP = Object.freeze({ sep: true });
  const S = () => A.state;
  const byPath = (p) => (S().tree ? S().tree.byPath.get(p) : null);

  /* ---------- 各情境的選單內容 ---------- */
  function copyItems(nodes) {
    const many = nodes.length > 1;
    const list = [
      { label: many ? t('menu.copyNames', { n: nodes.length }) : t('menu.copyName'), shortcut: `${MOD_LABEL}C`, run: () => X.copyNames(nodes) },
      { label: many ? t('menu.copyPaths', { n: nodes.length }) : t('menu.copyPath'), run: () => X.copyPaths(nodes) },
    ];
    if (!many && isImage(nodes[0])) list.unshift({ label: t('menu.copyImage'), run: () => X.copyImage(nodes[0]) });
    if (!many && nodes[0].type === 'file') list.push({ label: t('menu.copyRaw'), run: () => X.copyRawLink(nodes[0]) });
    if (!many) list.push({ label: t('menu.copyGh'), run: () => X.copyGhLink(nodes[0]) });
    return list;
  }

  function downloadItem(nodes) {
    const { files, bytes } = D.summary(nodes);
    if (nodes.length > 1) return { label: t('menu.downloadN', { n: nodes.length }), hint: formatSize(bytes), run: () => X.downloadNodes(nodes) };
    const node = nodes[0];
    if (node.type === 'file') return { label: t('menu.download'), hint: formatSize(node.size), run: () => X.downloadNodes(nodes) };
    return { label: t('menu.downloadFolder'), hint: t('menu.files', { files, size: formatSize(bytes) }), disabled: !files, run: () => X.downloadNodes(nodes) };
  }

  function nodesMenu(nodes) {
    const { repo } = S();
    if (nodes.length > 1) {
      return [
        { label: t('menu.quicklookN', { n: nodes.length }), shortcut: 'Space', run: () => A.openQuickLook(nodes[0]) },
        SEP, downloadItem(nodes), SEP, ...copyItems(nodes),
      ];
    }
    const node = nodes[0];
    const open = node.type === 'dir'
      ? [{ label: t('menu.open'), shortcut: '↩', run: () => A.navigate(node) },
        { label: t('menu.openNewTab'), run: () => X.openInNewTab(repo, node.path) }]
      : [{ label: t('menu.quicklook'), shortcut: 'Space', run: () => A.openQuickLook(node) }];
    return [...open, SEP, downloadItem(nodes), SEP, ...copyItems(nodes), SEP,
      { label: t('menu.openGh'), run: () => X.openOnGitHub(node) }];
  }

  function folderBackgroundMenu() {
    const st = S();
    const view = st.view;
    const radio = (v, key) => ({ label: t(key), checked: view === v, run: () => A.setView(v) });
    return [
      downloadItem([st.cwd]),
      { label: t('menu.selectAll'), shortcut: `${MOD_LABEL}A`, run: A.selectAll },
      SEP,
      { heading: t('menu.viewAs') },
      radio('icon', 'tb.viewIcon'), radio('list', 'tb.viewList'), radio('column', 'tb.viewColumn'),
      { label: t('menu.imagesOnly'), checked: st.imagesOnly, run: () => A.setState({ imagesOnly: !st.imagesOnly, selected: null }) },
      SEP,
      { label: t('menu.copyPath'), run: () => X.copyPaths([st.cwd]) },
      { label: t('menu.copyGh'), run: () => X.copyGhLink(st.cwd) },
      { label: t('menu.openGh'), run: () => X.openOnGitHub(st.cwd) },
    ];
  }

  function repoMenu(key) {
    const entry = A.findRecent(key);
    if (!entry) return [];
    const repo = {
      owner: entry.owner, name: entry.name, branch: entry.branch || 'HEAD',
      ...(typeof entry.commit === 'string' && { commit: { sha: entry.commit, parentSha: null } }),
    };
    const url = webUrl(repo, null);
    return [
      { label: t('menu.open'), run: () => A.openRecent(entry) },
      { label: t('menu.openNewTab'), run: () => X.openInNewTab(repo, entry.path || '') },
      SEP,
      { label: t('menu.copyRepoUrl'), run: () => X.copyText(`https://github.com/${entry.owner}/${entry.name}`) },
      { label: t('menu.openGh'), run: () => window.open(url, '_blank', 'noopener') },
      SEP,
      { label: t('menu.remove'), danger: true, run: () => A.removeRecent(key) },
    ];
  }

  function quickLookMenu(node) {
    return [downloadItem([node]), SEP, ...copyItems([node]), SEP, { label: t('menu.openGh'), run: () => X.openOnGitHub(node) }];
  }

  /** 依右鍵位置決定選單；回傳 null 代表交給瀏覽器原生選單 */
  function menuFor(target) {
    if (target.closest('input, textarea, select, [contenteditable], .ql-text, a[href]')) return null;
    const st = S();

    if (target.closest('#ql')) {
      const thumb = target.closest('.ql-thumb[data-i]');
      const node = thumb ? QL.nodeAt(Number(thumb.dataset.i)) : QL.current();
      return node ? quickLookMenu(node) : [];
    }
    const repoEl = target.closest('[data-repo], [data-recent]');
    if (repoEl) return repoMenu(repoEl.dataset.repo || repoEl.dataset.recent);
    const crumb = target.closest('[data-crumb]');
    if (crumb) {
      const node = byPath(crumb.dataset.crumb);
      return node ? nodesMenu([node]) : [];
    }
    if (target.closest('#content') && st.tree) {
      const itemEl = target.closest('[data-path]');
      if (!itemEl) return folderBackgroundMenu();
      const node = byPath(itemEl.dataset.path);
      if (!node) return [];
      // 在已選取的項目上按右鍵 → 作用於全部選取；否則先改成只選它
      if (!st.picked.has(node.path)) A.select(node);
      return nodesMenu(A.state.picked.size > 1 ? A.selectedNodes() : [node]);
    }
    return [];
  }

  /* ---------- 繪製與操作 ---------- */
  function itemHtml(it, i) {
    if (it.sep) return '<div class="ctx-sep" role="separator"></div>';
    if (it.heading) return `<div class="ctx-heading">${esc(it.heading)}</div>`;
    const check = it.checked == null ? '' : `<span class="ctx-check">${it.checked ? '✓' : ''}</span>`;
    const right = it.shortcut || it.hint ? `<span class="ctx-right">${esc(it.shortcut || it.hint)}</span>` : '';
    const cls = `ctx-item${it.danger ? ' danger' : ''}${it.checked != null ? ' has-check' : ''}`;
    return `<button type="button" role="menuitem" class="${cls}" data-i="${i}"${it.disabled ? ' disabled' : ''}>${check}<span class="ctx-label">${esc(it.label)}</span>${right}</button>`;
  }

  /** 移除開頭、結尾與連續的分隔線 */
  function tidy(list) {
    return list.filter((it, i, arr) => !(it.sep && (i === 0 || i === arr.length - 1 || arr[i - 1].sep)));
  }

  function openMenu(list, x, y) {
    items = tidy(list);
    if (!items.length) {
      closeMenu();
      return;
    }
    focusIndex = -1;
    menu.innerHTML = items.map(itemHtml).join('');
    menu.classList.remove('hidden');
    GF.tooltip.hide();
    const rect = menu.getBoundingClientRect();
    menu.style.left = `${Math.max(4, Math.min(x, window.innerWidth - rect.width - 4))}px`;
    menu.style.top = `${Math.max(4, Math.min(y, window.innerHeight - rect.height - 4))}px`;
  }

  const closeMenu = () => menu.classList.add('hidden');
  const isOpen = () => !menu.classList.contains('hidden');

  function runItem(index) {
    const it = items[index];
    if (!it || it.sep || it.heading || it.disabled) return;
    closeMenu();
    it.run();
  }

  function moveFocus(delta) {
    const buttons = [...menu.querySelectorAll('.ctx-item:not(:disabled)')];
    if (!buttons.length) return;
    const pos = buttons.findIndex((b) => Number(b.dataset.i) === focusIndex);
    const next = buttons[(pos + delta + buttons.length) % buttons.length];
    focusIndex = Number(next.dataset.i);
    next.focus();
  }

  menu.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-i]');
    if (btn) runItem(Number(btn.dataset.i));
  });
  menu.addEventListener('contextmenu', (e) => e.preventDefault());

  document.addEventListener('contextmenu', (e) => {
    if (!(e.target instanceof Element) || menu.contains(e.target)) return;
    const list = menuFor(e.target);
    if (list === null) return; // 輸入框、連結、文字預覽：保留原生選單
    e.preventDefault();
    openMenu(list, e.clientX, e.clientY);
  });

  // 用 pointerdown 而不是 mousedown：框選在空白處會對 pointerdown 呼叫 preventDefault，
  // 瀏覽器因此不會再送出 mousedown，選單就收不到「點了別處」的通知
  document.addEventListener('pointerdown', (e) => {
    if (isOpen() && !menu.contains(e.target)) closeMenu();
  }, true);

  document.addEventListener('keydown', (e) => {
    if (!isOpen()) return;
    const k = e.key;
    if (k === 'Escape') closeMenu();
    else if (k === 'ArrowDown') moveFocus(1);
    else if (k === 'ArrowUp') moveFocus(-1);
    else if (k === 'Enter' || k === ' ') runItem(focusIndex);
    else return;
    e.preventDefault();
    e.stopImmediatePropagation();
  }, true);

  window.addEventListener('blur', closeMenu);
  window.addEventListener('resize', closeMenu);
  document.addEventListener('scroll', closeMenu, true);

  /* ---------- 燈箱下載按鈕 ---------- */
  document.getElementById('ql-dl').addEventListener('click', () => {
    const node = QL.current();
    if (node) X.downloadNodes([node]);
  });
})(window.GF);
