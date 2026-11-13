/* 快速 tooltip：取代瀏覽器原生 title（原生要等 1 秒以上） */
(function (GF) {
  'use strict';

  const SHOW_DELAY = 350;
  const WARM_WINDOW = 600; // 剛關掉另一個 tooltip 的短時間內，移到下一個按鈕立即顯示
  const GAP = 8;

  const tip = document.createElement('div');
  tip.className = 'tooltip';
  tip.setAttribute('role', 'tooltip');
  document.body.appendChild(tip);

  let target = null;
  let timer = null;
  let lastHidden = 0;

  function place(el) {
    tip.textContent = el.dataset.tip;
    tip.classList.add('show');
    const r = el.getBoundingClientRect();
    const tr = tip.getBoundingClientRect();
    let top = r.bottom + GAP;
    if (top + tr.height > window.innerHeight - 4) top = r.top - tr.height - GAP;
    const left = Math.min(Math.max(4, r.left + r.width / 2 - tr.width / 2), window.innerWidth - tr.width - 4);
    tip.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`;
  }

  function hide() {
    clearTimeout(timer);
    if (tip.classList.contains('show')) lastHidden = Date.now();
    tip.classList.remove('show');
    target = null;
  }

  document.addEventListener('mouseover', (e) => {
    const el = e.target instanceof Element ? e.target.closest('[data-tip]') : null;
    if (el === target) return;
    hide();
    if (!el || !el.dataset.tip) return;
    target = el;
    const delay = Date.now() - lastHidden < WARM_WINDOW ? 0 : SHOW_DELAY;
    timer = setTimeout(() => target === el && el.isConnected && place(el), delay);
  });

  ['pointerdown', 'keydown', 'wheel', 'blur'].forEach((type) => window.addEventListener(type, hide, true));
  document.addEventListener('mouseleave', hide);

  GF.tooltip = Object.freeze({ hide });
})(window.GF);
