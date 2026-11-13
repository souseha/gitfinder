/* 快速查看燈箱：大圖 / 文字預覽 + 底部縮圖列 */
(function (GF) {
  'use strict';

  const { esc, isImage, isText, kindOf, formatSize, folderIcon, fileIcon } = GF.util;
  const { fileUrl, previousUrl, webUrl } = GF.github;
  const { thumbHtml } = GF.views;
  const { t } = GF.i18n;

  const MAX_TEXT_BYTES = 512 * 1024;
  const $ = (id) => document.getElementById(id);
  const el = {
    root: $('ql'), stage: $('ql-stage'), strip: $('ql-strip'), title: $('ql-title'),
    meta: $('ql-meta'), gh: $('ql-gh'), prev: $('ql-prev'), next: $('ql-next'), close: $('ql-close'),
  };

  let ctx = null; // { repo, list, index, onChange }
  let textAbort = null;
  const textCache = new Map();

  const isOpen = () => ctx !== null;

  function open(repo, list, index, onChange) {
    if (!list.length) return;
    ctx = Object.freeze({ repo, list, index: Math.min(Math.max(index, 0), list.length - 1), onChange });
    el.root.classList.remove('hidden');
    document.body.classList.add('ql-open');
    renderStrip();
    show();
  }

  function close() {
    if (textAbort) textAbort.abort();
    ctx = null;
    el.root.classList.add('hidden');
    document.body.classList.remove('ql-open');
    el.stage.innerHTML = '';
    el.strip.innerHTML = '';
  }

  function go(index) {
    if (!ctx) return;
    const next = Math.min(Math.max(index, 0), ctx.list.length - 1);
    if (next === ctx.index) return;
    ctx = Object.freeze({ ...ctx, index: next });
    show();
    ctx.onChange(ctx.list[next]);
  }

  const step = (delta) => ctx && go(ctx.index + delta);

  function renderStrip() {
    if (ctx.list.length < 2) {
      el.strip.innerHTML = '';
      return;
    }
    el.strip.innerHTML = ctx.list
      .map((n, i) => `<button class="ql-thumb" type="button" data-i="${i}" data-tip="${esc(n.name)}">${thumbHtml(ctx.repo, n, 'strip')}</button>`)
      .join('');
  }

  function metaText(node, extra) {
    const parts = [kindOf(node)];
    if (node.type === 'file') parts.push(formatSize(node.size));
    if (extra) parts.push(extra);
    if (ctx.list.length > 1) parts.push(`${ctx.index + 1} / ${ctx.list.length}`);
    return parts.join(' · ');
  }

  function makeImage(node, src) {
    const img = new Image();
    img.className = 'ql-img';
    img.alt = node.name;
    img.draggable = false;
    img.dataset.ext = node.label;
    img.src = src;
    return img;
  }

  /** commit 裡修改 / 改名的圖：左邊上一版、右邊這一版 */
  function compareSide(img, side) {
    img.dataset.side = side;
    const fig = document.createElement('figure');
    const cap = document.createElement('figcaption');
    cap.textContent = t(`ql.${side}`);
    fig.append(img, cap);
    return fig;
  }

  function showImage(node) {
    const img = makeImage(node, fileUrl(ctx.repo, node));
    img.onload = () => {
      if (ctx && ctx.list[ctx.index] === node) el.meta.textContent = metaText(node, `${img.naturalWidth} × ${img.naturalHeight}`);
    };
    const before = previousUrl(ctx.repo, node);
    if (!before) {
      el.stage.replaceChildren(img);
      return;
    }
    const wrap = document.createElement('div');
    wrap.className = 'ql-compare';
    wrap.append(compareSide(makeImage(node, before), 'before'), compareSide(img, 'after'));
    el.stage.replaceChildren(wrap);
  }

  async function showText(node) {
    const pre = document.createElement('pre');
    pre.className = 'ql-text';
    el.stage.replaceChildren(pre);
    if (node.size > MAX_TEXT_BYTES) {
      pre.textContent = t('ql.tooBig', { size: formatSize(node.size) });
      return;
    }
    const url = fileUrl(ctx.repo, node);
    if (textCache.has(url)) {
      pre.textContent = textCache.get(url);
      return;
    }
    pre.textContent = t('ql.loading');
    textAbort = new AbortController();
    try {
      const res = await fetch(url, { signal: textAbort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      textCache.set(url, text);
      pre.textContent = text;
    } catch (err) {
      if (err.name !== 'AbortError') pre.textContent = t('ql.loadFail', { msg: err.message });
    }
  }

  function showOther(node) {
    const icon = node.type === 'dir' ? folderIcon() : fileIcon(node.label);
    const msg = node.type === 'dir' ? t('count.items', { n: node.children.length }) : t('ql.noPreview');
    el.stage.innerHTML = `<div class="ql-other">${icon}<div>${esc(msg)}</div></div>`;
  }

  function preloadNeighbors() {
    [ctx.index - 1, ctx.index + 1].forEach((i) => {
      const n = ctx.list[i];
      if (isImage(n)) new Image().src = fileUrl(ctx.repo, n);
    });
  }

  function show() {
    const node = ctx.list[ctx.index];
    if (textAbort) textAbort.abort();
    el.stage.classList.remove('zoom');
    el.title.textContent = node.name;
    el.meta.textContent = metaText(node);
    el.gh.href = webUrl(ctx.repo, node);
    el.prev.disabled = ctx.index === 0;
    el.next.disabled = ctx.index === ctx.list.length - 1;
    el.prev.hidden = el.next.hidden = ctx.list.length < 2;

    if (isImage(node)) showImage(node);
    else if (isText(node)) showText(node);
    else showOther(node);

    const prevActive = el.strip.querySelector('.ql-thumb.active');
    if (prevActive) prevActive.classList.remove('active');
    const active = el.strip.querySelector(`[data-i="${ctx.index}"]`);
    if (active) {
      active.classList.add('active');
      active.scrollIntoView({ inline: 'center', block: 'nearest', behavior: 'smooth' });
    }
    preloadNeighbors();
  }

  el.close.addEventListener('click', close);
  el.prev.addEventListener('click', () => step(-1));
  el.next.addEventListener('click', () => step(1));
  el.strip.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-i]');
    if (btn) go(Number(btn.dataset.i));
  });
  el.stage.addEventListener('click', (e) => {
    // 比較檢視有兩張圖，放大會讓兩張重疊，所以只在單張圖時切換
    if (e.target.classList.contains('ql-img') && !e.target.closest('.ql-compare')) el.stage.classList.toggle('zoom');
    else if (e.target === el.stage) close();
  });
  // 觸控滑動切換
  let touchX = null;
  el.stage.addEventListener('touchstart', (e) => { touchX = e.touches[0].clientX; }, { passive: true });
  el.stage.addEventListener('touchend', (e) => {
    if (touchX == null) return;
    const dx = e.changedTouches[0].clientX - touchX;
    touchX = null;
    if (Math.abs(dx) > 50) step(dx < 0 ? 1 : -1);
  });

  const current = () => (ctx ? ctx.list[ctx.index] : null);

  const nodeAt = (i) => (ctx ? ctx.list[i] || null : null);

  GF.quicklook = Object.freeze({ open, close, isOpen, step, current, nodeAt });
})(window.GF);
