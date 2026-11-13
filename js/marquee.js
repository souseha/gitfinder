/*
 * 框選：在空白處拖曳出選取框；按住 ⌘/Ctrl 或 Shift 時加入既有選取。
 * 圖像 / 列表在整個內容區框選；直欄則在按下的那一欄內框選（與 Finder 相同）。
 */
(function (GF) {
  'use strict';

  const A = GF.app;
  const content = A.dom.content;
  const MIN_DRAG = 4;
  const EDGE = 36; // 靠近上下邊緣時自動捲動的範圍
  const MAX_SPEED = 18;

  let drag = null;
  let justDragged = false;

  /** 轉成 container 的捲動內容座標 */
  function toLocal(container, x, y) {
    const r = container.getBoundingClientRect();
    return { x: x - r.left + container.scrollLeft, y: y - r.top + container.scrollTop };
  }

  /**
   * 拖曳開始時記錄每個項目的位置，拖曳過程只做矩形比對。
   * 圖像 / 列表是虛擬捲動，畫面外的項目沒有 DOM，所以改用版面計算出的位置。
   */
  function snapshotItems(container) {
    if (container === content) return A.virtualRects();
    const r = container.getBoundingClientRect();
    return [...container.querySelectorAll('[data-path]')].map((el) => {
      const b = el.getBoundingClientRect();
      const left = b.left - r.left + container.scrollLeft;
      const top = b.top - r.top + container.scrollTop;
      return { path: el.dataset.path, left, top, right: left + b.width, bottom: top + b.height };
    });
  }

  function startVisual() {
    drag.active = true;
    drag.el = document.createElement('div');
    drag.el.className = 'marquee';
    drag.container.appendChild(drag.el);
    document.body.classList.add('dragging');
  }

  function update() {
    if (!drag) return;
    const p = toLocal(drag.container, drag.clientX, drag.clientY);
    const box = {
      left: Math.min(drag.start.x, p.x), top: Math.min(drag.start.y, p.y),
      right: Math.max(drag.start.x, p.x), bottom: Math.max(drag.start.y, p.y),
    };
    if (!drag.active && box.right - box.left < MIN_DRAG && box.bottom - box.top < MIN_DRAG) return;
    if (!drag.active) startVisual();
    Object.assign(drag.el.style, {
      left: `${box.left}px`, top: `${box.top}px`, width: `${box.right - box.left}px`, height: `${box.bottom - box.top}px`,
    });
    const hits = drag.items.filter((it) => it.left < box.right && it.right > box.left && it.top < box.bottom && it.bottom > box.top);
    const picked = new Set(drag.base);
    hits.forEach((it) => picked.add(it.path));
    const key = [...picked].join('\n');
    if (key === drag.lastKey) return;
    drag.lastKey = key;
    const focusPath = hits.length ? hits[hits.length - 1].path : null;
    A.setPicked(picked, focusPath ? A.state.tree.byPath.get(focusPath) : null);
  }

  function autoScroll() {
    if (!drag) return;
    const r = drag.container.getBoundingClientRect();
    let dy = 0;
    if (drag.clientY < r.top + EDGE) dy = -Math.ceil(((r.top + EDGE - drag.clientY) / EDGE) * MAX_SPEED);
    else if (drag.clientY > r.bottom - EDGE) dy = Math.ceil(((drag.clientY - (r.bottom - EDGE)) / EDGE) * MAX_SPEED);
    if (dy && drag.active) {
      drag.container.scrollTop += dy;
      update();
    }
    drag.raf = requestAnimationFrame(autoScroll);
  }

  function onMove(e) {
    if (!drag) return;
    drag.clientX = e.clientX;
    drag.clientY = e.clientY;
    update();
  }

  function onUp() {
    if (!drag) return;
    cancelAnimationFrame(drag.raf);
    justDragged = drag.active;
    const { column, active } = drag;
    if (drag.el) drag.el.remove();
    document.body.classList.remove('dragging');
    drag = null;
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onUp);
    // 直欄框選結束後要重繪，右側的預覽欄才會更新成「已選取 N 個項目」
    if (column && active) A.renderContent();
  }

  /** 決定這次拖曳的容器；回傳 null 代表不啟動框選 */
  function containerFor(target) {
    if (A.effectiveView() === 'column') return target.closest('.col[data-dir]');
    return content;
  }

  content.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !A.state.tree || e.pointerType === 'touch') return;
    if (e.target.closest('[data-path], .list-head, button, a, input')) return;
    const container = containerFor(e.target);
    if (!container) return;
    e.preventDefault(); // 避免拖曳時選到文字
    content.focus({ preventScroll: true });
    const additive = e.metaKey || e.ctrlKey || e.shiftKey;
    const items = snapshotItems(container);
    const inside = new Set(items.map((it) => it.path));
    // 直欄只能在同一欄內多選，加選時只保留這一欄原本的選取
    const base = !additive ? new Set() : new Set([...A.state.picked].filter((p) => container === content || inside.has(p)));
    drag = {
      container, column: container !== content,
      start: toLocal(container, e.clientX, e.clientY), clientX: e.clientX, clientY: e.clientY,
      base, items,
      active: false, el: null, lastKey: null,
    };
    justDragged = false;
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    drag.raf = requestAnimationFrame(autoScroll);
  });

  /** click 事件會在 pointerup 之後觸發；剛框選完就不要把選取清掉 */
  function consumeDrag() {
    const was = justDragged;
    justDragged = false;
    return was;
  }

  GF.marquee = Object.freeze({ consumeDrag });
})(window.GF);
