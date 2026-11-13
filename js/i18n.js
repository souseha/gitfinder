/* 多語言：字典、t()、套用到靜態 HTML（data-i18n / data-i18n-ph / data-i18n-tip / data-i18n-html） */
(function (GF) {
  'use strict';

  const STORAGE_KEY = 'gitfinder.lang';
  const DEFAULT_LANG = 'en';
  const IS_MAC = /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent);
  /** 介面文字裡的快捷鍵依平台顯示：Mac 用 ⌥⌘，Windows / Linux 用 Ctrl+Alt+ */
  const SHORTCUTS = Object.freeze({ sidebarKey: IS_MAC ? '⌥⌘S' : 'Ctrl+Alt+S' });
  const LANGS = Object.freeze({ 'zh-Hant': '繁體中文', en: 'English' });

  const DICT = {
    'zh-Hant': {
      'common.open': '開啟', 'common.cancel': '取消', 'common.save': '儲存', 'common.done': '完成',
      'sidebar.inputPh': 'owner/repo 或 GitHub 網址', 'sidebar.openTip': '開啟倉庫', 'sidebar.repos': '倉庫',
      'sidebar.settings': '設定', 'sidebar.empty': '尚未開啟任何倉庫', 'sidebar.remove': '從清單移除',
      'sidebar.rate': 'API 剩餘 {left} / {limit}',
      'tb.sidebar': '顯示／隱藏側邊欄 ({sidebarKey})', 'tb.back': '上一頁', 'tb.fwd': '下一頁', 'tb.home': '回到首頁',
      'tb.iconSize': '圖像大小', 'tb.imagesOnly': '只顯示圖片', 'tb.viewIcon': '圖像', 'tb.viewList': '列表',
      'tb.viewColumn': '直欄', 'tb.searchPh': '搜尋整個倉庫', 'tb.search': '搜尋「{q}」',
      'kind.dir': '資料夾', 'kind.image': '{ext} 影像', 'kind.text': '{ext} 文字檔', 'kind.file': '{ext} 檔案',
      'list.name': '名稱', 'list.size': '大小', 'list.kind': '種類', 'list.where': '位置',
      'count.items': '{n} 個項目', 'count.found': '找到 {n} 個項目', 'count.images': '{n} 張圖片',
      'count.selected': '已選取 {n} 個', 'status.truncated': '清單不完整（倉庫過大）',
      'empty.search': '找不到符合「{q}」的項目', 'empty.noImages': '這個資料夾沒有圖片',
      'empty.folder': '這個資料夾是空的', 'empty.column': '沒有項目',
      'pv.quicklook': '快速查看', 'pv.openGh': '在 GitHub 開啟', 'pv.multi': '已選取 {n} 個項目', 'pv.download': '下載',
      'welcome.tagline': '像 Finder 一樣瀏覽任何公開 GitHub 倉庫的檔案與圖片',
      'welcome.inputPh': '貼上 GitHub 網址或 owner/repo', 'welcome.try': '試試看：', 'welcome.recent': '最近開啟', 'source.label': 'GitHub 原始碼', 'source.tip': '在 GitHub 查看原始碼', 'welcome.foot': '開源專案，以 MIT 授權釋出', 'time.now': '剛剛',
      'hint.quicklook': '快速查看', 'hint.switch': '切換', 'hint.open': '開啟資料夾', 'hint.up': '上一層',
      'hint.search': '搜尋', 'hint.multi': '多選', 'hint.menu': '右鍵 更多操作',
      'ql.close': '關閉 (Space / Esc)', 'ql.download': '下載', 'ql.openGh': '在 GitHub 開啟',
      'ql.prev': '上一個 (←)', 'ql.next': '下一個 (→)', 'ql.tooBig': '檔案太大（{size}），請在 GitHub 上查看。',
      'ql.loading': '載入中…', 'ql.loadFail': '無法載入檔案內容（{msg}）', 'ql.noPreview': '這個檔案類型無法預覽',
      'toast.pathMissing': '找不到路徑：{path}，已回到根目錄', 'toast.truncated': '倉庫檔案過多，GitHub 只回傳了部分清單',
      'toast.badInput': '無法辨識，請輸入 owner/repo 或 GitHub 網址', 'toast.loadFail': '載入失敗', 'toast.retrying': '倉庫很大，GitHub 正在準備檔案清單…（重試 {n}/{total}）',
      'toast.copied': '已複製', 'toast.copiedImage': '已複製圖片', 'toast.copyFail': '無法存取剪貼簿',
      'toast.tokenSaved': 'Token 已儲存', 'toast.tokenCleared': 'Token 已清除',
      'err.network': '無法連線到 GitHub，請檢查網路後再試',
      'err.rate': '已達 GitHub API 速率上限，將於 {time} 重置。可在「設定」加入 Token 提高上限。',
      'err.notFound': '找不到這個倉庫或分支（私有倉庫需要設定 Token）', 'err.token': 'Token 無效或已過期，請重新設定',
      'err.empty': '這個倉庫是空的', 'err.server': 'GitHub 伺服器暫時出錯（HTTP {status}），可能是倉庫太大或 GitHub 忙碌，請稍後再試',
      'err.http': 'GitHub API 錯誤（HTTP {status}）',
      'dl.busy': '已有下載進行中，請稍候或先取消', 'dl.confirm': '「{name}」共有 {files} 個檔案、{size}。\n檔案會先暫存在瀏覽器記憶體再打包，確定要下載嗎？',
      'dl.preparing': '準備下載 {name}…', 'dl.progress': '下載 {name}：{done} / {total}', 'dl.zipping': '正在打包 {name}.zip…',
      'dl.single': '下載 {name}…', 'dl.done': '已下載 {name}（{n} 個檔案）', 'dl.partial': '已下載 {ok} 個檔案，{fail} 個失敗',
      'dl.fail': '下載失敗：{msg}', 'dl.cancelled': '已取消下載', 'dl.noFiles': '沒有可下載的檔案',
      'dl.fflate': '無法載入壓縮元件，請檢查網路',
      'menu.open': '打開', 'menu.openNewTab': '在新分頁打開', 'menu.quicklook': '快速查看',
      'menu.quicklookN': '快速查看 {n} 個項目', 'menu.download': '下載', 'menu.downloadFolder': '下載資料夾',
      'menu.downloadN': '下載 {n} 個項目（zip）', 'menu.downloadHere': '下載這個資料夾',
      'menu.copyName': '複製名稱', 'menu.copyNames': '複製 {n} 個名稱', 'menu.copyPath': '複製路徑',
      'menu.copyPaths': '複製 {n} 個路徑', 'menu.copyImage': '複製圖片', 'menu.copyRaw': '複製原始檔連結',
      'menu.copyGh': '複製 GitHub 連結', 'menu.openGh': '在 GitHub 開啟', 'menu.selectAll': '全選',
      'menu.viewAs': '顯示方式', 'menu.imagesOnly': '只顯示圖片', 'menu.remove': '從清單移除',
      'menu.copyRepoUrl': '複製倉庫網址', 'menu.files': '{files} 個檔案，{size}',
      'settings.title': '設定', 'settings.theme': '外觀', 'settings.system': '跟隨系統', 'settings.light': '淺色',
      'settings.dark': '深色', 'settings.language': '語言',
      'token.desc': '未設定時，GitHub API 每小時只能呼叫 60 次。建立一個 <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">Personal Access Token</a>（公開倉庫不需任何權限）可提升到每小時 5000 次。',
      'token.note': 'Token 只會以明文存在這個瀏覽器的 localStorage，不會傳給 GitHub 以外的地方。',
      'token.ph': 'github_pat_… 或 ghp_…', 'token.clear': '清除',
    },
    en: {
      'common.open': 'Open', 'common.cancel': 'Cancel', 'common.save': 'Save', 'common.done': 'Done',
      'sidebar.inputPh': 'owner/repo or GitHub URL', 'sidebar.openTip': 'Open repository', 'sidebar.repos': 'Repositories',
      'sidebar.settings': 'Settings', 'sidebar.empty': 'No repositories yet', 'sidebar.remove': 'Remove from list',
      'sidebar.rate': 'API left {left} / {limit}',
      'tb.sidebar': 'Show / hide sidebar ({sidebarKey})', 'tb.back': 'Back', 'tb.fwd': 'Forward', 'tb.home': 'Home',
      'tb.iconSize': 'Icon size', 'tb.imagesOnly': 'Images only', 'tb.viewIcon': 'Icons', 'tb.viewList': 'List',
      'tb.viewColumn': 'Columns', 'tb.searchPh': 'Search repository', 'tb.search': 'Search “{q}”',
      'kind.dir': 'Folder', 'kind.image': '{ext} image', 'kind.text': '{ext} text', 'kind.file': '{ext} file',
      'list.name': 'Name', 'list.size': 'Size', 'list.kind': 'Kind', 'list.where': 'Where',
      'count.items': '{n} items', 'count.items_one': '1 item', 'count.found': '{n} found', 'count.images': '{n} images', 'count.images_one': '1 image',
      'count.selected': '{n} selected', 'status.truncated': 'Incomplete listing (repository too large)',
      'empty.search': 'No results for “{q}”', 'empty.noImages': 'No images in this folder',
      'empty.folder': 'This folder is empty', 'empty.column': 'No items',
      'pv.quicklook': 'Quick Look', 'pv.openGh': 'Open on GitHub', 'pv.multi': '{n} items selected', 'pv.download': 'Download',
      'welcome.tagline': 'Browse files and images in any public GitHub repository, Finder-style',
      'welcome.inputPh': 'Paste a GitHub URL or owner/repo', 'welcome.try': 'Try:', 'welcome.recent': 'Recent', 'source.label': 'Source on GitHub', 'source.tip': 'View the source code on GitHub', 'welcome.foot': 'Open source under the MIT license', 'time.now': 'just now',
      'hint.quicklook': 'Quick Look', 'hint.switch': 'Navigate', 'hint.open': 'Open folder', 'hint.up': 'Up',
      'hint.search': 'Search', 'hint.multi': 'Multi-select', 'hint.menu': 'Right-click for more',
      'ql.close': 'Close (Space / Esc)', 'ql.download': 'Download', 'ql.openGh': 'Open on GitHub',
      'ql.prev': 'Previous (←)', 'ql.next': 'Next (→)', 'ql.tooBig': 'File too large ({size}). View it on GitHub.',
      'ql.loading': 'Loading…', 'ql.loadFail': 'Could not load file ({msg})', 'ql.noPreview': 'No preview for this file type',
      'toast.pathMissing': 'Path not found: {path}. Showing the root instead.', 'toast.truncated': 'Repository is too large; GitHub returned a partial listing',
      'toast.badInput': 'Enter owner/repo or a GitHub URL', 'toast.loadFail': 'Failed to load', 'toast.retrying': 'Large repository: GitHub is still preparing the file list… (retry {n}/{total})',
      'toast.copied': 'Copied', 'toast.copiedImage': 'Image copied', 'toast.copyFail': 'Clipboard is not available',
      'toast.tokenSaved': 'Token saved', 'toast.tokenCleared': 'Token cleared',
      'err.network': 'Cannot reach GitHub. Check your connection and try again.',
      'err.rate': 'GitHub API rate limit reached; resets at {time}. Add a token in Settings for a higher limit.',
      'err.notFound': 'Repository or branch not found (private repositories need a token)', 'err.token': 'Token is invalid or expired',
      'err.empty': 'This repository is empty', 'err.server': 'GitHub server error (HTTP {status}). The repository may be too large or GitHub is busy; try again later.',
      'err.http': 'GitHub API error (HTTP {status})',
      'dl.busy': 'A download is already running', 'dl.confirm': '“{name}” has {files} files, {size}.\nFiles are held in browser memory before zipping. Download anyway?',
      'dl.preparing': 'Preparing {name}…', 'dl.progress': 'Downloading {name}: {done} / {total}', 'dl.zipping': 'Zipping {name}.zip…',
      'dl.single': 'Downloading {name}…', 'dl.done': 'Downloaded {name} ({n} files)', 'dl.done_one': 'Downloaded {name} (1 file)', 'dl.partial': 'Downloaded {ok} files, {fail} failed',
      'dl.fail': 'Download failed: {msg}', 'dl.cancelled': 'Download cancelled', 'dl.noFiles': 'Nothing to download',
      'dl.fflate': 'Could not load the zip library; check your connection',
      'menu.open': 'Open', 'menu.openNewTab': 'Open in New Tab', 'menu.quicklook': 'Quick Look',
      'menu.quicklookN': 'Quick Look {n} Items', 'menu.download': 'Download', 'menu.downloadFolder': 'Download Folder',
      'menu.downloadN': 'Download {n} Items (zip)', 'menu.downloadHere': 'Download This Folder',
      'menu.copyName': 'Copy Name', 'menu.copyNames': 'Copy {n} Names', 'menu.copyPath': 'Copy Path',
      'menu.copyPaths': 'Copy {n} Paths', 'menu.copyImage': 'Copy Image', 'menu.copyRaw': 'Copy Raw File Link',
      'menu.copyGh': 'Copy GitHub Link', 'menu.openGh': 'Open on GitHub', 'menu.selectAll': 'Select All',
      'menu.viewAs': 'View as', 'menu.imagesOnly': 'Images Only', 'menu.remove': 'Remove from List',
      'menu.copyRepoUrl': 'Copy Repository URL', 'menu.files': '{files} files, {size}',
      'settings.title': 'Settings', 'settings.theme': 'Appearance', 'settings.system': 'System', 'settings.light': 'Light',
      'settings.dark': 'Dark', 'settings.language': 'Language',
      'token.desc': 'Without a token the GitHub API allows 60 requests per hour. A <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">personal access token</a> (no scopes needed for public repositories) raises it to 5,000.',
      'token.note': 'The token is stored in plain text in this browser’s localStorage and is only sent to GitHub.',
      'token.ph': 'github_pat_… or ghp_…', 'token.clear': 'Clear',
    },
  };

  function detect() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved && DICT[saved]) return saved;
    } catch {
      /* localStorage 不可用時使用預設語言 */
    }
    return DEFAULT_LANG; // 未曾手動選擇語言時一律使用英文，可在「設定」切換

  }

  let lang = detect();
  const listeners = [];

  function t(key, vars) {
    // n 為 1 時優先使用單數字串（例如 '1 item'），沒有定義就沿用一般字串
    const one = vars && vars.n === 1 ? DICT[lang][`${key}_one`] : undefined;
    const raw = one ?? DICT[lang][key] ?? DICT['zh-Hant'][key] ?? key;
    const all = { ...SHORTCUTS, ...vars };
    return raw.replace(/\{(\w+)\}/g, (m, k) => (all[k] != null ? String(all[k]) : m));
  }

  function applyStatic(root = document) {
    document.documentElement.lang = lang;
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-html]').forEach((el) => { el.innerHTML = t(el.dataset.i18nHtml); });
    root.querySelectorAll('[data-i18n-ph]').forEach((el) => { el.placeholder = t(el.dataset.i18nPh); });
    root.querySelectorAll('[data-i18n-tip]').forEach((el) => {
      const tip = t(el.dataset.i18nTip);
      el.dataset.tip = tip;
      el.setAttribute('aria-label', tip);
    });
  }

  function setLang(next) {
    if (!DICT[next] || next === lang) return;
    lang = next;
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* 無法儲存時只影響本次 */
    }
    applyStatic();
    listeners.forEach((fn) => fn(lang));
  }

  GF.i18n = Object.freeze({ t, setLang, applyStatic, getLang: () => lang, LANGS, onChange: (fn) => listeners.push(fn) });
})((window.GF = window.GF || {}));
