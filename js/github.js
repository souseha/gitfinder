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
  const SHA_RE = /^[0-9a-f]{7,40}$/i;

  /** commit/<sha>：sha 可帶 GitHub 的 .patch / .diff 結尾；不是 sha 就回傳 null */
  function commitSha(segment) {
    const sha = String(segment || '').replace(/\.(patch|diff)$/i, '');
    return SHA_RE.test(sha) ? sha.toLowerCase() : null;
  }

  const PULL_NUMBER_RE = /^[1-9][0-9]*$/;
  /** GitHub PR 頁面的分頁（/pull/12/files 等），不是倉庫裡的路徑 */
  const PULL_TABS = new Set(['files', 'commits', 'checks', 'changes']);

  /** pull/<number>[/<路徑>]：GitHub 網址的分頁名稱丟掉，App 自己的網址則一律當路徑 */
  function parsePull(rest, isGitHubUrl) {
    if (!PULL_NUMBER_RE.test(rest[0] || '')) return null;
    const after = rest.slice(1);
    const path = isGitHubUrl && PULL_TABS.has(after[0]) ? '' : after.join('/');
    return { pull: Number(rest[0]), path };
  }

  /**
   * 解析 GitHub 風格的路徑片段：owner/repo[/tree|blob/<ref 與路徑>]。
   * 分支名稱可能含「/」，無法只靠字串分辨哪段是分支、哪段是路徑，
   * 所以把 tree/blob 之後的整段放在 refPath，由 fetchRepo 實際查詢後再拆開。
   * @param {string[]} segments
   * @param {{ isGitHubUrl?: boolean }} [opts] 使用者貼上的 GitHub 網址（PR 分頁名稱要丟掉）
   * @returns {{ owner: string, name: string, branch: null, path: string, refPath: string, commit?: string, pull?: number } | null}
   */
  function parseSegments(segments, { isGitHubUrl = false } = {}) {
    const parts = segments.filter(Boolean).map(safeDecode);
    if (parts.length < 2) return null;
    const [owner, rawName, kind, ...rest] = parts;
    const name = rawName.replace(/\.git$/i, '');
    if (!OWNER_RE.test(owner) || !NAME_RE.test(name)) return null;
    const commit = kind === 'commit' ? commitSha(rest[0]) : null;
    if (commit) return { owner, name, branch: null, path: rest.slice(1).join('/'), refPath: '', commit };
    const pull = kind === 'pull' ? parsePull(rest, isGitHubUrl) : null;
    if (pull) return { owner, name, branch: null, path: pull.path, refPath: '', pull: pull.pull };
    const deep = (kind === 'tree' || kind === 'blob') && rest.length > 0;
    return { owner, name, branch: null, path: '', refPath: deep ? rest.join('/') : '' };
  }

  /** 支援 owner/repo、github.com/owner/repo、/tree/<branch>/<path>、/blob/<branch>/<file>、/commit/<sha>、/pull/<n> */
  function parseRepoInput(raw) {
    const s = String(raw || '').trim().replace(/[?#].*$/, '').replace(/\/+$/, '');
    if (!s) return null;
    const url = s.match(/^(?:https?:\/\/)?(?:www\.)?github\.com\/(.+)$/i);
    return parseSegments((url ? url[1] : s).split('/'), { isGitHubUrl: true });
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
    // 存起來：重新整理後全部從本機快取載入、沒打 API 時，也看得到剩多少
    store.set(KEYS.rate, rate);
  }

  /** 換 token 後額度上限不同（60 / 5000），舊的數字不能再顯示 */
  function forgetRate() {
    rate = null;
    store.remove(KEYS.rate);
  }

  /** 上次 GitHub 告知的額度；格式不對或已經過了重置時間就不算數 */
  function savedRate() {
    const saved = store.get(KEYS.rate, null);
    if (!saved || typeof saved !== 'object') return null;
    const { remaining, limit, reset } = saved;
    if (![remaining, limit, reset].every(Number.isFinite)) return null;
    if (reset * 1000 <= Date.now()) return null;
    return Object.freeze({ remaining, limit, reset });
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
  /**
   * 沒有 token 時每小時只有 60 次，失敗的請求也會扣額度，所以少試幾次；
   * 間隔拉長，總等待時間仍夠 GitHub 組完大倉庫的檔案樹
   */
  const RETRY_DELAYS_NO_TOKEN = [4000, 8000, 12000];
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

  const MINUTE = 60 * 1000;
  /** 本機快取多久：會更新的內容短；用完整 sha 指定的內容永遠不變 */
  const CACHE_AGE = Object.freeze({
    repoInfo: 60 * MINUTE,
    /** 這段時間內直接相信記下的「分支最新 commit」，超過才花 1 次請求向 GitHub 確認 */
    branchHead: 30 * MINUTE,
    pull: 10 * MINUTE,
    immutable: 30 * 24 * 60 * MINUTE,
  });
  const FULL_SHA_RE = /^[0-9a-f]{40}$/i;

  /** 讀本機快取；內容壞掉就當作沒有 */
  async function readCached(url, maxAge) {
    const text = await GF.apiCache.read(url, maxAge);
    if (text == null) return null;
    try {
      return JSON.parse(text);
    } catch {
      return null;
    }
  }

  /**
   * 5xx 為 GitHub 端錯誤，自動重試（有 token 四次，沒有三次）。
   * 檔案樹不送自訂 Accept header：實測超大倉庫（例如 3 萬個檔案）在瀏覽器帶 vnd.github+json 時
   * 會穩定拿到被快取的 500，不帶則正常（只有查分支最新 sha 時會指定 accept）。
   * 重試時加上時間戳，避開 CDN 快取住的錯誤回應。
   */
  /**
   * @param {string} path
   * @param {{ onRetry?: (attempt: number, total: number) => void, maxAge?: number, refresh?: boolean, accept?: string, retry?: boolean }} [opts]
   *   maxAge：允許使用多舊的本機快取（毫秒）；不給就不讀也不存快取
   *   refresh：略過快取直接問 GitHub（結果仍會存起來）
   *   accept：指定回應格式，回傳原始文字（不快取）
   *   retry：false 時 5xx 不重試（手上已有可用的舊資料時，不讓使用者多等）
   */
  async function api(path, { onRetry, maxAge, refresh = false, accept, retry = true } = {}) {
    // 用 sha 指定的內容不會變，重新載入也照用快取，不白花額度
    const skipCache = refresh && maxAge !== CACHE_AGE.immutable;
    if (maxAge && !skipCache) {
      const cached = await readCached(API + path, maxAge);
      if (cached) return cached;
    }
    const headers = {};
    const token = store.get(KEYS.token, '');
    if (token) headers.Authorization = `Bearer ${token}`;
    if (accept) headers.Accept = accept;
    const delays = !retry ? [] : token ? RETRY_DELAYS : RETRY_DELAYS_NO_TOKEN;
    for (let attempt = 0; ; attempt += 1) {
      const sep = path.includes('?') ? '&' : '?';
      const url = attempt === 0 ? API + path : `${API}${path}${sep}_=${Date.now()}`;
      let res;
      try {
        // 重新載入時連瀏覽器的 HTTP 快取（GitHub 給 60 秒）也要向 GitHub 確認
        // （實測 304 仍會扣 1 次額度，但不必重新下載內容）
        const firstCache = skipCache ? 'no-cache' : 'default';
        res = await fetch(url, { headers, cache: attempt === 0 ? firstCache : 'reload' });
      } catch {
        throw new Error(GF.i18n.t('err.network'));
      }
      readRate(res);
      if (res.ok) {
        const text = await res.text();
        if (accept) return text;
        const data = JSON.parse(text);
        if (maxAge && tokenUnchanged(token)) await GF.apiCache.write(API + path, text);
        return data;
      }
      if (res.status >= 500 && attempt < delays.length) {
        if (onRetry) onRetry(attempt + 1, delays.length);
        await wait(delays[attempt]);
        continue;
      }
      throw errorFor(res);
    }
  }

  /** 載入途中換了或清掉 token：拿到的內容可能是私人倉庫的，不能寫進快取 */
  const tokenUnchanged = (token) => store.get(KEYS.token, '') === token;

  const MAX_REF_GUESSES = 6;

  const treePath = (base, ref) => `${base}/git/trees/${encodeURIComponent(ref)}?recursive=1`;

  /* ---------- 分支的檔案樹：以 commit sha 為 key 長期保存 ---------- */
  const SHA_MEDIA_TYPE = 'application/vnd.github.sha';
  /** 記下「分支目前指到哪個 commit」的本機快取網址（不會真的被請求） */
  const headKey = (base, ref) => `${API}${base}/commits/${encodeURIComponent(ref)}?gitfinder=head`;
  const rememberHead = (base, ref, sha) => GF.apiCache.write(headKey(base, ref), JSON.stringify({ sha }));

  /**
   * 本機記得的分支檔案樹
   * @param {number} maxAge 「分支最新 commit」的記錄可以多舊；檔案樹本身依 sha 存放，不會過期
   * @returns {Promise<{ sha: string, tree: object } | null>}
   */
  async function storedBranchTree(base, ref, maxAge) {
    const head = await readCached(headKey(base, ref), maxAge);
    if (!head || !FULL_SHA_RE.test(head.sha || '')) return null;
    const tree = await readCached(API + treePath(base, head.sha), CACHE_AGE.immutable);
    return tree ? { sha: head.sha, tree } : null;
  }

  /** 分支最新的 commit sha（回應只有 40 個字元）；分支不存在時回傳 null */
  async function latestSha(base, ref) {
    try {
      const text = await api(`${base}/commits/${encodeURIComponent(ref)}`, { accept: SHA_MEDIA_TYPE, retry: false });
      const sha = text.trim();
      return FULL_SHA_RE.test(sha) ? sha : null;
    } catch (err) {
      if (err.status === 404 || err.status === 422) return null;
      throw err;
    }
  }

  /**
   * 用分支名稱抓檔案樹：GitHub 對這個網址通常已經組好，比用 sha 抓更不容易碰到 500。
   * 回應的 sha 是分支最新的 commit，以它為 key 存起來（沒有 sha 就不存）
   */
  async function loadBranchTree(base, ref, opts) {
    const token = store.get(KEYS.token, '');
    const tree = await api(treePath(base, ref), { onRetry: opts.onRetry, refresh: opts.refresh });
    if (tokenUnchanged(token) && FULL_SHA_RE.test(tree.sha || '')) {
      await GF.apiCache.write(API + treePath(base, tree.sha), JSON.stringify(tree));
      await rememberHead(base, ref, tree.sha);
    }
    return tree;
  }

  /**
   * 分支：30 分鐘內直接用本機的樹（0 次請求）；超過就先問最新 sha（1 次），
   * 沒變就繼續用，變了才重抓。重新載入時略過確認直接重抓。
   * 完整 sha：內容不會變，照一般快取。
   */
  async function fetchTree(base, ref, opts = {}) {
    if (FULL_SHA_RE.test(ref)) return api(treePath(base, ref), { ...opts, maxAge: CACHE_AGE.immutable });
    if (opts.refresh) return loadBranchTree(base, ref, opts);
    const fresh = await storedBranchTree(base, ref, CACHE_AGE.branchHead);
    if (fresh) return fresh.tree;
    const stale = await storedBranchTree(base, ref, Infinity);
    return stale ? revalidate(base, ref, stale, opts) : loadBranchTree(base, ref, opts);
  }

  /** 記下的檔案樹過了 30 分鐘：問一次最新 sha，沒變就繼續用 */
  async function revalidate(base, ref, stale, opts) {
    const token = store.get(KEYS.token, '');
    let latest;
    try {
      latest = await latestSha(base, ref);
    } catch (err) {
      // 額度用完、連不上或 GitHub 出錯：先給舊的樹，總比整個打不開好
      console.warn('[gitfinder] could not check the branch, showing the saved tree', err);
      return tokenUnchanged(token) ? stale.tree : loadBranchTree(base, ref, opts);
    }
    if (latest !== stale.sha || !tokenUnchanged(token)) return loadBranchTree(base, ref, opts);
    await rememberHead(base, ref, stale.sha);
    // 重新存一次，讓常用的樹不會因為存得早而先被淘汰
    await GF.apiCache.write(API + treePath(base, stale.sha), JSON.stringify(stale.tree));
    return stale.tree;
  }

  /** 倉庫資訊只用來查預設分支，很少改變 */
  const fetchDefaultBranch = async (base, { refresh = false } = {}) =>
    (await api(base, { maxAge: CACHE_AGE.repoInfo, refresh })).default_branch;

  /** refPath 可能的分支名稱，由短到長 */
  function refCandidates(refPath) {
    const parts = refPath.split('/');
    const count = Math.min(parts.length, MAX_REF_GUESSES);
    return Array.from({ length: count }, (_, i) => ({ ref: parts.slice(0, i + 1).join('/'), path: parts.slice(i + 1).join('/') }));
  }

  /** 先看本機快取有沒有哪個候選分支的檔案樹，有就不必再花請求去猜 */
  async function cachedRef(base, candidates) {
    for (const c of candidates) {
      const tree = FULL_SHA_RE.test(c.ref)
        ? await readCached(API + treePath(base, c.ref), CACHE_AGE.immutable)
        : (await storedBranchTree(base, c.ref, CACHE_AGE.branchHead))?.tree;
      if (tree) return { branch: c.ref, path: c.path, tree };
    }
    return null;
  }

  /**
   * 把 refPath（例如 feature/icons/assets/logo）拆成分支與路徑：
   * 先比對預設分支，否則由短到長逐一嘗試，第一個存在的就是分支。
   */
  async function resolveRef(base, refPath, opts) {
    const def = await fetchDefaultBranch(base, { refresh: !!opts.refresh });
    if (refPath === def || refPath.startsWith(`${def}/`)) {
      return { branch: def, path: refPath.slice(def.length + 1), tree: await fetchTree(base, def, opts) };
    }
    const candidates = refCandidates(refPath);
    const cached = opts.refresh ? null : await cachedRef(base, candidates);
    if (cached) return cached;
    for (const { ref, path } of candidates) {
      try {
        return { branch: ref, path, tree: await fetchTree(base, ref, opts) };
      } catch (err) {
        if (err.status !== 404 && err.status !== 422) throw err;
      }
    }
    throw Object.assign(new Error(GF.i18n.t('err.notFound')), { status: 404 });
  }

  /** 記住的預設分支可能已經改名：抓不到時重新查一次預設分支 */
  async function fetchDefaultTree(base, path, opts) {
    const def = await fetchDefaultBranch(base, { refresh: !!opts.refresh });
    try {
      return { branch: def, path, tree: await fetchTree(base, def, opts) };
    } catch (err) {
      if (err.status !== 404) throw err;
      const fresh = await fetchDefaultBranch(base, { refresh: true });
      if (fresh === def) throw err;
      return { branch: fresh, path, tree: await fetchTree(base, fresh, opts) };
    }
  }

  /** @returns {Promise<{ branch: string, path: string, entries: object[], truncated: boolean }>} */
  async function fetchRepo({ owner, name, branch, path = '', refPath = '' }, opts = {}) {
    const base = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    let result;
    if (branch) result = { branch, path, tree: await fetchTree(base, branch, opts) };
    else if (refPath) result = await resolveRef(base, refPath, opts);
    else result = await fetchDefaultTree(base, path, opts);
    return {
      branch: result.branch,
      path: result.path,
      entries: Array.isArray(result.tree.tree) ? result.tree.tree : [],
      truncated: !!result.tree.truncated,
    };
  }

  /* ---------- 單一 commit ---------- */
  const COMMIT_PAGE_SIZE = 300; // GitHub 每頁最多 300 個檔案
  const MAX_COMMIT_PAGES = 10; // 最多 3000 個檔案
  /** GitHub 的狀態收斂成四種；unchanged 不列入 */
  const STATUS_MAP = Object.freeze({
    added: 'added', copied: 'added', removed: 'removed', renamed: 'renamed', modified: 'modified', changed: 'modified',
  });

  function toEntry(file) {
    const status = STATUS_MAP[file.status];
    if (!status || !file.filename) return null;
    // 改名時 changes > 0 表示內容也改了；圖片等二進位檔 GitHub 一律回 0，只能視為純改名
    const contentChanged = status === 'renamed' ? { contentChanged: (file.changes || 0) > 0 } : {};
    return { path: file.filename, type: 'blob', size: null, change: { status, previousPath: file.previous_filename || null, ...contentChanged } };
  }

  /**
   * 抓一個 commit 變動的檔案（逐頁抓到不滿一頁或滿 10 頁為止）
   * @returns {Promise<{ sha: string, parentSha: string|null, message: string, entries: object[], truncated: boolean }>}
   */
  /** 比對檔案樹得到的改名，判定條件就是內容（blob）相同，所以一定是純改名 */
  const changeEntry = (path, status, size = null, previousPath = null) => ({
    path, type: 'blob', size, change: { status, previousPath, ...(status === 'renamed' && { contentChanged: false }) },
  });

  /**
   * 大型 repo 的 commit，GitHub 常常算不出差異：照樣回 200，但 files 是空陣列。
   * 這時改成直接比較這個 commit 和上一版的整棵檔案樹（多 2 次 API）。
   * 內容（blob sha）相同、只是路徑不同的視為改名。
   */
  async function diffTrees(repoBase, sha, parentSha, opts) {
    const [after, before] = await Promise.all([fetchTree(repoBase, sha, opts), fetchTree(repoBase, parentSha, opts)]);
    const blobs = (tree) => (Array.isArray(tree.tree) ? tree.tree : []).filter((e) => e.type === 'blob');
    const now = new Map(blobs(after).map((e) => [e.path, e]));
    const was = new Map(blobs(before).map((e) => [e.path, e]));
    const removed = [...was.values()].filter((e) => !now.has(e.path));
    const removedBySha = new Map();
    removed.forEach((e) => { if (!removedBySha.has(e.sha)) removedBySha.set(e.sha, e.path); });
    const renamedFrom = new Set();
    const entries = [];
    for (const e of now.values()) {
      const old = was.get(e.path);
      if (old) {
        if (old.sha !== e.sha) entries.push(changeEntry(e.path, 'modified', e.size));
        continue;
      }
      const from = removedBySha.get(e.sha);
      if (from && !renamedFrom.has(from)) {
        renamedFrom.add(from);
        entries.push(changeEntry(e.path, 'renamed', e.size, from));
      } else {
        entries.push(changeEntry(e.path, 'added', e.size));
      }
    }
    removed.filter((e) => !renamedFrom.has(e.path)).forEach((e) => entries.push(changeEntry(e.path, 'removed', e.size)));
    return { entries, truncated: !!after.truncated || !!before.truncated };
  }

  async function fetchCommit({ owner, name, commit }, opts = {}) {
    const repoBase = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const base = `${repoBase}/commits/${encodeURIComponent(commit)}`;
    const pages = [];
    let truncated = false;
    for (let page = 1; page <= MAX_COMMIT_PAGES; page += 1) {
      // commit 的內容不會變（短 sha 也一樣指向同一個 commit）
      const data = await api(`${base}?per_page=${COMMIT_PAGE_SIZE}&page=${page}`, { ...opts, maxAge: CACHE_AGE.immutable });
      pages.push(data);
      const count = Array.isArray(data.files) ? data.files.length : 0;
      if (count < COMMIT_PAGE_SIZE) break;
      truncated = page === MAX_COMMIT_PAGES;
    }
    const first = pages[0];
    const parents = Array.isArray(first.parents) ? first.parents : [];
    const parentSha = parents.length ? parents[0].sha : null;
    let entries = pages.flatMap((p) => (Array.isArray(p.files) ? p.files : [])).map(toEntry).filter(Boolean);
    if (!entries.length && parentSha) {
      const diff = await diffTrees(repoBase, first.sha, parentSha, opts);
      entries = diff.entries;
      truncated = diff.truncated;
    }
    return { sha: first.sha, parentSha, message: (first.commit && first.commit.message) || '', entries, truncated };
  }

  /* ---------- Pull request ---------- */
  const PULL_PAGE_SIZE = 100; // GitHub 每頁最多 100 個檔案
  const MAX_PULL_PAGES = 30; // GitHub 最多只列 3000 個檔案

  const pullState = (info) => (info.merged_at ? 'merged' : info.state === 'closed' ? 'closed' : 'open');

  /**
   * 逐頁抓 PR 變動的檔案（PR 會再 push，所以用分支的快取時間）。
   * 已經抓滿 changed_files 個就停，免得檔案數剛好是 100 的倍數時多打一次空頁。
   */
  async function fetchPullFiles(base, changedFiles, opts) {
    const files = [];
    for (let page = 1; page <= MAX_PULL_PAGES; page += 1) {
      const data = await api(`${base}/files?per_page=${PULL_PAGE_SIZE}&page=${page}`, { ...opts, maxAge: CACHE_AGE.pull });
      const list = Array.isArray(data) ? data : [];
      files.push(...list);
      const listedAll = Number.isInteger(changedFiles) && files.length >= changedFiles;
      if (list.length < PULL_PAGE_SIZE || listedAll) return { files, truncated: false };
    }
    return { files, truncated: true };
  }

  /**
   * merge base：compare 的回應含所有檔案的 patch，可能好幾 MB，所以只把 sha 存進快取。
   * 找不到（例如兩邊沒有共同的歷史）就回傳 null，照樣列出檔案，只是沒有「之前」可以比。
   */
  async function fetchMergeBase(repoBase, baseSha, headSha, opts) {
    const path = `${repoBase}/compare/${baseSha}...${headSha}?per_page=1`;
    const cached = await readCached(API + path, CACHE_AGE.immutable);
    if (cached && typeof cached.sha === 'string') return cached.sha;
    try {
      const sha = (await api(path, opts)).merge_base_commit.sha;
      await GF.apiCache.write(API + path, JSON.stringify({ sha }));
      return sha;
    } catch (err) {
      if (err.status !== 404 && err.status !== 422) throw err;
      return null;
    }
  }

  /**
   * PR 的差異和 GitHub 一樣以 merge base 為「前」：用 base 分支最新的 commit 比，
   * 會把 base 分支之後才進來的變動也算進去。
   * fork 來的 PR 也用原倉庫：head commit 會進到原倉庫，用 sha 就讀得到。
   * @returns {Promise<{ sha: string, parentSha: string|null, message: string, entries: object[], truncated: boolean,
   *   pull: { number: number, state: 'open'|'closed'|'merged' } }>}
   */
  async function fetchPull({ owner, name, pull }, opts = {}) {
    const repoBase = `/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`;
    const base = `${repoBase}/pulls/${encodeURIComponent(pull)}`;
    const info = await api(base, { ...opts, maxAge: CACHE_AGE.pull });
    const head = info.head.sha;
    const mergeBase = await fetchMergeBase(repoBase, info.base.sha, head, opts);
    const listed = await fetchPullFiles(base, info.changed_files, opts);
    let entries = listed.files.map(toEntry).filter(Boolean);
    let { truncated } = listed;
    if (!entries.length && mergeBase && info.changed_files !== 0) {
      const diff = await diffTrees(repoBase, head, mergeBase, opts);
      entries = diff.entries;
      truncated = diff.truncated;
    }
    return {
      sha: head, parentSha: mergeBase, message: info.title || '', entries, truncated,
      pull: { number: info.number, state: pullState(info) },
    };
  }

  const encPath = (p) => p.split('/').map(encodeURIComponent).join('/');

  const rawAt = (repo, ref, path) =>
    `https://raw.githubusercontent.com/${encPath(repo.owner)}/${encPath(repo.name)}/${encPath(ref)}/${encPath(path)}`;

  const rawUrl = (repo, path) => rawAt(repo, repo.branch, path);

  /** 節點所在的版本：commit 裡被刪除的檔案只存在於上一個版本 */
  const refFor = (repo, node) =>
    node && node.change && node.change.status === 'removed' && repo.commit ? repo.commit.parentSha : repo.branch;

  const fileUrl = (repo, node) => rawAt(repo, refFor(repo, node), node.path);

  /** 修改 / 改名的檔案在上一個版本的原檔網址；沒有前一版時回傳 null */
  function previousUrl(repo, node) {
    const change = node && node.change;
    const parent = repo.commit && repo.commit.parentSha;
    if (!change || !parent || (change.status !== 'modified' && change.status !== 'renamed')) return null;
    // 純改名的前後內容一樣，沒有東西可以比較
    if (change.status === 'renamed' && !change.contentChanged) return null;
    return rawAt(repo, parent, change.previousPath || node.path);
  }

  const THUMB_PROXY = 'https://wsrv.nl/';
  const SMALL_IMAGE_BYTES = 20 * 1024;
  const NO_PROXY_EXT = new Set(['svg', 'ico']);

  /**
   * 縮圖網址：透過 wsrv.nl 縮小並轉成 WebP，省流量。
   * SVG / ICO 與 20 KB 以下的小圖直接用原圖（代理反而多繞一趟）。
   * @param {number} size 縮圖最長邊（像素，已含 2x 高解析度）
   */
  function proxyThumb(raw, node, size) {
    if (NO_PROXY_EXT.has(node.ext) || (node.size != null && node.size <= SMALL_IMAGE_BYTES)) return raw;
    const params = new URLSearchParams({ url: raw, w: String(size), h: String(size), fit: 'inside', output: 'webp' });
    if (node.ext === 'gif') params.set('n', '-1'); // 保留 GIF 動畫
    return `${THUMB_PROXY}?${params}&we`;
  }

  const thumbUrl = (repo, node, size) => proxyThumb(fileUrl(repo, node), node, size);

  /** 修改 / 改名的圖在上一個版本的縮圖；沒有前一版時回傳 null */
  function previousThumbUrl(repo, node, size) {
    const raw = previousUrl(repo, node);
    return raw ? proxyThumb(raw, node, size) : null;
  }

  /** App 內的網址，與 GitHub 相同的結構：/owner/repo/tree/<branch>/<path> */
  function routeUrl(repo, path) {
    const base = `/${encPath(repo.owner)}/${encPath(repo.name)}`;
    const tail = path ? `/${encPath(path)}` : '';
    if (repo.commit && repo.commit.pull) return `${base}/pull/${repo.commit.pull.number}${tail}`;
    if (repo.commit) return `${base}/commit/${encPath(repo.commit.sha)}${tail}`;
    if (!repo.branch) return base;
    return `${base}/tree/${encPath(repo.branch)}${path ? `/${encPath(path)}` : ''}`;
  }

  function webUrl(repo, node) {
    const base = `https://github.com/${encPath(repo.owner)}/${encPath(repo.name)}`;
    if (!node || !node.path) {
      if (repo.commit && repo.commit.pull) return `${base}/pull/${repo.commit.pull.number}`;
      return repo.commit ? `${base}/commit/${encPath(repo.commit.sha)}` : `${base}/tree/${encPath(repo.branch)}`;
    }
    const kind = node.type === 'dir' ? 'tree' : 'blob';
    return `${base}/${kind}/${encPath(refFor(repo, node))}/${encPath(node.path)}`;
  }

  GF.github = Object.freeze({
    parseRepoInput, parseRoute, routeUrl, fetchRepo, fetchCommit, fetchPull, rawUrl, fileUrl, previousUrl, thumbUrl, previousThumbUrl, webUrl, getRate: () => rate || savedRate(), savedRate, forgetRate,
  });
})(window.GF);
