/* 下載：單一檔案，或把資料夾 / 多個項目打包成 zip（瀏覽器端用 fflate） */
(function (GF) {
  'use strict';

  const { fileUrl } = GF.github;
  const { t } = GF.i18n;

  const FFLATE_URL = 'https://cdn.jsdelivr.net/npm/fflate@0.8.2/umd/index.js';
  const CONCURRENCY = 8;
  const RETRIES = 1;
  /** 超過這個大小先詢問（整包會暫存在記憶體中） */
  const CONFIRM_BYTES = 300 * 1024 * 1024;

  let fflatePromise = null;

  function loadFflate() {
    if (window.fflate) return Promise.resolve(window.fflate);
    if (!fflatePromise) {
      fflatePromise = new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = FFLATE_URL;
        script.onload = () => resolve(window.fflate);
        script.onerror = () => {
          fflatePromise = null;
          reject(new Error(t('dl.fflate')));
        };
        document.head.appendChild(script);
      });
    }
    return fflatePromise;
  }

  function saveBlob(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }

  async function fetchBlob(url, signal) {
    let lastError = null;
    for (let attempt = 0; attempt <= RETRIES; attempt += 1) {
      try {
        const res = await fetch(url, { signal });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        return await res.blob();
      } catch (err) {
        if (signal && signal.aborted) throw err;
        lastError = err;
      }
    }
    throw lastError;
  }

  /** 跨網域的 <a download> 會被瀏覽器忽略，所以先抓成 Blob 再存檔 */
  async function downloadFile(repo, node) {
    saveBlob(await fetchBlob(fileUrl(repo, node)), node.name);
  }

  /** 選取項目的檔案與 zip 內路徑：資料夾保留「資料夾名/子路徑」，同名檔案自動加編號 */
  function zipEntries(nodes, rootName) {
    const out = [];
    const used = new Set();
    const unique = (name) => {
      if (!used.has(name)) {
        used.add(name);
        return name;
      }
      const dot = name.lastIndexOf('.');
      const [stem, ext] = dot > 0 ? [name.slice(0, dot), name.slice(dot)] : [name, ''];
      let i = 2;
      while (used.has(`${stem} (${i})${ext}`)) i += 1;
      const next = `${stem} (${i})${ext}`;
      used.add(next);
      return next;
    };
    const walk = (dir, prefix) => dir.children.forEach((c) => (
      c.type === 'dir' ? walk(c, `${prefix}${c.name}/`) : out.push({ file: c, name: `${prefix}${c.name}` })
    ));
    nodes.forEach((node) => {
      if (node.type === 'file') out.push({ file: node, name: unique(node.name) });
      else walk(node, `${unique(node.name || rootName)}/`);
    });
    return out;
  }

  function summary(nodes) {
    return nodes.reduce((acc, n) => (n.type === 'dir'
      ? { files: acc.files + n.stats.files, bytes: acc.bytes + n.stats.size }
      : { files: acc.files + 1, bytes: acc.bytes + (n.size || 0) }), { files: 0, bytes: 0 });
  }

  const needsConfirm = (nodes) => summary(nodes).bytes > CONFIRM_BYTES;

  /**
   * @param {{ onProgress: (done: number, total: number) => void, signal: AbortSignal }} opts
   * @returns {Promise<{ saved: number, failed: string[] }>}
   */
  async function downloadZip(repo, nodes, zipName, { onProgress, signal }) {
    const entries = zipEntries(nodes, repo.name);
    if (!entries.length) throw new Error(t('dl.noFiles'));
    const fflate = await loadFflate();

    const results = new Array(entries.length);
    const failed = [];
    let next = 0;
    let done = 0;

    const worker = async () => {
      while (next < entries.length) {
        const index = next;
        next += 1;
        const { file, name } = entries[index];
        try {
          const blob = await fetchBlob(fileUrl(repo, file), signal);
          results[index] = [name, new Uint8Array(await blob.arrayBuffer())];
        } catch (err) {
          if (signal.aborted) throw err;
          failed.push(file.path);
        }
        done += 1;
        onProgress(done, entries.length);
      }
    };
    await Promise.all(Array.from({ length: Math.min(CONCURRENCY, entries.length) }, worker));

    // 圖片本身已壓縮，level 0 只打包不壓縮，速度快很多
    const files = Object.fromEntries(results.filter(Boolean).map(([name, data]) => [name, [data, { level: 0 }]]));
    saveBlob(new Blob([fflate.zipSync(files)], { type: 'application/zip' }), `${zipName}.zip`);
    return { saved: entries.length - failed.length, failed };
  }

  GF.download = Object.freeze({ downloadFile, downloadZip, fetchBlob, summary, needsConfirm, zipEntries });
})(window.GF);
