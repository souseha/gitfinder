/* GitHub API 回應的本機快取（Cache Storage）：重新整理頁面也不必再花 API 額度 */
(function (GF) {
  'use strict';

  const CACHE_NAME = 'gitfinder-api-v1';
  const SAVED_AT_HEADER = 'x-gitfinder-saved-at';
  /** 大倉庫的檔案樹一份可能有好幾 MB，只留最近存的幾份 */
  const MAX_ENTRIES = 20;

  const isAvailable = () => typeof caches !== 'undefined';
  const savedAt = (res) => (res ? Number(res.headers.get(SAVED_AT_HEADER)) || 0 : 0);

  /** 快取壞掉不影響使用，只是少省一點額度，所以記錄後照常往下走 */
  function warn(action, err) {
    console.warn(`[gitfinder] API cache ${action} failed`, err);
  }

  /**
   * @param {string} url
   * @param {number} maxAgeMs 超過這個時間的內容視為過期
   * @returns {Promise<string|null>} 新鮮的回應內容，沒有就回傳 null
   */
  async function read(url, maxAgeMs) {
    if (!isAvailable()) return null;
    try {
      const cache = await caches.open(CACHE_NAME);
      const res = await cache.match(url);
      if (!res || Date.now() - savedAt(res) > maxAgeMs) return null;
      return await res.text();
    } catch (err) {
      warn('read', err);
      return null;
    }
  }

  async function evictOldest(cache) {
    const keys = await cache.keys();
    if (keys.length <= MAX_ENTRIES) return;
    const dated = await Promise.all(keys.map(async (req) => ({ url: req.url, at: savedAt(await cache.match(req.url)) })));
    const oldest = [...dated].sort((a, b) => a.at - b.at).slice(0, keys.length - MAX_ENTRIES);
    await Promise.all(oldest.map((entry) => cache.delete(entry.url)));
  }

  /**
   * @param {string} url
   * @param {string} body 回應的原始文字
   * @returns {Promise<void>}
   */
  async function write(url, body) {
    if (!isAvailable()) return;
    try {
      const cache = await caches.open(CACHE_NAME);
      const headers = { 'content-type': 'application/json', [SAVED_AT_HEADER]: String(Date.now()) };
      await cache.put(url, new Response(body, { headers }));
      await evictOldest(cache);
    } catch (err) {
      warn('write', err);
    }
  }

  /** 更換或清除 token 時呼叫：私人倉庫的內容不該留給下一個 token 看到 */
  async function clear() {
    if (!isAvailable()) return;
    try {
      await caches.delete(CACHE_NAME);
    } catch (err) {
      warn('clear', err);
    }
  }

  GF.apiCache = Object.freeze({ read, write, clear, MAX_ENTRIES });
})((window.GF = window.GF || {}));
