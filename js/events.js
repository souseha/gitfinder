/* 事件綁定：滑鼠、鍵盤、工具列、側邊欄、啟動 */
(function (GF) {
  'use strict';

  const { store, KEYS, debounce, fileIcon } = GF.util;
  const A = GF.app;
  const QL = GF.quicklook;
  const { dom } = A;
  const S = () => A.state;

  const nodeOf = (el) => (el && S().tree ? S().tree.byPath.get(el.dataset.path) : null);
  const isMod = (e) => e.metaKey || e.ctrlKey;

  /* ---------- 內容區滑鼠 ---------- */
  function onItemClick(e, node) {
    if (e.shiftKey) A.rangeSelect(node);
    else if (isMod(e)) A.toggleSelect(node);
    else A.select(node);
  }

  dom.content.addEventListener('click', (e) => {
    const recent = e.target.closest('[data-recent]');
    if (recent) return A.openRecent(A.findRecent(recent.dataset.recent));
    const example = e.target.closest('[data-example]');
    if (example) return A.openFromInput(example.dataset.example);
    if (e.target.closest('[data-action="quicklook"]')) return A.openQuickLook();
    if (e.target.closest('[data-action="download"]')) return GF.actions.downloadNodes(A.selectedNodes());
    const node = nodeOf(e.target.closest('[data-path]'));
    if (!node) {
      const dragged = GF.marquee && GF.marquee.consumeDrag();
      if (!dragged && S().tree && A.effectiveView() !== 'column' && !isMod(e) && !e.shiftKey) A.select(null);
      return;
    }
    if (e.target.closest('[data-disc]') && node.type === 'dir' && !isMod(e) && !e.shiftKey) return A.toggleExpand(node);
    onItemClick(e, node);
  });

  dom.content.addEventListener('dblclick', (e) => {
    if (isMod(e) || e.shiftKey) return;
    const node = nodeOf(e.target.closest('[data-path]'));
    if (!node) return;
    if (node.type === 'dir' && A.effectiveView() === 'column' && !S().query) return;
    if (node.type === 'dir') A.navigate(node);
    else A.openQuickLook(node);
  });

  dom.content.addEventListener('submit', (e) => {
    if (e.target.id !== 'welcome-form') return;
    e.preventDefault();
    A.openFromInput(e.target.querySelector('input').value);
  });

  // 縮圖失敗時：代理圖 → 改用原圖；原圖也失敗 → 換成檔案圖示
  document.addEventListener('error', (e) => {
    const img = e.target;
    if (!(img instanceof HTMLImageElement) || img.classList.contains('ql-img') || !img.closest('.thumb, .mini, .ql-thumb, .pv-media')) return;
    const raw = img.dataset.raw;
    if (raw && img.src !== raw) {
      img.src = raw;
      return;
    }
    const wrap = document.createElement('span');
    wrap.className = 'broken';
    wrap.innerHTML = fileIcon(img.dataset.ext || '');
    img.replaceWith(wrap);
  }, true);

  /* ---------- 工具列 ---------- */
  dom.seg.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-view]');
    if (btn) A.setView(btn.dataset.view);
  });
  dom.back.addEventListener('click', A.goBack);
  dom.fwd.addEventListener('click', A.goForward);
  dom.home.addEventListener('click', () => {
    dom.app.classList.remove('sidebar-open');
    if (S().repo || S().loading) A.goHome();
  });
  dom.images.addEventListener('click', () => A.setState({ imagesOnly: !S().imagesOnly, selected: null }));
  /* ---------- 側邊欄收合 ---------- */
  const NARROW = window.matchMedia('(max-width: 780px)');

  function setSidebarCollapsed(collapsed) {
    dom.app.classList.toggle('sidebar-collapsed', collapsed);
    dom.sidebarBtn.setAttribute('aria-expanded', String(!collapsed));
    store.set(KEYS.sidebarCollapsed, collapsed);
  }

  /** 寬螢幕：收合 / 展開並記住；窄螢幕：側邊欄以浮層滑出 */
  function toggleSidebar() {
    if (NARROW.matches) dom.app.classList.toggle('sidebar-open');
    else setSidebarCollapsed(!dom.app.classList.contains('sidebar-collapsed'));
  }

  dom.sidebarBtn.addEventListener('click', toggleSidebar);
  setSidebarCollapsed(store.get(KEYS.sidebarCollapsed, false) === true);

  const applyQuery = debounce((q) => A.setState({ query: q.trim(), selected: null }), 160);
  dom.search.addEventListener('input', () => applyQuery(dom.search.value));

  function clearSearch() {
    dom.search.value = '';
    A.setState({ query: '', selected: null });
  }

  function applyIconSize(px) {
    const size = Math.min(240, Math.max(56, Number(px) || 112));
    document.documentElement.style.setProperty('--icon-size', `${size}px`);
    dom.size.value = String(size);
    return size;
  }
  dom.size.addEventListener('input', () => {
    store.set(KEYS.iconSize, applyIconSize(dom.size.value));
    A.relayout(); // 圖像大小改變，欄數與列高都要重算
  });

  dom.crumbs.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-crumb]');
    if (!btn || !S().tree) return;
    const node = S().tree.byPath.get(btn.dataset.crumb);
    if (!node) return;
    if (node.type === 'dir') A.navigate(node);
    else A.openQuickLook(node);
  });

  /* ---------- 側邊欄 ---------- */
  dom.openForm.addEventListener('submit', (e) => {
    e.preventDefault();
    if (A.openFromInput(dom.repoInput.value)) dom.repoInput.value = '';
  });

  dom.repoList.addEventListener('click', (e) => {
    const li = e.target.closest('[data-repo]');
    if (!li) return;
    if (e.target.closest('[data-remove]')) return A.removeRecent(li.dataset.repo);
    dom.app.classList.remove('sidebar-open');
    A.openRecent(A.findRecent(li.dataset.repo));
  });

  /* ---------- 側邊欄拖曳排序 ---------- */
  let dragKey = null;

  function clearDropMarks() {
    dom.repoList.querySelectorAll('.drop-before, .drop-after').forEach((el) => el.classList.remove('drop-before', 'drop-after'));
  }

  /** 找出放下的位置：滑鼠在某列上半部 = 放在它前面，下半部 = 後面；空白處 = 最後面 */
  function dropTarget(e) {
    const li = e.target.closest('[data-repo]');
    if (li) {
      const r = li.getBoundingClientRect();
      return { li, after: e.clientY > r.top + r.height / 2 };
    }
    const items = dom.repoList.querySelectorAll('[data-repo]');
    return items.length ? { li: items[items.length - 1], after: true } : null;
  }

  dom.repoList.addEventListener('dragstart', (e) => {
    const li = e.target.closest('[data-repo]');
    if (!li) return;
    dragKey = li.dataset.repo;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragKey);
    li.classList.add('dragging');
  });

  dom.repoList.addEventListener('dragover', (e) => {
    if (!dragKey) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const target = dropTarget(e);
    clearDropMarks();
    if (target && target.li.dataset.repo !== dragKey) target.li.classList.add(target.after ? 'drop-after' : 'drop-before');
  });

  dom.repoList.addEventListener('drop', (e) => {
    if (!dragKey) return;
    e.preventDefault();
    const target = dropTarget(e);
    if (target) A.moveRecent(dragKey, target.li.dataset.repo, target.after);
  });

  dom.repoList.addEventListener('dragend', () => {
    dragKey = null;
    clearDropMarks();
    dom.repoList.querySelectorAll('.dragging').forEach((el) => el.classList.remove('dragging'));
  });

  /* ---------- 鍵盤 ---------- */
  const gridColumns = () => A.gridCols();

  function move(delta, extend = false) {
    const list = A.navList();
    if (!list.length) return;
    const idx = list.indexOf(S().selected);
    const next = idx < 0 ? (delta > 0 ? 0 : list.length - 1) : Math.min(Math.max(idx + delta, 0), list.length - 1);
    if (extend && S().selected) A.rangeSelect(list[next]);
    else A.select(list[next]);
  }

  function arrowHorizontal(dir, extend) {
    const view = A.effectiveView();
    const sel = S().selected;
    if (view === 'icon') return move(dir, extend);
    if (!sel) return move(1);
    if (view === 'list') {
      if (sel.type === 'dir' && !S().query) {
        const open = S().expanded.has(sel.path);
        if (dir > 0 && !open) return A.toggleExpand(sel, true);
        if (dir < 0 && open) return A.toggleExpand(sel, false);
      }
      if (dir < 0 && sel.parent !== S().cwd && !S().query) return A.select(sel.parent);
      if (dir > 0) move(1);
      return;
    }
    // 直欄
    if (dir > 0 && sel.type === 'dir') {
      const first = sel.children.find(A.itemFilter());
      if (first) A.select(first);
    } else if (dir < 0 && sel.parent && sel.parent.parent) {
      A.select(sel.parent);
    }
  }

  function onQuickLookKey(e) {
    const k = e.key;
    if (k === ' ' || k === 'Escape') QL.close();
    else if (k === 'ArrowRight' || k === 'ArrowDown') QL.step(1);
    else if (k === 'ArrowLeft' || k === 'ArrowUp') QL.step(-1);
    else return;
    e.preventDefault();
  }

  function onInputKey(e) {
    if (e.key === 'Escape') {
      if (e.target === dom.search && dom.search.value) clearSearch();
      e.target.blur();
      dom.content.focus({ preventScroll: true });
    } else if (e.target === dom.search && (e.key === 'ArrowDown' || e.key === 'Enter')) {
      e.preventDefault();
      dom.search.blur();
      dom.content.focus({ preventScroll: true });
      move(1);
    }
  }

  function onModKey(e) {
    const k = e.key.toLowerCase();
    if (k === 'a') A.selectAll();
    else if (k === 'c') {
      if (String(window.getSelection())) return false; // 有選取文字時交給瀏覽器
      GF.actions.copyNames(A.selectedNodes());
    } else if (k === 'arrowdown') A.openNode(S().selected);
    else if (k === 'arrowup') A.goUp();
    else if (k === '[') A.goBack();
    else if (k === ']') A.goForward();
    else return false;
    return true;
  }

  function onBrowseKey(e) {
    const k = e.key;
    const view = A.effectiveView();
    if (isMod(e)) return onModKey(e);
    if (k === ' ') A.openQuickLook();
    else if (k === '/') dom.search.focus();
    else if (k === 'Escape') {
      if (S().query) clearSearch();
      else A.select(null);
    } else if (k === 'Enter') A.openNode(S().selected);
    else if (k === 'Backspace') A.goUp();
    else if (k === 'ArrowDown') move(view === 'icon' ? gridColumns() : 1, e.shiftKey);
    else if (k === 'ArrowUp') move(view === 'icon' ? -gridColumns() : -1, e.shiftKey);
    else if (k === 'ArrowRight') arrowHorizontal(1, e.shiftKey);
    else if (k === 'ArrowLeft') arrowHorizontal(-1, e.shiftKey);
    else if (k === '1' || k === '2' || k === '3') A.setView(['icon', 'list', 'column'][Number(k) - 1]);
    else return false;
    return true;
  }

  document.addEventListener('keydown', (e) => {
    if (QL.isOpen()) return onQuickLookKey(e);
    if (document.querySelector('dialog[open]')) return;
    if (isMod(e) && e.altKey && e.code === 'KeyS') {
      e.preventDefault();
      toggleSidebar();
      return;
    }
    if (isMod(e) && e.key.toLowerCase() === 'f') {
      e.preventDefault();
      dom.search.focus();
      dom.search.select();
      return;
    }
    if (e.target instanceof Element && e.target.matches('input, textarea, select')) return onInputKey(e);
    if (!S().tree) return;
    if (onBrowseKey(e)) e.preventDefault();
  });

  /* ---------- 啟動 ---------- */
  /** 舊版的 #repo=owner/repo&ref=main&path=… 連結，仍然可以打開 */
  function legacyHashTarget() {
    const params = new URLSearchParams(location.hash.slice(1));
    const parsed = GF.github.parseRepoInput(params.get('repo') || '');
    if (!parsed) return null;
    return { owner: parsed.owner, name: parsed.name, branch: params.get('ref') || null, path: params.get('path') || '' };
  }

  GF.i18n.applyStatic();
  applyIconSize(store.get(KEYS.iconSize, 112));
  A.renderSidebar();
  A.renderChrome();
  A.renderContent();
  // 網址優先：/owner/repo/tree/<branch>/<path>；首頁（/）才自動打開上次的倉庫
  const fromUrl = legacyHashTarget() || GF.github.parseRoute(location.pathname);
  if (fromUrl) A.openRepo(fromUrl);
  else if (store.get(KEYS.autoOpen, true) && A.getRecents()[0]) A.openRecent(A.getRecents()[0]);
})(window.GF);
