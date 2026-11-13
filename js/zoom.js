/*
 * 快速查看的縮放與拖曳：純函式，不碰 DOM。
 * 狀態 { scale, x, y }：圖片以「塞進畫面」的大小置中顯示為 1 倍，
 * x / y 是相對置中位置的位移（像素），CSS 為 translate(x, y) scale(scale)，transform-origin 在圖片中心。
 */
(function (GF) {
  'use strict';

  const MIN_SCALE = 1;
  const MAX_SCALE = 8;
  /** 滑鼠滾輪一格（約 100px）的倍率；乘法，大圖小圖手感一致 */
  const WHEEL_STEP = 1.2;
  const PIXELS_PER_NOTCH = 100;
  /** deltaMode = 1（以行為單位）時，一行換算成的像素 */
  const LINE_HEIGHT = 40;
  /** 單一事件最多放大／縮小的倍率，避免某些裝置一次送來超大的 delta */
  const MAX_WHEEL_FACTOR = 2;
  const IDENTITY = Object.freeze({ scale: 1, x: 0, y: 0 });

  const clampScale = (s) => Math.min(Math.max(s, MIN_SCALE), MAX_SCALE);
  const noNegZero = (v) => v || 0;

  /** 放大後的圖片邊緣不能拖進可視區域：沒超出畫面的方向固定置中 */
  function clampPan({ scale, x, y }, box, view) {
    const maxX = Math.max(0, (box.width * scale - view.width) / 2);
    const maxY = Math.max(0, (box.height * scale - view.height) / 2);
    return Object.freeze({
      scale,
      x: noNegZero(Math.min(Math.max(x, -maxX), maxX)),
      y: noNegZero(Math.min(Math.max(y, -maxY), maxY)),
    });
  }

  /**
   * 以游標為中心縮放：游標底下的那一點縮放前後停在同一個螢幕位置。
   * @param {{x:number,y:number}} cursor 游標相對於可視區域中心的位置
   */
  function zoomAt(state, factor, cursor, box, view) {
    const scale = clampScale(state.scale * factor);
    if (scale === MIN_SCALE) return IDENTITY;
    const k = scale / state.scale;
    return clampPan({ scale, x: cursor.x * (1 - k) + k * state.x, y: cursor.y * (1 - k) + k * state.y }, box, view);
  }

  const panBy = (state, dx, dy, box, view) => clampPan({ ...state, x: state.x + dx, y: state.y + dy }, box, view);

  /**
   * 倍率跟滾動量成正比：滑鼠一格 1.2 倍，觸控板一連串的小 delta 則各自只放大一點點，
   * 不會因為事件多就放大得飛快。deltaY < 0（往上滾）放大，> 0 縮小。
   */
  function wheelFactor(deltaY, deltaMode = 0) {
    const pixels = deltaMode === 1 ? deltaY * LINE_HEIGHT : deltaY;
    const factor = WHEEL_STEP ** (-pixels / PIXELS_PER_NOTCH);
    return Math.min(Math.max(factor, 1 / MAX_WHEEL_FACTOR), MAX_WHEEL_FACTOR);
  }

  const isIdentity = (s) => s.scale === 1 && s.x === 0 && s.y === 0;
  const toCss = (s) => (isIdentity(s) ? '' : `translate(${s.x}px, ${s.y}px) scale(${s.scale})`);
  const percent = (s) => `${Math.round(s.scale * 100)}%`;

  GF.zoom = Object.freeze({ MIN_SCALE, MAX_SCALE, WHEEL_STEP, LINE_HEIGHT, MAX_WHEEL_FACTOR, IDENTITY, zoomAt, panBy, clampPan, wheelFactor, isIdentity, toCss, percent });
})((window.GF = window.GF || {}));
