import { beforeAll, describe, expect, it } from 'vitest';
import { loadCore } from '../helpers/load.js';

let VR;
beforeAll(() => {
  VR = loadCore().virtual;
});

describe('iconLayout', () => {
  it('fits as many columns as the width allows', () => {
    // 內寬 1000 - 32 = 968；每欄最小 112 + 22 = 134，加間距 4 → 7 欄
    const l = VR.iconLayout({ width: 1000, count: 100, iconSize: 112, showPath: false });
    expect(l.cols).toBe(7);
    expect(l.rows).toBe(15);
    expect(l.itemH).toBe(112 + 40);
    expect(l.height).toBe(18 * 2 + 15 * l.rowH - 10);
  });

  it('always keeps at least one column and adds room for the path line', () => {
    const l = VR.iconLayout({ width: 50, count: 3, iconSize: 112, showPath: true });
    expect(l.cols).toBe(1);
    expect(l.itemH).toBe(112 + 40 + 19);
  });

  it('has zero height when empty', () => {
    expect(VR.iconLayout({ width: 800, count: 0, iconSize: 112, showPath: false }).height).toBe(0);
  });
});

describe('listLayout', () => {
  it('uses fixed rows below a sticky header', () => {
    const l = VR.listLayout({ width: 400, count: 1000 });
    expect(l.colW).toBe(560 - 16); // 最小寬度 560
    expect(l.stickyTop).toBe(28);
    expect(l.height).toBe(28 + 4 + 1000 * 26 + 12);
  });
});

describe('visibleRange', () => {
  const list = () => VR.listLayout({ width: 800, count: 1000 });

  it('covers the viewport plus overscan at the top', () => {
    // 第一列在 32px；260px 高的畫面看得到到第 9 列，加 2 列緩衝 → 11
    expect(VR.visibleRange(list(), 0, 260, 2)).toMatchObject({ startRow: 0, start: 0, end: 11 });
  });

  it('slides with the scroll position', () => {
    const r = VR.visibleRange(list(), 32 + 500 * 26, 260, 2);
    expect(r.start).toBe(498);
    expect(r.end).toBe(512);
  });

  it('clamps at the end and handles partial last rows', () => {
    const icon = VR.iconLayout({ width: 1000, count: 100, iconSize: 112, showPath: false });
    const r = VR.visibleRange(icon, 1e9, 600);
    expect(r.endRow).toBe(icon.rows);
    expect(r.end).toBe(100);
  });

  it('is empty when there are no items', () => {
    expect(VR.visibleRange(VR.listLayout({ width: 800, count: 0 }), 0, 500)).toMatchObject({ start: 0, end: 0 });
  });
});

describe('itemRect / scrollToReveal', () => {
  it('places items on the grid', () => {
    const l = VR.iconLayout({ width: 1000, count: 100, iconSize: 112, showPath: false });
    const r = VR.itemRect(l, 8); // 第 2 列第 2 欄
    expect(r.left).toBeCloseTo(16 + (l.colW + 4));
    expect(r.top).toBe(18 + l.rowH);
    expect(r.bottom - r.top).toBe(l.itemH);
  });

  it('scrolls up past the sticky header, down to the bottom edge, or not at all', () => {
    const l = VR.listLayout({ width: 800, count: 1000 });
    expect(VR.scrollToReveal(l, 10, 5000, 300)).toBe(32 + 10 * 26 - 28 - 6);
    expect(VR.scrollToReveal(l, 500, 0, 300)).toBe(32 + 501 * 26 + 6 - 300);
    const visible = 32 + 100 * 26 - 100;
    expect(VR.scrollToReveal(l, 100, visible, 300)).toBe(visible);
  });
});

describe('createController', () => {
  function setup(count) {
    const scroller = document.createElement('div');
    Object.defineProperty(scroller, 'clientHeight', { value: 260 });
    Object.defineProperty(scroller, 'clientWidth', { value: 800 });
    const body = document.createElement('div');
    scroller.appendChild(body);
    const built = [];
    const ctrl = VR.createController(scroller);
    const selected = new Set();
    let padTop = null;
    ctrl.mount({
      body,
      getLayout: (width) => VR.listLayout({ width, count }),
      keyAt: (i) => `item-${i}`,
      build: (i) => {
        built.push(i);
        const el = document.createElement('div');
        el.dataset.path = `item-${i}`;
        return el;
      },
      decorate: (el, i) => el.classList.toggle('selected', selected.has(i)),
      applyRange: (layout, range) => { padTop = range.startRow * layout.rowH; },
    });
    return { scroller, body, built, ctrl, selected, padTop: () => padTop };
  }

  it('renders only the visible window', () => {
    const { body, ctrl } = setup(5000);
    expect(ctrl.active).toBe(true);
    expect(body.children.length).toBeLessThan(30);
    expect(body.firstElementChild.dataset.path).toBe('item-0');
  });

  it('reuses elements that stay visible after scrolling', () => {
    const { scroller, body, built, ctrl, padTop } = setup(5000);
    const kept = body.children[10];
    scroller.scrollTop = 26 * 10; // 可見從第 8 列開始，減 4 列緩衝 → 從第 4 列畫起
    ctrl.paintNow();
    expect([...body.children]).toContain(kept);
    expect(built.filter((i) => i === 10)).toHaveLength(1); // 沒有被重建
    expect(padTop()).toBe(4 * 26);
  });

  it('reveals far items and updates selection styles in place', () => {
    const { scroller, body, ctrl, selected } = setup(5000);
    ctrl.reveal(3000);
    expect(scroller.scrollTop).toBeGreaterThan(0);
    expect([...body.children].some((el) => el.dataset.path === 'item-3000')).toBe(true);
    selected.add(3000);
    ctrl.redecorate();
    expect(body.querySelector('[data-path="item-3000"]').classList.contains('selected')).toBe(true);
  });

  it('exposes every item position for marquee selection', () => {
    const { ctrl } = setup(50);
    const rects = ctrl.rects();
    expect(rects).toHaveLength(50);
    expect(rects[1].top - rects[0].top).toBe(26);
    ctrl.unmount();
    expect(ctrl.active).toBe(false);
    expect(ctrl.rects()).toEqual([]);
  });
});
