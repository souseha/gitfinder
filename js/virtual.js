/*
 * 虛擬捲動：圖像 / 列表檢視只畫出看得到的列（加上下緩衝），其餘用 padding 撐出捲軸高度。
 * 版面計算全是純函式（可單元測試）；controller 負責捲動、縮放時更新畫面，
 * 並重複使用已經畫好的 DOM 元素，捲動時圖片不會重新載入。
 */
(function (GF) {
  'use strict';

  /* ---------- 版面常數（必須與 styles.css 一致） ---------- */
  const ICON = Object.freeze({ padX: 16, padY: 18, gapX: 4, gapY: 10, extraW: 22, labelH: 40, subH: 19 });
  const LIST = Object.freeze({ headH: 28, bodyPadTop: 4, bodyPadX: 8, rowH: 26, minWidth: 560, padBottom: 12 });
  const OVERSCAN = 4;

  /**
   * 圖像檢視版面：模擬 CSS repeat(auto-fill, minmax(iconSize + 22px, 1fr))
   * @param {{ width: number, count: number, iconSize: number, showPath: boolean }} p
   */
  function iconLayout({ width, count, iconSize, showPath }) {
    const minW = iconSize + ICON.extraW;
    const inner = Math.max(0, width - ICON.padX * 2);
    const cols = Math.max(1, Math.floor((inner + ICON.gapX) / (minW + ICON.gapX)));
    const colW = Math.max(minW, (inner - ICON.gapX * (cols - 1)) / cols);
    const itemH = iconSize + ICON.labelH + (showPath ? ICON.subH : 0);
    const rowH = itemH + ICON.gapY;
    const rows = Math.ceil(count / cols);
    return Object.freeze({
      kind: 'icon', count, cols, rows, colW, itemH, rowH,
      top: ICON.padY, left: ICON.padX, gapX: ICON.gapX, stickyTop: 0,
      height: rows ? ICON.padY * 2 + rows * rowH - ICON.gapY : 0,
    });
  }

  /** 列表檢視版面：一欄、固定列高，表頭固定在上方 */
  function listLayout({ width, count }) {
    const fullW = Math.max(width, LIST.minWidth);
    return Object.freeze({
      kind: 'list', count, cols: 1, rows: count, colW: fullW - LIST.bodyPadX * 2,
      itemH: LIST.rowH, rowH: LIST.rowH, top: LIST.headH + LIST.bodyPadTop, left: LIST.bodyPadX, gapX: 0,
      stickyTop: LIST.headH, height: LIST.headH + LIST.bodyPadTop + count * LIST.rowH + LIST.padBottom,
    });
  }

  /** 目前捲動位置應該畫出的列與項目範圍 [start, end) */
  function visibleRange(layout, scrollTop, viewportH, overscan = OVERSCAN) {
    if (!layout.rows) return Object.freeze({ startRow: 0, endRow: 0, start: 0, end: 0 });
    const first = Math.floor((scrollTop - layout.top) / layout.rowH);
    const last = Math.ceil((scrollTop + viewportH - layout.top) / layout.rowH);
    const startRow = Math.min(layout.rows, Math.max(0, first - overscan));
    const endRow = Math.min(layout.rows, Math.max(startRow, last + overscan));
    return Object.freeze({
      startRow, endRow, start: startRow * layout.cols, end: Math.min(layout.count, endRow * layout.cols),
    });
  }

  /** 第 i 個項目在捲動內容中的位置（框選、捲到可見範圍時使用） */
  function itemRect(layout, i) {
    const row = Math.floor(i / layout.cols);
    const col = i % layout.cols;
    const left = layout.left + col * (layout.colW + layout.gapX);
    const top = layout.top + row * layout.rowH;
    return { left, top, right: left + layout.colW, bottom: top + layout.itemH };
  }

  /** 讓第 i 個項目完整出現在畫面中所需的 scrollTop；已經可見則回傳原值 */
  function scrollToReveal(layout, i, scrollTop, viewportH) {
    const r = itemRect(layout, i);
    const margin = 6;
    if (r.top - margin < scrollTop + layout.stickyTop) return Math.max(0, r.top - layout.stickyTop - margin);
    if (r.bottom + margin > scrollTop + viewportH) return r.bottom + margin - viewportH;
    return scrollTop;
  }

  /**
   * 控制器：掛在捲動容器上，資料或捲動位置改變時只更新可見的部分
   * @param {HTMLElement} scroller
   */
  function createController(scroller) {
    let cfg = null; // { getLayout, keyAt, build, decorate, body, applyRange }
    let layout = null;
    let lastRange = null;
    let elements = new Map(); // key -> element（只保留目前畫出來的）
    let raf = 0;

    function paint(force) {
      if (!cfg) return;
      const range = visibleRange(layout, scroller.scrollTop, scroller.clientHeight);
      if (!force && lastRange && range.start === lastRange.start && range.end === lastRange.end) return;
      lastRange = range;
      const next = new Map();
      const nodes = [];
      for (let i = range.start; i < range.end; i += 1) {
        const key = cfg.keyAt(i);
        const el = (!force && elements.get(key)) || cfg.build(i);
        cfg.decorate(el, i);
        next.set(key, el);
        nodes.push(el);
      }
      elements = next;
      cfg.applyRange(layout, range);
      cfg.body.replaceChildren(...nodes);
    }

    function relayout() {
      if (!cfg) return;
      layout = cfg.getLayout(scroller.clientWidth);
      paint(true);
    }

    /** 換資料（換資料夾、搜尋、檢視）時呼叫：所有元素重建 */
    function mount(config) {
      cfg = config;
      elements = new Map();
      lastRange = null;
      relayout();
    }

    function unmount() {
      cfg = null;
      layout = null;
      elements = new Map();
    }

    /** 只更新選取樣式等裝飾，不重建元素 */
    function redecorate() {
      if (!cfg || !lastRange) return;
      for (let i = lastRange.start; i < lastRange.end; i += 1) {
        const el = elements.get(cfg.keyAt(i));
        if (el) cfg.decorate(el, i);
      }
    }

    function reveal(i) {
      if (!cfg || i < 0) return;
      const top = scrollToReveal(layout, i, scroller.scrollTop, scroller.clientHeight);
      if (top !== scroller.scrollTop) scroller.scrollTop = top;
      paint(false);
    }

    /** 所有項目的位置（給框選用），以 key 標示 */
    function rects() {
      if (!cfg) return [];
      return Array.from({ length: layout.count }, (_, i) => ({ path: cfg.keyAt(i), ...itemRect(layout, i) }));
    }

    scroller.addEventListener('scroll', () => {
      if (!cfg || raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        paint(false);
      });
    }, { passive: true });

    if (typeof ResizeObserver === 'function') new ResizeObserver(() => relayout()).observe(scroller);

    return Object.freeze({
      mount, unmount, relayout, redecorate, reveal, rects,
      paintNow: () => paint(false),
      get active() { return !!cfg; },
      get layout() { return layout; },
    });
  }

  GF.virtual = Object.freeze({ ICON, LIST, iconLayout, listLayout, visibleRange, itemRect, scrollToReveal, createController });
})((window.GF = window.GF || {}));
