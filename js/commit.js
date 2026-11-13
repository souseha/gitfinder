/* 單一 commit 檢視：路徑列上方的 commit 資訊與狀態篩選按鈕 */
(function (GF) {
  'use strict';

  const { esc } = GF.util;
  const { t } = GF.i18n;

  // 改名併進「修改」，所以只有四顆
  const FILTERS = Object.freeze(['all', 'added', 'removed', 'modified']);
  const SHORT_SHA = 7;

  const shortSha = (sha) => String(sha || '').slice(0, SHORT_SHA);
  const firstLine = (message) => String(message || '').split('\n')[0];

  const countFor = (kind, counts) => {
    if (kind === 'all') return counts.added + counts.removed + counts.renamed + counts.modified;
    if (kind === 'modified') return counts.modified + counts.renamed;
    return counts[kind];
  };

  function filterButton(kind, counts, current) {
    const n = countFor(kind, counts);
    const label = kind === 'all' ? t('commit.all') : t(`chg.${kind}`);
    const cls = `chg-filter${kind === current ? ' on' : ''}${kind === 'all' ? '' : ` chg-filter-${kind}`}`;
    return `<button type="button" class="${cls}" data-change-filter="${kind}"${n ? '' : ' disabled'}>${esc(label)} <span class="n">${n}</span></button>`;
  }

  /** 「依資料夾 ｜ 全部攤平」二選一：怎麼看，和右邊的「看哪一種」分開 */
  function scopeSwitch(flat) {
    const btn = (scope, active) =>
      `<button type="button" data-scope="${scope}" aria-pressed="${active}"${active ? ' class="active"' : ''}>${esc(t(`commit.scope.${scope}`))}</button>`;
    return `<span class="seg seg-text commit-scope" role="group">${btn('folders', !flat)}${btn('flat', flat)}</span>`;
  }

  /** 依目前狀態畫出（或隱藏）commit 資訊列 */
  function render(state) {
    const bar = document.getElementById('commit-bar');
    if (!bar) return;
    const commit = state.repo && state.repo.commit;
    bar.classList.toggle('hidden', !commit);
    if (!commit) {
      bar.innerHTML = '';
      return;
    }
    const counts = commit.counts || { added: 0, removed: 0, renamed: 0, modified: 0 };
    bar.innerHTML =
      scopeSwitch(!!state.overview) +
      '<span class="commit-divider" aria-hidden="true"></span>' +
      `<a class="commit-sha" href="${esc(GF.github.webUrl(state.repo, null))}" target="_blank" rel="noopener noreferrer" ` +
      `data-tip="${esc(t('commit.openGh'))}" aria-label="${esc(t('commit.openGh'))}">${esc(shortSha(commit.sha))}</a>` +
      `<span class="commit-msg" title="${esc(commit.message)}">${esc(firstLine(commit.message))}</span>` +
      `<span class="commit-filters" role="group">${FILTERS.map((k) => filterButton(k, counts, state.changeFilter)).join('')}</span>`;
  }

  document.addEventListener('click', (e) => {
    const btn = e.target instanceof Element ? e.target.closest('#commit-bar button') : null;
    if (!btn || btn.disabled || !GF.app) return;
    const wantFlat = btn.dataset.scope === 'flat';
    if (btn.dataset.scope && wantFlat !== !!GF.app.state.overview) GF.app.toggleOverview();
    else if (btn.dataset.changeFilter) GF.app.setState({ changeFilter: btn.dataset.changeFilter, selected: null });
  });

  GF.commit = Object.freeze({ render, shortSha, FILTERS });
})(window.GF);
