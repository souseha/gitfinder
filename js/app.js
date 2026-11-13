/* 主程式：狀態、渲染、導覽、選取、倉庫記憶 */
(function (GF) {
  'use strict';

  const { store, KEYS, isImage, esc, recentKey, debounce, fileIcon, repoIcon, folderIcon } = GF.util;
  const { t } = GF.i18n;
  const gh = GF.github;
  const T = GF.tree;
  const V = GF.views;
  const QL = GF.quicklook;

  const $ = (id) => document.getElementById(id);
  const dom = {
    app: $('app'), content: $('content'), crumbs: $('crumbs'), status: $('status'), title: $('title'),
    repoList: $('repo-list'), search: $('search'), seg: $('view-seg'), size: $('icon-size'),
    back: $('btn-back'), fwd: $('btn-fwd'), home: $('btn-home'), images: $('btn-images'),
    repoInput: $('repo-input'), openForm: $('open-form'), toast: $('toast'), rate: $('rate'), sidebarBtn: $('btn-sidebar'),
  };

  const VIEWS = ['icon', 'list', 'column'];
  const savedView = store.get(KEYS.view, 'icon');
  const EMPTY = new Set();

  /**
   * selected：焦點項目（鍵盤移動、預覽的對象）
   * picked：所有被選取的路徑（多選）；anchor：Shift 範圍選取的起點
   */
  let state = Object.freeze({
    repo: null, tree: null, truncated: false, cwd: null, selected: null, picked: EMPTY, anchor: null,
    view: VIEWS.includes(savedView) ? savedView : 'icon',
    query: '', imagesOnly: false, changeFilter: 'all', overview: false, overviewFrom: null, expanded: EMPTY, back: [], fwd: [], loading: false,
  });

  const treeCache = new Map();
  const repoKey = (r) => `${r.owner}/${r.name}`.toLowerCase();
  /** commit 只含變動檔案，和同一個 sha 的整棵樹分開快取；PR 用編號 */
  const commitCacheKey = (r, sha) => `${repoKey(r)}#commit@${sha}`;
  const pullCacheKey = (r, number) => `${repoKey(r)}#pull@${number}`;
  const changeCacheKey = (r, commit) => (commit.pull ? pullCacheKey(r, commit.pull.number) : commitCacheKey(r, commit.sha));
  /** 路徑列與側邊欄顯示的版本：PR 用編號，commit 用短 sha */
  const changeLabel = (commit) => (commit.pull ? `#${commit.pull.number}` : GF.commit.shortSha(commit.sha));

  /** 只給 selected 時，picked / anchor 自動跟著變成單選 */
  function normalize(patch) {
    if (!('selected' in patch)) return patch;
    const sel = patch.selected;
    return {
      ...patch,
      picked: 'picked' in patch ? patch.picked : sel ? new Set([sel.path]) : EMPTY,
      anchor: 'anchor' in patch ? patch.anchor : sel,
    };
  }

  function setState(patch, { content = true, scroll = true } = {}) {
    state = Object.freeze({ ...state, ...normalize(patch) });
    renderChrome();
    if (content) renderContent();
    else markSelection(scroll);
  }

  /* ---------- 衍生資料 ---------- */
  /** commit 總覽：整個 commit 攤平成一張格子（只在 commit 模式有效） */
  const isOverview = () => !!(state.overview && state.repo && state.repo.commit);

  /** 搜尋時直欄改列表；總覽沒有資料夾結構，直欄改圖像 */
  function effectiveView() {
    if (state.view !== 'column') return state.view;
    if (state.query) return 'list';
    return isOverview() ? 'icon' : 'column';
  }

  /** commit 檢視的狀態篩選：檔案看自己的狀態，資料夾看底下有沒有這種狀態的檔案 */
  /** 「修改」包含改名 */
  const STATUSES_FOR = Object.freeze({ added: ['added'], removed: ['removed'], modified: ['modified', 'renamed'] });

  function changeMatch(n) {
    const statuses = STATUSES_FOR[state.changeFilter];
    if (!statuses) return true;
    if (n.type === 'dir') return !!n.changes && statuses.some((s) => n.changes[s] > 0);
    return !!n.change && statuses.includes(n.change.status);
  }

  function itemFilter() {
    const images = state.imagesOnly ? (n) => (n.type === 'dir' ? n.stats.images > 0 : isImage(n)) : () => true;
    return (n) => images(n) && changeMatch(n);
  }

  function currentRows() {
    if (!state.tree) return [];
    if (state.query) {
      return T.search(state.tree.all, state.query)
        .filter((n) => (!state.imagesOnly || isImage(n)) && changeMatch(n))
        .map((node) => ({ node, depth: 0 }));
    }
    const filter = itemFilter();
    if (isOverview()) return state.tree.all.filter((n) => n.type === 'file' && filter(n)).map((node) => ({ node, depth: 0 }));
    if (effectiveView() === 'list') return T.flatten(state.cwd, state.expanded, filter);
    return state.cwd.children.filter(filter).map((node) => ({ node, depth: 0 }));
  }

  /** 鍵盤移動、範圍選取與快速查看所使用的項目序列 */
  function navList() {
    if (!state.tree) return [];
    if (effectiveView() === 'column') {
      const dir = state.selected ? state.selected.parent : state.cwd;
      return dir.children.filter(itemFilter());
    }
    return currentRows().map((r) => r.node);
  }

  /** 目前選取的節點（依畫面順序） */
  function selectedNodes() {
    if (!state.tree || !state.picked.size) return [];
    const inView = navList().filter((n) => state.picked.has(n.path));
    if (inView.length === state.picked.size) return inView;
    return [...state.picked].map((p) => state.tree.byPath.get(p)).filter(Boolean);
  }

  /* ---------- 渲染 ---------- */
  function ensureVisible(container, el) {
    const c = container.getBoundingClientRect();
    const r = el.getBoundingClientRect();
    if (r.top < c.top) container.scrollTop -= c.top - r.top + 8;
    else if (r.bottom > c.bottom) container.scrollTop += r.bottom - c.bottom + 8;
  }

  /** 欄的左邊界最多切掉多少像素可以接受（預覽欄右側本來就有留白） */
  const COLUMN_SNAP_SLACK = 48;

  /**
   * 決定直欄的水平捲動位置：最後一欄要看得到，並對齊到某一欄的左邊界，
   * 避免最左邊的欄只露出一半。往左對齊只會切到最後一欄一點點時，優先往左。
   */
  function snapColumns(cols, prevLeft) {
    const last = cols.lastElementChild;
    if (!last) return 0;
    const needed = last.offsetLeft + last.offsetWidth - cols.clientWidth;
    const desired = Math.max(prevLeft, needed);
    const lefts = [...cols.children].map((col) => col.offsetLeft);
    const down = Math.max(0, ...lefts.filter((left) => left <= desired));
    const up = lefts.find((left) => left >= desired);
    if (desired - down <= COLUMN_SNAP_SLACK || up === undefined) return down;
    // 捲不到 up 時把最後一欄撐寬，讓畫面能剛好從某一欄的左邊界開始
    const fill = cols.clientWidth - (last.offsetLeft - up);
    if (fill > last.offsetWidth) last.style.minWidth = `${fill}px`;
    return up;
  }

  /** 直欄重繪時保留每一欄原本的捲動位置，只在項目看不到時才捲動 */
  function renderColumns(c) {
    const prev = new Map([...c.querySelectorAll('.col[data-dir]')].map((col) => [col.dataset.dir, col.scrollTop]));
    const prevLeft = c.querySelector('.columns') ? c.querySelector('.columns').scrollLeft : 0;
    c.innerHTML = V.columnView(state.repo, state.cwd, state.selected, state.picked, itemFilter());
    c.querySelectorAll('.col[data-dir]').forEach((col) => {
      if (prev.has(col.dataset.dir)) col.scrollTop = prev.get(col.dataset.dir);
      const mark = col.querySelector('.col-item.selected, .col-item.trail');
      if (mark) ensureVisible(col, mark);
    });
    const cols = c.querySelector('.columns');
    cols.scrollLeft = snapColumns(cols, prevLeft);
  }

  /* ---------- 虛擬捲動（圖像 / 列表） ---------- */
  const VR = GF.virtual;
  const vview = VR.createController(dom.content);
  let viewRows = [];

  function toElement(html) {
    const tpl = document.createElement('template');
    tpl.innerHTML = html;
    return tpl.content.firstElementChild;
  }

  const iconSizePx = () => parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--icon-size')) || 112;

  function applyRange(body, layout, range) {
    if (layout.kind === 'icon') {
      body.style.gridTemplateColumns = `repeat(${layout.cols}, minmax(0, 1fr))`;
      body.style.setProperty('--item-h', `${layout.itemH}px`);
      body.style.paddingTop = `${VR.ICON.padY + range.startRow * layout.rowH}px`;
      body.style.paddingBottom = `${VR.ICON.padY + (layout.rows - range.endRow) * layout.rowH}px`;
    } else {
      body.style.paddingTop = `${VR.LIST.bodyPadTop + range.startRow * layout.rowH}px`;
      body.style.paddingBottom = `${(layout.rows - range.endRow) * layout.rowH}px`;
    }
  }

  function mountVirtual(view, rows, showPath) {
    const c = dom.content;
    c.innerHTML = view === 'icon' ? V.iconShell() : V.listShell(showPath);
    const body = c.querySelector(view === 'icon' ? '.icon-grid' : '.list-body');
    const { repo, expanded } = state;
    viewRows = rows;
    vview.mount({
      body,
      getLayout: (width) => (view === 'icon'
        ? VR.iconLayout({ width, count: rows.length, iconSize: iconSizePx(), showPath })
        : VR.listLayout({ width, count: rows.length })),
      keyAt: (i) => rows[i].node.path,
      build: (i) => toElement(view === 'icon'
        ? V.iconItem(repo, rows[i].node, showPath)
        : V.listRow(repo, rows[i], expanded, showPath)),
      decorate: (el, i) => {
        el.classList.toggle('selected', state.picked.has(rows[i].node.path));
        if (view === 'list') el.classList.toggle('alt', i % 2 === 1);
      },
      applyRange: (layout, range) => applyRange(body, layout, range),
    });
  }

  /** 換資料夾後回到頂端，並立即畫出新的可見範圍 */
  function resetScroll() {
    dom.content.scrollTop = 0;
    vview.paintNow();
  }

  function renderContent() {
    const c = dom.content;
    vview.unmount();
    if (!state.tree) {
      c.className = 'content';
      c.innerHTML = state.loading ? V.loading() : V.welcome(getRecents());
      return;
    }
    const view = effectiveView();
    const switching = !c.classList.contains(`view-${view}`);
    c.className = `content view-${view}`;
    if (view === 'column') {
      if (switching) c.innerHTML = '';
      renderColumns(c);
      return;
    }
    const rows = currentRows();
    if (!rows.length) {
      let msg = t('empty.folder');
      if (state.query) msg = t('empty.search', { q: esc(state.query) });
      else if (isOverview()) msg = t(state.repo.commit.pull ? 'empty.noPullChanges' : 'empty.noCommitChanges');
      else if (state.changeFilter !== 'all') msg = t('empty.noChanges');
      else if (state.imagesOnly) msg = t('empty.noImages');
      c.innerHTML = `<div class="empty">${msg}</div>`;
      return;
    }
    mountVirtual(view, rows, !!state.query || isOverview());
  }

  const findEl = (node) => dom.content.querySelector(`[data-path="${CSS.escape(node.path)}"]`);

  function markSelection(scroll = true) {
    if (vview.active) {
      vview.redecorate();
      if (scroll && state.selected) vview.reveal(viewRows.findIndex((r) => r.node === state.selected));
      return;
    }
    dom.content.querySelectorAll('[data-path]').forEach((el) => {
      el.classList.toggle('selected', state.picked.has(el.dataset.path));
    });
    if (!scroll || !state.selected) return;
    const el = findEl(state.selected);
    if (el) el.scrollIntoView({ block: 'nearest' });
  }

  function renderCrumbs() {
    if (!state.repo) {
      dom.crumbs.innerHTML = '';
      return;
    }
    // 總覽沒有資料夾位置，路徑列只留 repo
    const chain = isOverview() ? [state.tree.root] : T.ancestors(state.selected || state.cwd);
    const sep = '<span class="crumb-sep">›</span>';
    dom.crumbs.innerHTML = chain
      .map((n, i) => {
        if (i === 0) {
          return `<button class="crumb" data-crumb=""><span class="ri-icon">${repoIcon()}</span><span>${esc(state.repo.owner)}/${esc(state.repo.name)}</span><span class="branch-chip">${esc(state.repo.commit ? changeLabel(state.repo.commit) : state.repo.branch)}</span></button>`;
        }
        const icon = n.type === 'dir' ? folderIcon() : fileIcon(n.label);
        return `${sep}<button class="crumb" data-crumb="${esc(n.path)}">${icon}<span>${esc(n.name)}</span></button>`;
      })
      .join('');
  }

  function renderStatus() {
    if (!state.tree) {
      dom.status.textContent = '';
      return;
    }
    const nodes = navList();
    const images = nodes.filter(isImage).length;
    const parts = [state.query ? t('count.found', { n: nodes.length }) : t('count.items', { n: nodes.length })];
    if (images) parts.push(t('count.images', { n: images }));
    if (state.picked.size > 1) parts.push(t('count.selected', { n: state.picked.size }));
    const warn = state.truncated ? ` · <span class="warn">${t('status.truncated')}</span>` : '';
    dom.status.innerHTML = esc(parts.join(' · ')) + warn;
  }

  /** 剩不到四分之一就變色提醒（沒有 token 時是 15 / 60） */
  const RATE_LOW_RATIO = 0.25;

  /** 側邊欄底部的 API 額度：數字加小進度條，點擊可打開設定 */
  function renderRate() {
    const rate = gh.getRate();
    dom.rate.classList.toggle('hidden', !rate);
    if (!rate) return;
    const ratio = rate.limit > 0 ? rate.remaining / rate.limit : 0;
    const tip = t('sidebar.rateTip', { left: rate.remaining, limit: rate.limit });
    dom.rate.classList.toggle('low', ratio <= RATE_LOW_RATIO);
    dom.rate.dataset.tip = tip;
    dom.rate.setAttribute('aria-label', tip);
    dom.rate.innerHTML =
      `<span>API ${rate.remaining}/${rate.limit}</span>` +
      `<span class="rate-bar" aria-hidden="true"><i style="width:${Math.round(Math.min(Math.max(ratio, 0), 1) * 100)}%"></i></span>`;
  }

  function renderChrome() {
    dom.seg.querySelectorAll('button').forEach((b) => b.classList.toggle('active', b.dataset.view === state.view));
    dom.size.classList.toggle('hidden', effectiveView() !== 'icon');
    dom.images.classList.toggle('on', state.imagesOnly);
    dom.back.disabled = !state.back.length || isOverview();
    dom.fwd.disabled = !state.fwd.length || isOverview();
    dom.home.classList.toggle('active', !state.repo);
    dom.app.classList.toggle('is-loading', state.loading);
    const cwdName = state.cwd && state.cwd.path ? state.cwd.name : state.repo ? state.repo.name : 'GitFinder';
    let title = cwdName;
    if (state.query) title = t('tb.search', { q: state.query });
    else if (isOverview()) title = t('commit.overview');
    dom.title.textContent = title;
    document.title = state.repo ? `${cwdName} — ${state.repo.owner}/${state.repo.name}` : 'GitFinder';
    renderCrumbs();
    renderStatus();
    GF.commit.render(state);
    renderRate();
  }

  /* ---------- 倉庫記憶（localStorage） ---------- */
  function getRecents() {
    const list = store.get(KEYS.repos, []);
    return Array.isArray(list) ? list.filter((r) => r && typeof r.owner === 'string' && typeof r.name === 'string') : [];
  }

  const findRecent = (key) => getRecents().find((r) => recentKey(r) === key) || null;

  /**
   * 側邊欄順序由使用者決定：已存在的倉庫原地更新（不移動位置），新倉庫加在最上面。
   * 不限數量，只有使用者自己移除才會消失。
   */
  function saveRecent(repo, path) {
    const list = getRecents();
    const entry = {
      owner: repo.owner, name: repo.name, branch: repo.branch, path: path || '', openedAt: Date.now(),
      ...(repo.commit && { commit: repo.commit.sha, commitTitle: repo.commit.message.split('\n')[0] }),
      ...(repo.commit && repo.commit.pull && { pull: repo.commit.pull.number }),
    };
    const key = recentKey(entry);
    const exists = list.some((r) => recentKey(r) === key);
    const next = exists ? list.map((r) => (recentKey(r) === key ? entry : r)) : [entry, ...list];
    store.set(KEYS.repos, next);
    renderSidebar();
  }

  /** 拖曳排序：把 fromKey 移到 toKey 的前面或後面 */
  function moveRecent(fromKey, toKey, after) {
    if (fromKey === toKey) return;
    const list = getRecents();
    const moving = list.find((r) => recentKey(r) === fromKey);
    if (!moving) return;
    const rest = list.filter((r) => recentKey(r) !== fromKey);
    const idx = rest.findIndex((r) => recentKey(r) === toKey);
    if (idx < 0) return;
    const at = after ? idx + 1 : idx;
    store.set(KEYS.repos, [...rest.slice(0, at), moving, ...rest.slice(at)]);
    renderSidebar();
  }

  function removeRecent(key) {
    store.set(KEYS.repos, getRecents().filter((r) => recentKey(r) !== key));
    renderSidebar();
    if (!state.tree) renderContent();
  }

  /** commit / PR 項目的小字：有訊息就顯示訊息，否則顯示短 sha；PR 前面加編號 */
  const recentCommitLabel = (r) => GF.commit.recentLabel(r);

  /** 用 SVG 畫叉叉：文字的「×」會受字型基線影響而偏離圓心 */
  const REMOVE_ICON = '<svg viewBox="0 0 10 10" aria-hidden="true"><path d="M2.5 2.5l5 5M7.5 2.5l-5 5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>';

  function renderSidebar() {
    const list = getRecents();
    const commit = state.repo && state.repo.commit;
    const current = state.repo
      ? recentKey({ ...state.repo, commit: commit && commit.sha, pull: commit && commit.pull && commit.pull.number })
      : '';
    dom.repoList.innerHTML = list.length
      ? list
          .map((r) => {
            const key = recentKey(r);
            const sub = [r.owner, r.commit ? recentCommitLabel(r) : r.branch].filter(Boolean).map(esc).join(' · ');
            return (
              `<li class="repo-item${key === current ? ' active' : ''}" data-repo="${esc(key)}" draggable="true">` +
              `<span class="ri-icon">${repoIcon()}</span><span class="ri-text"><span class="ri-name">${esc(r.name)}</span>` +
              `<span class="ri-owner">${sub}</span></span><button class="ri-remove" type="button" data-remove data-tip="${esc(t('sidebar.remove'))}" aria-label="${esc(t('sidebar.remove'))}">${REMOVE_ICON}</button></li>`
            );
          })
          .join('')
      : `<li class="repo-empty">${t('sidebar.empty')}</li>`;
  }

  function persistLocation() {
    if (!state.repo) return;
    const path = state.cwd ? state.cwd.path : '';
    history.replaceState(null, '', gh.routeUrl(state.repo, path));
    saveRecent(state.repo, path);
  }
  const persistLater = debounce(persistLocation, 400);

  /* ---------- 載入倉庫 ---------- */
  let loadSeq = 0;

  /**
   * 已載入過的倉庫直接用快取。網址帶 refPath（分支 + 路徑混在一起）時，
   * 用已知的分支名稱比對前綴來拆開，就不必再呼叫 API。
   */
  function fromCache(target) {
    const prefix = `${repoKey(target)}@`;
    if (target.pull) return { data: treeCache.get(pullCacheKey(target, target.pull)) || null, path: target.path || '' };
    if (target.commit) return { data: treeCache.get(commitCacheKey(target, target.commit)) || null, path: target.path || '' };
    if (target.branch) return { data: treeCache.get(prefix + target.branch) || null, path: target.path || '' };
    if (!target.refPath) return { data: null, path: '' };
    for (const [key, data] of treeCache) {
      if (!key.startsWith(prefix)) continue;
      const { branch } = data;
      if (target.refPath === branch || target.refPath.startsWith(`${branch}/`)) {
        return { data, path: target.refPath.slice(branch.length + 1) };
      }
    }
    return { data: null, path: '' };
  }

  /** 分支：抓整棵檔案樹；commit / PR：只抓變動的檔案，branch 設成（head）完整 sha */
  async function loadTarget(target, opts) {
    if (target.commit || target.pull) {
      const res = target.pull ? await gh.fetchPull(target, opts) : await gh.fetchCommit(target, opts);
      const tree = T.buildTree(res.entries);
      const commit = Object.freeze({
        sha: res.sha, parentSha: res.parentSha, message: res.message, counts: tree.root.changes,
        ...(res.pull && { pull: Object.freeze({ ...res.pull }) }),
      });
      return { data: Object.freeze({ branch: res.sha, tree, truncated: res.truncated, commit }), path: target.path || '' };
    }
    const res = await gh.fetchRepo(target, opts);
    return { data: Object.freeze({ branch: res.branch, tree: T.buildTree(res.entries), truncated: res.truncated }), path: res.path };
  }

  /** @param {{ refresh?: boolean }} [opts] refresh：略過所有快取，重新向 GitHub 要一次 */
  async function openRepo(target, { refresh = false } = {}) {
    const seq = ++loadSeq;
    QL.close();
    setState({ loading: true }, { content: !state.tree });
    try {
      let retried = false;
      let { data, path } = refresh ? { data: null, path: target.path || '' } : fromCache(target);
      if (!data) {
        const loaded = await loadTarget(target, {
          refresh,
          onRetry: (n, total) => {
            retried = true;
            if (seq === loadSeq) toast(t('toast.retrying', { n, total }), 'info', 15000);
          },
        });
        data = loaded.data;
        treeCache.set(data.commit ? changeCacheKey(target, data.commit) : `${repoKey(target)}@${data.branch}`, data);
        path = loaded.path;
      }
      if (seq !== loadSeq) return;
      if (retried) hideToast();
      const repo = Object.freeze({ owner: target.owner, name: target.name, branch: data.branch, ...(data.commit && { commit: data.commit }) });
      const hit = path ? data.tree.byPath.get(path) : null;
      let cwd = data.tree.root;
      let selected = null;
      if (hit) {
        cwd = hit.type === 'dir' ? hit : hit.parent;
        selected = hit.type === 'dir' ? null : hit;
      } else if (path) {
        toast(t('toast.pathMissing', { path }));
      }
      dom.search.value = '';
      // 直接打開深層網址時，把上層資料夾放進「上一頁」，按上一頁就能一層層往回走
      const back = T.ancestors(cwd).slice(0, -1);
      setState({ repo, tree: data.tree, truncated: data.truncated, cwd, selected, query: '', changeFilter: 'all', overview: false, overviewFrom: null, expanded: EMPTY, back, fwd: [], loading: false });
      resetScroll();
      store.set(KEYS.autoOpen, true);
      persistLocation();
      if (data.truncated) toast(t('toast.truncated'));
      dom.content.focus({ preventScroll: true });
    } catch (err) {
      if (seq !== loadSeq) return;
      setState({ loading: false });
      toast(err instanceof Error ? err.message : t('toast.loadFail'), 'error');
    }
  }

  function openFromInput(value) {
    const parsed = gh.parseRepoInput(value);
    if (!parsed) {
      toast(t('toast.badInput'), 'error');
      return false;
    }
    dom.app.classList.remove('sidebar-open');
    openRepo(parsed);
    return true;
  }

  const openRecent = (entry, opts) =>
    entry && openRepo({
      owner: entry.owner, name: entry.name, branch: entry.branch || null, path: entry.path || '',
      // PR 用編號開啟（重新整理後最多 10 分鐘就會看到新的 push）；commit 則固定在記下的 sha
      ...(entry.pull ? { pull: entry.pull } : entry.commit && { commit: entry.commit }),
    }, opts);

  /** 從 GitHub 重新載入目前的倉庫（剛 push 的內容、換了 token 之後） */
  function reloadRepo() {
    const { repo } = state;
    if (!repo) return;
    const commit = repo.commit;
    let target = { owner: repo.owner, name: repo.name, branch: repo.branch, path: state.cwd ? state.cwd.path : '' };
    if (commit && commit.pull) target = { ...target, branch: null, pull: commit.pull.number };
    else if (commit) target = { ...target, branch: null, commit: commit.sha };
    openRepo(target, { refresh: true });
  }

  /* ---------- 導覽 ---------- */
  function navigate(dir, { select: sel = null } = {}) {
    if (!dir || dir.type !== 'dir') return;
    const back = state.cwd && state.cwd !== dir ? [...state.back, state.cwd].slice(-100) : state.back;
    dom.search.value = '';
    // 從總覽（例如搜尋結果裡的資料夾）打開資料夾時，同時離開總覽
    setState({ cwd: dir, selected: sel, back, fwd: [], query: '', expanded: EMPTY, overview: false, overviewFrom: null });
    if (!sel) resetScroll();
    else markSelection();
    persistLocation();
  }

  function historyMove(from, to) {
    if (isOverview()) return;
    const stack = [...state[from]];
    const target = stack.pop();
    if (!target) return;
    const sel = state.cwd.parent === target ? state.cwd : null;
    dom.search.value = '';
    setState({ cwd: target, selected: sel, [from]: stack, [to]: [...state[to], state.cwd], query: '', expanded: EMPTY });
    persistLocation();
  }
  const goBack = () => historyMove('back', 'fwd');
  const goForward = () => historyMove('fwd', 'back');
  const goUp = () => !isOverview() && state.cwd && state.cwd.parent && navigate(state.cwd.parent, { select: state.cwd });

  /** 打開總覽時位置固定在 repo 根目錄；關閉時回到原本的資料夾 */
  function toggleOverview() {
    if (!state.repo || !state.repo.commit) return;
    if (state.overview) {
      setState({ overview: false, overviewFrom: null, cwd: state.overviewFrom || state.tree.root, selected: null, expanded: EMPTY });
    } else {
      setState({ overview: true, overviewFrom: state.cwd, cwd: state.tree.root, selected: null, expanded: EMPTY });
    }
    resetScroll();
    persistLocation();
  }

  /** 關閉目前倉庫回到首頁；重新整理後也停留在首頁 */
  function goHome() {
    loadSeq += 1;
    QL.close();
    dom.search.value = '';
    store.set(KEYS.autoOpen, false);
    history.replaceState(null, '', '/');
    setState({ repo: null, tree: null, truncated: false, cwd: null, selected: null, query: '', expanded: EMPTY, back: [], fwd: [], loading: false });
    renderSidebar();
  }

  /* ---------- 選取 ---------- */
  /** 直欄模式換到別的資料夾時要記錄上一頁，切回圖像 / 列表後才能返回 */
  function columnPatch(node) {
    if (effectiveView() !== 'column' || !node || node.parent === state.cwd) return {};
    return { cwd: node.parent, back: [...state.back, state.cwd].slice(-100), fwd: [] };
  }

  function commitSelection(patch) {
    const column = effectiveView() === 'column';
    setState({ ...patch, ...columnPatch(patch.selected) }, { content: column });
    if (column) persistLater();
  }

  function select(node) {
    if (node === state.selected && state.picked.size <= 1) return;
    commitSelection({ selected: node });
  }

  /** Ctrl / ⌘ + 點擊：加入或移出選取 */
  function toggleSelect(node) {
    if (effectiveView() === 'column' && state.selected && node.parent !== state.selected.parent) return select(node);
    const picked = new Set(state.picked);
    if (picked.has(node.path)) picked.delete(node.path);
    else picked.add(node.path);
    const focus = picked.has(node.path) ? node : selectedNodesFrom(picked)[0] || null;
    commitSelection({ selected: focus, picked, anchor: node });
  }

  const selectedNodesFrom = (picked) => navList().filter((n) => picked.has(n.path));

  /** Shift + 點擊 / 方向鍵：從 anchor 到 node 的範圍 */
  function rangeSelect(node) {
    const list = navList();
    const from = list.indexOf(state.anchor || state.selected);
    const to = list.indexOf(node);
    if (from < 0 || to < 0) return select(node);
    const [a, b] = from < to ? [from, to] : [to, from];
    const picked = new Set(list.slice(a, b + 1).map((n) => n.path));
    commitSelection({ selected: node, picked, anchor: state.anchor || state.selected });
  }

  function selectAll() {
    const list = navList();
    if (!list.length) return;
    commitSelection({ selected: list[0], picked: new Set(list.map((n) => n.path)), anchor: list[0] });
  }

  /** 框選：直接指定選取集合，不捲動 */
  function setPicked(paths, focus) {
    setState({ selected: focus, picked: paths, anchor: focus, ...columnPatch(focus) }, { content: false, scroll: false });
  }

  function openNode(node) {
    if (!node) return;
    if (node.type === 'dir') {
      if (effectiveView() === 'column' && !state.query) {
        const first = node.children.find(itemFilter());
        if (first) select(first);
      } else {
        navigate(node);
      }
      return;
    }
    openQuickLook(node);
  }

  function openQuickLook(start) {
    const picked = selectedNodes();
    const pool = picked.length > 1 ? picked : navList();
    const node = start || state.selected || pool.find((n) => n.type === 'file');
    if (!node) return;
    const list = node.type === 'dir' ? pool : pool.filter((n) => n.type === 'file');
    const keepPicked = picked.length > 1;
    QL.open(state.repo, list, list.indexOf(node), (n) => {
      if (keepPicked) setState({ selected: n, picked: state.picked }, { content: effectiveView() === 'column' });
      else select(n);
    });
  }

  function toggleExpand(node, force) {
    const open = force === undefined ? !state.expanded.has(node.path) : force;
    const expanded = new Set(state.expanded);
    if (open) expanded.add(node.path);
    else expanded.delete(node.path);
    setState({ expanded });
  }

  function setView(view) {
    if (!VIEWS.includes(view) || view === state.view) return;
    store.set(KEYS.view, view);
    const keepSel = state.selected && state.selected.parent === state.cwd ? state.selected : null;
    setState({ view, selected: view === 'column' ? state.selected : keepSel, expanded: EMPTY });
    markSelection();
  }

  /* ---------- 提示 ---------- */
  let toastTimer = null;
  function toast(message, type = 'info', ms) {
    dom.toast.textContent = message;
    dom.toast.className = `toast${type === 'error' ? ' error' : ''}`;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(hideToast, ms ?? (type === 'error' ? 6000 : 3500));
  }

  function hideToast() {
    clearTimeout(toastTimer);
    dom.toast.classList.add('hidden');
  }

  function rerenderAll() {
    renderSidebar();
    renderChrome();
    renderContent();
  }
  GF.i18n.onChange(rerenderAll);

  GF.app = Object.freeze({
    get state() { return state; },
    effectiveView, navList, itemFilter, selectedNodes, setState, select, toggleSelect, rangeSelect, selectAll, setPicked,
    navigate, toggleOverview, openNode, openQuickLook, toggleExpand, setView, goBack, goForward, goUp, goHome,
    openRepo, openFromInput, openRecent, reloadRepo, findRecent, removeRecent, moveRecent, getRecents,
    renderSidebar, renderContent, renderChrome, toast, dom, persistLater,
    gridCols: () => (vview.layout ? vview.layout.cols : 1), virtualRects: () => vview.rects(), relayout: () => vview.relayout(),
  });
})(window.GF);
