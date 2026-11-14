/** 只實作 App 用到的 Cache Storage 介面，用 Map 存放；測試結束記得 delete globalThis.caches */
export function installFakeCaches() {
  const store = new Map();
  const cache = {
    match: async (url) => (store.has(url) ? store.get(url).clone() : undefined),
    put: async (url, res) => { store.set(url, res); },
    delete: async (url) => store.delete(url),
    keys: async () => [...store.keys()].map((url) => ({ url })),
  };
  globalThis.caches = { open: async () => cache, delete: async () => { store.clear(); return true; } };
  return store;
}
