/* 設定對話框：外觀主題、語言、GitHub Token */
(function (GF) {
  'use strict';

  const { store, KEYS } = GF.util;
  const { t, setLang, getLang, LANGS } = GF.i18n;
  const A = GF.app;

  const THEMES = ['system', 'light', 'dark'];
  const $ = (id) => document.getElementById(id);
  const el = {
    open: $('btn-settings'), dialog: $('settings'), themeSeg: $('theme-seg'), lang: $('lang-select'),
    token: $('token-input'), tokenClear: $('token-clear'),
  };

  function applyTheme(theme) {
    const value = THEMES.includes(theme) ? theme : 'system';
    if (value === 'system') delete document.documentElement.dataset.theme;
    else document.documentElement.dataset.theme = value;
    el.themeSeg.querySelectorAll('[data-theme-opt]').forEach((b) => b.classList.toggle('active', b.dataset.themeOpt === value));
    return value;
  }

  el.lang.innerHTML = Object.entries(LANGS).map(([code, label]) => `<option value="${code}">${label}</option>`).join('');

  el.open.addEventListener('click', () => {
    applyTheme(store.get(KEYS.theme, 'system'));
    el.lang.value = getLang();
    el.token.value = store.get(KEYS.token, '');
    el.dialog.showModal();
  });

  el.themeSeg.addEventListener('click', (e) => {
    const btn = e.target.closest('[data-theme-opt]');
    if (btn) store.set(KEYS.theme, applyTheme(btn.dataset.themeOpt));
  });

  el.lang.addEventListener('change', () => setLang(el.lang.value));

  el.tokenClear.addEventListener('click', () => {
    el.token.value = '';
    store.remove(KEYS.token);
    A.toast(t('toast.tokenCleared'));
  });

  el.dialog.addEventListener('close', () => {
    if (el.dialog.returnValue === 'save') {
      const token = el.token.value.trim();
      const before = store.get(KEYS.token, '');
      if (token !== before) {
        if (token) store.set(KEYS.token, token);
        else store.remove(KEYS.token);
        A.toast(t(token ? 'toast.tokenSaved' : 'toast.tokenCleared'));
      }
    }
    el.token.value = '';
  });

  applyTheme(store.get(KEYS.theme, 'system'));
})(window.GF);
