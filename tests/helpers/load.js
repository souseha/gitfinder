// 在模擬的瀏覽器環境（happy-dom）裡依序執行 js/ 底下的腳本，回傳 window.GF
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import vm from 'node:vm';

const JS_DIR = resolve(import.meta.dirname, '../../js');

export function loadScripts(...names) {
  for (const name of names) {
    const filename = resolve(JS_DIR, `${name}.js`);
    vm.runInThisContext(readFileSync(filename, 'utf8'), { filename });
  }
  return window.GF;
}

/** 依序載入核心模組（不含需要完整頁面 DOM 的 app / events） */
export const loadCore = () => loadScripts('i18n', 'util', 'github', 'tree', 'virtual');
