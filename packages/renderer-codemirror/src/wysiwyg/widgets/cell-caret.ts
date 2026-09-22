/**
 * @file cell-caret.ts
 * @description 表格单元格（contenteditable）内的 DOM 光标读写 —— bracket-escape 的**表格 DOM 适配器**。
 *
 * ## 为什么需要单独一层
 * 表格是 `ATOMIC_WIDGET_KINDS` 里的 **replace widget**，单元格是 `contenteditable` 的
 * **未提交 DOM 文本**，不是文档坐标空间。`markdown/range-index.ts:410-418` 明确在
 * table-widget 记录处停止下钻（"cell content must not be promoted to inline atom records"），
 * 因此 `link-projection.ts` 的 link range **无法**服务单元格内 link。
 *
 * 本模块只负责「DOM ⇄ (text, offset)」的搬运；**判定语义**归
 * `bracket-escape.ts` 的 `detectBracketUnit`（纯函数），两侧适配器共用一份语义，
 * 这正是 Architect 共识评审 Synthesis 的「分布式派发，单一语义」。
 */

import { detectBracketUnitInCell } from "../bracket-escape.ts";

const NODE_TEXT = 4; // NodeFilter.SHOW_TEXT（避免依赖 DOM lib 常量）

/** 读取 cell 内的纯文本与光标偏移；任何不确定性一律 fail closed 返回 null */
function readCaret(cell: HTMLElement): { text: string; offset: number } | null {
  const doc = cell.ownerDocument;
  const selection = doc.defaultView?.getSelection?.() ?? null;
  if (selection === null || selection.rangeCount === 0) {
    return null;
  }
  const range = selection.getRangeAt(0);
  if (!cell.contains(range.startContainer)) {
    return null;
  }
  // 累计文本节点偏移，得到「cell 纯文本坐标系」下的光标位置
  const walker = doc.createTreeWalker(cell, NODE_TEXT);
  let total = 0;
  let node = walker.nextNode() as Node | null;
  while (node !== null) {
    const value = node.textContent ?? "";
    if (node === range.startContainer) {
      const offset = total + Math.min(range.startOffset, value.length);
      return { text: cell.textContent ?? "", offset };
    }
    total += value.length;
    node = walker.nextNode() as Node | null;
  }
  return null;
}

/** 把光标写回 cell 纯文本坐标系的 `target` 位置；失败则 fail closed 不动光标 */
function writeCaret(cell: HTMLElement, target: number): boolean {
  const doc = cell.ownerDocument;
  const selection = doc.defaultView?.getSelection?.() ?? null;
  if (selection === null) {
    return false;
  }
  const walker = doc.createTreeWalker(cell, NODE_TEXT);
  let total = 0;
  let node = walker.nextNode() as Node | null;
  while (node !== null) {
    const value = node.textContent ?? "";
    const end = total + value.length;
    if (target <= end) {
      const range = doc.createRange();
      range.setStart(node, Math.max(0, Math.min(target - total, value.length)));
      range.collapse(true);
      selection.removeAllRanges();
      selection.addRange(range);
      return true;
    }
    total = end;
    node = walker.nextNode() as Node | null;
  }
  return false;
}

/**
 * 表格单元格内的括号/link 跳出。
 *
 * **纯 DOM selection 移动，零文档变更** —— 这是 T20-cell「undo 栈无新增、
 * 保存产物字节相同」的实现保证；调用方必须在 `flushCellCommit` 之前调用本函数。
 *
 * @returns 是否发生了跳出（true 时调用方应拦截该 Tab，不再跳格/commit）
 */
export function escapeBracketInCellDom(cell: HTMLElement): boolean {
  const read = readCaret(cell);
  if (read === null) {
    return false;
  }
  const unit = detectBracketUnitInCell(read.text, read.offset);
  if (unit === null) {
    return false;
  }
  return writeCaret(cell, unit.to);
}
