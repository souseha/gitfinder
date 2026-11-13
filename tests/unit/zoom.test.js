import { beforeAll, describe, expect, it } from 'vitest';
import { loadScripts } from '../helpers/load.js';

let Z;
beforeAll(() => {
  Z = loadScripts('zoom').zoom;
});

// 圖片以「塞進畫面」的大小置中顯示：版面框 400×300，可視區域 800×600
const BOX = { width: 400, height: 300 };
const VIEW = { width: 800, height: 600 };

describe('zoomAt', () => {
  it('keeps the point under the cursor still', () => {
    const start = Z.IDENTITY;
    // 游標在圖片中心右上方 (100, -50) 的位置
    const cursor = { x: 100, y: -50 };
    // 3 倍時圖片（1200×900）超出可視區域，位置不會被邊界拉回
    const next = Z.zoomAt(start, 3, cursor, BOX, VIEW);
    // 縮放前游標下的圖片座標 = cursor / scale；縮放後要落在同一個螢幕位置
    const before = { x: (cursor.x - start.x) / start.scale, y: (cursor.y - start.y) / start.scale };
    const after = { x: (cursor.x - next.x) / next.scale, y: (cursor.y - next.y) / next.scale };
    expect(next.scale).toBe(3);
    expect(after.x).toBeCloseTo(before.x);
    expect(after.y).toBeCloseTo(before.y);
  });

  it('stays between 1x and 8x', () => {
    expect(Z.zoomAt(Z.IDENTITY, 0.5, { x: 0, y: 0 }, BOX, VIEW).scale).toBe(Z.MIN_SCALE);
    expect(Z.zoomAt({ scale: 6, x: 0, y: 0 }, 2, { x: 0, y: 0 }, BOX, VIEW).scale).toBe(Z.MAX_SCALE);
    expect(Z.MIN_SCALE).toBe(1);
    expect(Z.MAX_SCALE).toBe(8);
  });

  it('returns to the centered fit when zoomed back out to 1x', () => {
    const zoomed = Z.zoomAt(Z.IDENTITY, 3, { x: 150, y: 100 }, BOX, VIEW);
    expect(Z.zoomAt(zoomed, 1 / 3, { x: -20, y: 40 }, BOX, VIEW)).toEqual(Z.IDENTITY);
  });
});

describe('panBy', () => {
  it('cannot move an image that still fits on screen', () => {
    expect(Z.panBy({ scale: 1.5, x: 0, y: 0 }, 200, 100, BOX, VIEW)).toEqual({ scale: 1.5, x: 0, y: 0 });
  });

  it('stops when an edge of the zoomed image reaches the edge of the view', () => {
    // 4 倍：1600×1200，比可視區域多出 800×600，所以最多各偏移一半
    const zoomed = { scale: 4, x: 0, y: 0 };
    expect(Z.panBy(zoomed, 10_000, -10_000, BOX, VIEW)).toEqual({ scale: 4, x: 400, y: -300 });
    expect(Z.panBy(zoomed, 30, 20, BOX, VIEW)).toEqual({ scale: 4, x: 30, y: 20 });
  });
});

describe('step factor and transform', () => {
  it('zooms 1.2x per mouse-wheel notch (about 100px), in both directions', () => {
    expect(Z.wheelFactor(-100)).toBeCloseTo(Z.WHEEL_STEP);
    expect(Z.wheelFactor(100)).toBeCloseTo(1 / Z.WHEEL_STEP);
    expect(Z.WHEEL_STEP).toBeCloseTo(1.2);
  });

  it('zooms only a little for the small deltas a trackpad sends', () => {
    const factor = Z.wheelFactor(-4);
    expect(factor).toBeGreaterThan(1);
    expect(factor).toBeLessThan(1.01);
  });

  it('treats line-based deltas like pixels and caps one huge event', () => {
    expect(Z.wheelFactor(-3, 1)).toBeCloseTo(Z.wheelFactor(-3 * Z.LINE_HEIGHT));
    expect(Z.wheelFactor(-10_000)).toBeCloseTo(Z.MAX_WHEEL_FACTOR);
  });

  it('builds a CSS transform, and none at the fitted size', () => {
    expect(Z.toCss({ scale: 2, x: 12.5, y: -3 })).toBe('translate(12.5px, -3px) scale(2)');
    expect(Z.toCss(Z.IDENTITY)).toBe('');
    expect(Z.percent({ scale: 2.5, x: 0, y: 0 })).toBe('250%');
  });
});
