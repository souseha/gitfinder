/* GitHub API：解析網址、抓取整棵檔案樹、組出 raw / 網頁連結 */
(function (GF) {
  'use strict';

  const { store, KEYS } = GF.util;
  const API = 'https://api.github.com';
  let rate = null;

  const safeDecode = (v) => {
    try {
      return decodeURIComponent(v);
    } catch {
      return v;
    }
  };

  const OWNER_RE = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?$/;
  const NAME_RE = /^[A-Za-z0-9._-]+$/;

  /**
   * 解析 GitHub 風格的路徑片段：owner/repo[/tree|blob/<ref 與路徑>]。
   * 分支名稱可能含「/」，無法只靠字串分辨哪段是分支、哪段是路徑，
   * 所以把 tree/blob 之後的整段放在 refPath，由 fetchRepo 實際查詢後再拆開。
   * @returns {{ owner: string, name: string, branch: null, path: '', refPath: string } | null}
   */
  function parseSegments(segments) {
    const parts = segments.filter(Boolean).map(safeDecode);
    if (parts.length < 2) return null;
    const [owner, rawName, kind, ...rest] = parts;
    const name = rawName.replace(/\.git$/i, '');
    if (!OWNER_RE.test(owner) || !NAME_RE.test(name)) return null;
    const deep = (kind === 'tree' || kind === 'blob') && rest.length > 0;
    return { owner, name, branch: null, path: '', refPath: deep ? rest.join('/') : '' };
  }

  /** 支援 owner/repo、github.com/owner/repo、/tree/<branch>/<path>、/blob/<branch>/<file> */
  function parseRepoInput(raw) {
    const s = String(raw || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
    if (!s) return null;
    const url = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i);
    return parseSegments((url ? url[1] : s).split('/'));
  }

  /** 解析 App 自己的網址路徑，例如 /owner/repo/tree/main/assets */
  const parseRoute = (pathname) => parseSegments(pathname.split('/'));

  function readRate(res) {
    const remaining = res.headers.get('x-ratelimit-remaining');
    if (remaining == null) return;
    rate = Object.freeze({
      remaining: Number(remaining),
      limit: Number(res.headers.get('x-ratelimit-limit')),
      reset: Number(res.headers.get('x-ratelimit-reset')),
    });
  }

  function errorFor(res) {
    const { t } = GF.i18n;
    if ((res.status === 403 || res.status === 429) && rate && rate.remaining === 0) {
      const time = new Date(rate.reset * 1000).toLocaleTimeString(GF.i18n.getLang(), { hour: '2-digit', minute: '2-digit' });
      return new Error(t('err.rate', { time }));
    }
    const withStatus = (msg) => Object.assign(new Error(msg), { status: res.status });
    if (res.status === 404) return withStatus(t('err.notFound'));
    if (res.status === 401) return withStatus(t('err.token'));
    if (res.status === 409) return withStatus(t('err.empty'));
    if (res.status >= 500) return withStatus(t('err.server', { status: res.status }));
    return withStatus(t('err.http', { status: res.status }));
  }

  /**
   * 超大倉庫第一次組 recursive tree 時，GitHub 約 10 秒就逾時回 500；
   * 組好後會快取，所以要多等幾次、間隔拉長，給 GitHub 時間完成。
   */
  const RETRY_DELAYS = [1000, 3000, 6000, 10000];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  /**
   * 5xx 為 GitHub 端錯誤，自動重試兩次。
   * 不送自訂 Accept header：實測超大倉庫（例如 3 萬個檔案）在瀏覽器帶 vnd.github+json 時
   * 會穩定拿到被快取的 500，不帶則正常。重試時加上時間戳，避開 CDN 快取住的錯誤回應。
   */
  /** @param {{ onRetry?: (attempt: number, total: number) => void }} [opts] */
  async function api(path, { onRetry } = {}) {
    const headers = {};
    const token = store.get(KEYS.token, '');
    if (token) headers.Authorization = `Bearer ${token}`;
    for (let attempt = 0; ; attempt += 1) {
      const sep = path.includes('?') ? '&' : '?';
      const url = attempt === 0 ? API + path : `${API}${path}${sep}_=${Date.now()}`;
      let res;
      try {
        res = await fetch(url, { headers, cache: attempt === 0 ? 'default' : 'reload' });
      } catch {
        throw new Error(GF.i18n.t('err.network'));
      }
      readRate(res);
      if (res.ok) return res.json();
      if (res.status >= 500 && attempt < RETRY_DELAYS.length) {
        if (onRetry) onRetry(attempt + 1, RETRY_DELAYS.length);
        await wait(RETRY_DELAYS[attempt]);
        continue;
      }
      throw errorFor(res);
    }
  }

  const MAX_REF_GUESSES = 6;

  const fetchTree = (base, ref, opts) => api(`${base}/git/trees/${encodeURIComponent(ref)}?recursive=1`, opts);

  /**
   * 把 refPath（例如 feature/icons/assets/logo）拆成分支與路徑：
   * 先比對預設分支，否則由短到長逐一嘗試，第一個存在的就是分支。
   */
  async function resolveRef(base, refPath, opts) {
    const info = await api(base);
    const def = info.default_branch;
    if (refPath === def || refPath.startsWith(`${def}/`)) {
      return { branch: def, path: refPath.slice(def.length + 1), tree: await fetchTree(base, def, opts) };
    }
    const parts = refPath.split('/');
    for (let i = 1; i <= Math.min(parts.length, MAX_REF_GUESSES); i += 1) {
      const ref = parts.slice(0, i).join('/');
      try {
        return { branch: ref, path: parts.slice(i).join('/'), tree: await fetchTree(base, ref, opts) };
      } catch (err) {
        if (err.status !== 404 && err.status !== 422) throw err;
      }
    }
    throw Object.assign(new Error(GF.i18n.t('err.notFound')), { status: 404 });
  }

  /** @returns {Promise<{ branch: string, path: string, entries: object[], truncated: boolean }>} */
  async function fetchRepo({ owner, name, branch, path = '', refPath = '' }, opts = {}) {
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    let result;
    if (branch) result = { branch, path, tree: await fetchTree(base, branch, opts) };
    else if (refPath) result = await resolveRef(base, refPath, opts);
    else {
      const def = (await api(base)).default_branch;
      result = { branch: def, path, tree: await fetchTree(base, def, opts) };
    }
    return {
      branch: result.branch,
      path: result.path,
      entries: Array.isArray(result.tree.tree) ? result.tree.tree : [],
      truncated: !!result.tree.truncated,
    };
  }

  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

  const rawUrl = (repo, path) =>
    `https://raw.githubusercontent.com/${encPath(repo.owner)}/${encPath(repo.name)}/${encPath(repo.branch)}/${encPath(path)}`;

  const THUMB_PROXY = 'https://wsrv.nl/';
  const SMALL_IMAGE_BYTES = 20 * 1024;
  const NO_PROXY_EXT = new Set(['svg', 'ico']);

  /**
   * 縮圖網址：透過 wsrv.nl 縮小並轉成 WebP，省流量。
   * SVG / ICO 與 20 KB 以下的小圖直接用原圖（代理反而多繞一趟）。
   * @param {number} size 縮圖最長邊（像素，已含 2x 高解析度）
   */
  function thumbUrl(repo, node, size) {
    const raw = rawUrl(repo, node.path);
    if (NO_PROXY_EXT.has(node.ext) || (node.size != null && node.size <= SMALL_IMAGE_BYTES)) return raw;
    const params = new URLSearchParams({ url: raw, w: String(size), h: String(size), fit: 'inside', output: 'webp' });
    if (node.ext === 'gif') params.set('n', '-1'); // 保留 GIF 動畫
    return `${THUMB_PROXY}?${params}&we`;
  }

  /** App 內的網址，與 GitHub 相同的結構：/owner/repo/tree/<branch>/<path> */
  function routeUrl(repo, path) {
    const base = `/${encPath(repo.owner)}/${encPath(repo.name)}`;
    if (!repo.branch) return base;
    return `${base}/tree/${encPath(repo.branch)}${path ? `/${encPath(path)}` : ''}`;
  }

  function webUrl(repo, node) {
    const base = `https://github.com/${encPath(repo.owner)}/${encPath(repo.name)}`;
    if (!node || !node.path) return `${base}/tree/${encPath(repo.branch)}`;
    const kind = node.type === 'dir' ? 'tree' : 'blob';
    return `${base}/${kind}/${encPath(repo.branch)}/${encPath(node.path)}`;
  }

  GF.github = Object.freeze({ parseRepoInput, parseRoute, routeUrl, fetchRepo, rawUrl, thumbUrl, webUrl, getRate: () => rate });
})(window.GF);
