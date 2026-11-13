/*
 * 快速查看的縮放互動：滾輪以游標為中心縮放、放大後拖曳、雙擊或按鈕回到原本大小。
 * 前後比較時，兩張圖原始尺寸相同就共用同一個縮放狀態（一起放大、一起移動，方便對照同一個位置）；
 * 尺寸不同（例如 atlas 重新打包）時同一個位置對到的是不同內容，改成各自縮放。數學在 zoom.js。
 */
(function (GF) {
  'use strict';

  const Z = GF.zoom;
  const $ = (id) => document.getElementById(id);
  const el = { stage: $('ql-stage'), label: $('ql-zoom'), reset: $('ql-zoom-reset') };

  let targets = [];
  /** 每張圖的縮放狀態；同步時所有圖寫入同一個值 */
  let states = new Map();
  /** 兩張圖尺寸相同（或還沒載入完、還不知道）時同步 */
  let linked = true;
  /** 倍率顯示跟著最後操作的那張圖 */
  let active = null;
  let drag = null;
  let suppressClick = false;

  const stateOf = (img) => states.get(img) || Z.IDENTITY;
  const isZoomed = () => targets.some((img) => !Z.isIdentity(stateOf(img)));

  function apply() {
    targets.forEach((img) => { img.style.transform = Z.toCss(stateOf(img)); });
    el.label.textContent = Z.percent(active ? stateOf(active) : Z.IDENTITY);
    el.stage.classList.toggle('is-zoomed', isZoomed());
  }

  function update(img, next) {
    const nextStates = new Map(states);
    (linked ? targets : [img]).forEach((t) => nextStates.set(t, next));
    states = nextStates;
    active = img;
    apply();
  }

  const whenLoaded = (imgs) =>
    Promise.all(imgs.map((img) => (img.complete && img.naturalWidth
      ? Promise.resolve()
      : new Promise((resolve) => {
        img.addEventListener('load', resolve, { once: true });
        img.addEventListener('error', resolve, { once: true });
      }))));

  const sameSize = (imgs) => imgs.every((img) => img.naturalWidth === imgs[0].naturalWidth && img.naturalHeight === imgs[0].naturalHeight);

  /** 換成新的圖片（單張或前後兩張）時重設縮放；空陣列表示目前不是圖片 */
  function setTargets(imgs) {
    targets = imgs;
    states = new Map();
    linked = true;
    active = imgs[imgs.length - 1] || null;
    el.label.hidden = el.reset.hidden = imgs.length === 0;
    apply();
    if (imgs.length > 1) {
      whenLoaded(imgs).then(() => {
        if (targets === imgs) linked = sameSize(imgs);
      });
    }
  }

  const clear = () => setTargets([]);

  function reset() {
    if (!targets.length) return;
    states = new Map();
    apply();
  }

  /** 以某張圖為準：未縮放時的版面大小、可視區域（單張是 stage，前後比較是各自的 figure）與中心 */
  function geometry(img) {
    const rect = img.getBoundingClientRect();
    const view = img.parentElement === el.stage ? el.stage : img.parentElement;
    return {
      box: { width: img.offsetWidth, height: img.offsetHeight },
      view: { width: view.clientWidth, height: view.clientHeight },
      center: { x: rect.left + rect.width / 2 - stateOf(img).x, y: rect.top + rect.height / 2 - stateOf(img).y },
    };
  }

  const targetFor = (e) => {
    const figure = e.target instanceof Element ? e.target.closest('figure') : null;
    return (figure && figure.querySelector('.ql-img')) || targets[targets.length - 1];
  };

  el.stage.addEventListener('wheel', (e) => {
    if (!targets.length) return;
    e.preventDefault();
    const img = targetFor(e);
    const g = geometry(img);
    const cursor = { x: e.clientX - g.center.x, y: e.clientY - g.center.y };
    update(img, Z.zoomAt(stateOf(img), Z.wheelFactor(e.deltaY, e.deltaMode), cursor, g.box, g.view));
  }, { passive: false });

  const isImage = (target) => target instanceof Element && target.classList.contains('ql-img');

  // 只有在放大後的圖片上按下才拖曳；點空白處照常交給燈箱（關閉）
  el.stage.addEventListener('pointerdown', (e) => {
    if (e.button !== 0 || !isImage(e.target) || Z.isIdentity(stateOf(e.target))) return;
    drag = { id: e.pointerId, img: e.target, x: e.clientX, y: e.clientY, g: geometry(e.target) };
    el.stage.setPointerCapture(e.pointerId);
    el.stage.classList.add('is-dragging');
    // 不呼叫 preventDefault：那會讓瀏覽器不送出 dblclick；圖片本身已設成不可拖曳、不可選取
  });

  el.stage.addEventListener('pointermove', (e) => {
    if (!drag || e.pointerId !== drag.id) return;
    const dx = e.clientX - drag.x;
    const dy = e.clientY - drag.y;
    drag = { ...drag, x: e.clientX, y: e.clientY };
    update(drag.img, Z.panBy(stateOf(drag.img), dx, dy, drag.g.box, drag.g.view));
  });

  function endDrag(e) {
    if (!drag || e.pointerId !== drag.id) return;
    // 按下時指標被捕捉到 stage，接下來的 click 目標會是 stage，看起來像「點背景」，一律攔下
    suppressClick = true;
    drag = null;
    el.stage.classList.remove('is-dragging');
  }
  el.stage.addEventListener('pointerup', endDrag);
  el.stage.addEventListener('pointercancel', endDrag);

  // 在圖片上按下後放開的 click 先攔下來，避免被當成點背景而關閉燈箱
  el.stage.addEventListener('click', (e) => {
    if (!suppressClick) return;
    suppressClick = false;
    e.stopImmediatePropagation();
  }, true);

  // 放大後按下滑鼠會把指標捕捉到 stage，雙擊的目標因此是 stage 而不是圖片，所以在整個區域雙擊都算
  el.stage.addEventListener('dblclick', reset);
  el.reset.addEventListener('click', reset);

  GF.qlZoom = Object.freeze({ setTargets, clear, reset, isZoomed });
})(window.GF);
