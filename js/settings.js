/* 設定對話框：外觀主題、語言、GitHub Token（全部立即生效，只有「完成」按鈕） */
(function (GF) {
  'use strict';

  const { store, KEYS } = GF.util;
  const { t, setLang, getLang, LANGS } = GF.i18n;
  const A = GF.app;

  const THEMES = ['system', 'light', 'dark'];
  const $ = (id) => document.getElementById(id);
  const el = {
    open: $('btn-settings'), dialog: $('settings'), themeSeg: $('theme-seg'), lang: $('lang-select'),
    token: $('token-input'), tokenSave: $('token-save'), tokenClear: $('token-clear'),
    status: $('token-status'), statusText: $('token-status-text'), left: $('token-left'),
  };

  function applyTheme(theme) {
    const value = THEMES.includes(theme) ? theme : 'system';
    if (value === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    el.themeSeg.querySelectorAll('[data-theme-opt]').forEach((b) => b.classList.toggle('active', b.dataset.themeOpt === value));
    return value;
  }

  el.lang.innerHTML = Object.entries(LANGS).map(([code, label]) => `<option value="${code}">${label}</option>`).join('');

  /** @param {{ focusToken?: boolean }} [opts] focusToken：從 API 額度打開時直接聚焦 Token 欄位 */
  function open({ focusToken = false } = {}) {
    applyTheme(store.get(KEYS.theme, 'system'));
    el.lang.value = getLang();
    el.token.value = '';
    renderTokenStatus();
    el.dialog.showModal();
    if (focusToken) el.token.focus();
  }

  el.open.addEventListener('click', () => open());
  $('rate').addEventListener('click', () => open({ focusToken: true }));

  el.themeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme-opt]');
    if (btn) store.set(KEYS.theme, applyTheme(btn.dataset.themeOpt));
  });

  el.lang.addEventListener('change', () => {
    setLang(el.lang.value);
    renderTokenStatus();
  });

  /** Token 區的狀態列：有沒有設定、每小時上限、這小時還剩多少 */
  function renderTokenStatus() {
    const hasToken = !!store.get(KEYS.token, '');
    const rate = GF.github.getRate();
    el.status.classList.toggle('is-set', hasToken);
    el.statusText.textContent = t(hasToken ? 'token.statusSet' : 'token.statusNone');
    el.left.textContent = rate ? t('token.left', { n: rate.remaining }) : '';
    el.tokenClear.hidden = !hasToken;
  }

  async function saveToken() {
    const token = el.token.value.trim();
    if (!token) return;
    store.set(KEYS.token, token);
    GF.github.forgetRate();
    await GF.apiCache.clear();
    el.token.value = '';
    renderTokenStatus();
    A.toast(t('toast.tokenSaved'));
    // 能不能看私人倉庫跟著 token 變：目前開著的倉庫重新載入
    A.reloadRepo();
  }

  el.tokenSave.addEventListener('click', saveToken);
  // Enter 只儲存 Token，不送出表單（送出會關閉設定）
  el.token.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    saveToken();
  });

  el.tokenClear.addEventListener('click', async () => {
    el.token.value = '';
    store.remove(KEYS.token);
    GF.github.forgetRate();
    await GF.apiCache.clear();
    renderTokenStatus();
    A.toast(t('toast.tokenCleared'));
    A.reloadRepo();
  });

  el.dialog.addEventListener('close', () => {
    el.token.value = '';
  });

  applyTheme(store.get(KEYS.theme, 'system'));
})(window.GF);
