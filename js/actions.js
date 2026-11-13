/* 共用動作：下載（含進度面板）、複製名稱 / 路徑 / 連結 / 圖片 */
(function (GF) {
  'use strict';

  const { formatSize } = GF.util;
  const { rawUrl, webUrl } = GF.github;
  const { t } = GF.i18n;
  const D = GF.download;
  const A = GF.app;

  const $ = (id) => document.getElementById(id);
  const panel = { root: $('dl'), text: $('dl-text'), fill: $('dl-fill'), cancel: $('dl-cancel') };
  let job = null; // { controller }

  const errMsg = (err) => (err instanceof Error ? err.message : String(err));

  function showProgress(text, ratio) {
    panel.root.classList.remove('hidden');
    panel.text.textContent = text;
    panel.fill.style.width = `${Math.round(ratio * 100)}%`;
  }
  const hideProgress = () => panel.root.classList.add('hidden');
  panel.cancel.addEventListener('click', () => job && job.controller.abort());

  async function runJob(label, task) {
    if (job) {
      A.toast(t('dl.busy'));
      return;
    }
    const controller = new AbortController();
    job = { controller };
    try {
      await task(controller.signal);
    } catch (err) {
      A.toast(controller.signal.aborted ? t('dl.cancelled') : t('dl.fail', { msg: errMsg(err) }), controller.signal.aborted ? 'info' : 'error');
    } finally {
      job = null;
      hideProgress();
    }
  }

  /** 單一檔案直接下載；資料夾或多個項目打包成 zip */
  function downloadNodes(nodes) {
    const { repo, cwd } = A.state;
    if (!repo || !nodes.length) return;
    if (nodes.length === 1 && nodes[0].type === 'file') {
      const node = nodes[0];
      return runJob(node.name, async () => {
        showProgress(t('dl.single', { name: node.name }), 0.5);
        await D.downloadFile(repo, node);
      });
    }
    const single = nodes.length === 1 ? nodes[0] : null;
    const name = single ? single.name || repo.name : (cwd && cwd.name) || repo.name;
    const { files, bytes } = D.summary(nodes);
    if (D.needsConfirm(nodes) && !window.confirm(t('dl.confirm', { name, files, size: formatSize(bytes) }))) return;
    return runJob(name, async (signal) => {
      showProgress(t('dl.preparing', { name }), 0);
      const result = await D.downloadZip(repo, nodes, name, {
        signal,
        onProgress: (done, total) => showProgress(t('dl.progress', { name, done, total }), done / total),
      });
      showProgress(t('dl.zipping', { name }), 1);
      if (result.failed.length) A.toast(t('dl.partial', { ok: result.saved, fail: result.failed.length }), 'error');
      else A.toast(t('dl.done', { name: `${name}.zip`, n: result.saved }));
    });
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      A.toast(t('toast.copied'));
    } catch {
      A.toast(t('toast.copyFail'), 'error');
    }
  }

  const copyNames = (nodes) => nodes.length && copyText(nodes.map((n) => n.name || A.state.repo.name).join('\n'));
  const copyPaths = (nodes) => nodes.length && copyText(nodes.map((n) => n.path || '/').join('\n'));
  const copyRawLink = (node) => copyText(rawUrl(A.state.repo, node.path));
  const copyGhLink = (node) => copyText(webUrl(A.state.repo, node));

  /** 剪貼簿只接受 PNG：其他格式先畫到 canvas 轉檔 */
  async function toPng(blob) {
    if (blob.type === 'image/png') return blob;
    const url = URL.createObjectURL(blob);
    try {
      const img = new Image();
      img.src = url;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.naturalWidth || 512;
      canvas.height = img.naturalHeight || 512;
      canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
      return await new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('toBlob'))), 'image/png'));
    } finally {
      URL.revokeObjectURL(url);
    }
  }

  async function copyImage(node) {
    try {
      // 傳 Promise 給 ClipboardItem，Safari 才會保留使用者手勢
      const png = D.fetchBlob(rawUrl(A.state.repo, node.path)).then(toPng);
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': png })]);
      A.toast(t('toast.copiedImage'));
    } catch {
      A.toast(t('toast.copyFail'), 'error');
    }
  }

  const openOnGitHub = (node) => window.open(webUrl(A.state.repo, node), '_blank', 'noopener');
  const openInNewTab = (repo, path) => window.open(GF.github.routeUrl(repo, path), '_blank', 'noopener');

  GF.actions = Object.freeze({
    downloadNodes, copyText, copyNames, copyPaths, copyRawLink, copyGhLink, copyImage, openOnGitHub, openInNewTab,
  });
})(window.GF);
