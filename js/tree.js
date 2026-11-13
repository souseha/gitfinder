/* 把 GitHub 的扁平 tree 清單轉成資料夾樹，並提供搜尋 / 展開等查詢 */
(function (GF) {
  'use strict';

  const { extOf, isImage } = GF.util;
  const collator = new Intl.Collator('zh-Hant', { numeric: true, sensitivity: 'base' });

  const parentOf = (path) => (path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '');

  function makeNode(path, type, size, parent, change = null) {
    const name = path.slice(path.lastIndexOf('/') + 1);
    return {
      name,
      path,
      type,
      size: size == null ? null : size,
      ext: type === 'file' ? extOf(name) : '',
      // 圖示上的標籤只顯示真正的副檔名（例如 Makefile 不顯示）
      label: type === 'file' && name.lastIndexOf('.') > 0 ? extOf(name) : '',
      parent,
      children: type === 'dir' ? [] : null,
      stats: null,
      // commit 檢視才有：檔案的變動狀態、資料夾內各狀態的數量
      change,
      changes: null,
    };
  }

  const CHANGE_KINDS = Object.freeze(['added', 'removed', 'renamed', 'modified']);

  function computeChanges(dir) {
    const counts = Object.fromEntries(CHANGE_KINDS.map((k) => [k, 0]));
    for (const child of dir.children) {
      if (child.type === 'dir') {
        computeChanges(child);
        CHANGE_KINDS.forEach((k) => { counts[k] += child.changes[k]; });
      } else if (child.change && child.change.status in counts) {
        counts[child.change.status] += 1;
      }
    }
    dir.changes = Object.freeze(counts);
  }

  function compare(a, b) {
    if (a.type !== b.type) return a.type === 'dir' ? -1 : 1;
    return collator.compare(a.name, b.name);
  }

  function computeStats(dir) {
    let files = 0;
    let images = 0;
    let size = 0;
    for (const child of dir.children) {
      if (child.type === 'dir') {
        computeStats(child);
        files += child.stats.files;
        images += child.stats.images;
        size += child.stats.size;
      } else {
        files += 1;
        if (isImage(child)) images += 1;
        size += child.size || 0;
      }
    }
    dir.stats = Object.freeze({ files, images, size });
  }

  /** 建樹（只在建構期間組裝節點，完成後不再修改） */
  function buildTree(entries) {
    const root = makeNode('', 'dir', null, null);
    const byPath = new Map([['', root]]);

    const ensureDir = (path) => {
      const existing = byPath.get(path);
      if (existing) return existing;
      const parent = ensureDir(parentOf(path));
      const node = makeNode(path, 'dir', null, parent);
      parent.children.push(node);
      byPath.set(path, node);
      return node;
    };

    for (const entry of entries) {
      if (entry.type === 'tree') {
        ensureDir(entry.path);
      } else if (entry.type === 'blob' && !byPath.has(entry.path)) {
        const parent = ensureDir(parentOf(entry.path));
        const node = makeNode(entry.path, 'file', entry.size, parent, entry.change || null);
        parent.children.push(node);
        byPath.set(entry.path, node);
      }
    }

    const all = [];
    for (const node of byPath.values()) {
      if (node.children) node.children.sort(compare);
      if (node !== root) all.push(node);
    }
    computeStats(root);
    if (entries.some((e) => e.change)) computeChanges(root);
    return Object.freeze({ root, byPath, all });
  }

  function ancestors(node) {
    const chain = [];
    for (let n = node; n; n = n.parent) chain.unshift(n);
    return chain;
  }

  /** 空白分隔多個關鍵字；含「/」的關鍵字比對完整路徑，其餘比對檔名 */
  function search(all, query, limit = 5000) {
    const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    const out = [];
    for (const node of all) {
      const name = node.name.toLowerCase();
      const path = node.path.toLowerCase();
      if (terms.every((t) => (t.includes('/') ? path.includes(t) : name.includes(t)))) {
        out.push(node);
        if (out.length >= limit) break;
      }
    }
    return out;
  }

  function flatten(dir, expanded, filter, depth = 0, out = []) {
    for (const child of dir.children) {
      if (!filter(child)) continue;
      out.push({ node: child, depth });
      if (child.type === 'dir' && expanded.has(child.path)) flatten(child, expanded, filter, depth + 1, out);
    }
    return out;
  }

  GF.tree = Object.freeze({ buildTree, ancestors, search, flatten });
})(window.GF);
