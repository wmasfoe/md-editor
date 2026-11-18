/**
 * @fileoverview 会话与历史版本文档恢复辅助契约 (Session & History Revert Helpers)
 */

import type { DocumentMutationResult, DocumentState } from "../document-state.ts";

export interface RestoreDraftOptions {
  readonly mode?: "wysiwyg" | "source";
  /**
   * 草稿中记录的光标偏移。超出草稿长度时由本函数夹取到文档末尾（不抛错）。
   *
   * 光标语义属于文档模型：调用方只负责把持久化值原样传入，
   * 不得在适配层自行 clamp，否则两条恢复路径会产生不一致的边界行为。
   */
  readonly cursorOffset?: number;
}

/** 将持久化的光标偏移夹取到合法区间；非法输入（负数/NaN/Infinity）回退到文档末尾 */
export function clampCursorOffset(cursorOffset: number | undefined, markdown: string): number {
  if (cursorOffset === undefined || !Number.isFinite(cursorOffset)) {
    return markdown.length;
  }
  return Math.min(Math.max(Math.trunc(cursorOffset), 0), markdown.length);
}

/**
 * 将未保存草稿恢复到文档状态机中
 * 保持 savedMarkdown 为原物理磁盘内容，从而使 isDirty === true 自动成立（标题带 *）
 */
export function restoreDraftToDocument(
  documentState: DocumentState,
  draftMarkdown: string,
  options: RestoreDraftOptions = {},
): DocumentMutationResult & { readonly cursorOffset: number } {
  const current = documentState.getSnapshot();
  const result = documentState.replaceDocument(
    {
      markdown: draftMarkdown,
      savedMarkdown: current.savedMarkdown,
      filePath: current.filePath,
      mode: options.mode ?? current.mode,
      replaceIntent: "same",
    },
    { kind: "command", commandId: "session.restoreDraft" },
  );
  // 光标偏移随恢复结果一并返回：调用方（编辑器宿主）负责把选区设到这个位置，
  // 文档模型只提供夹取后的权威值，不直接操纵视图。
  return { ...result, cursorOffset: clampCursorOffset(options.cursorOffset, draftMarkdown) };
}

/**
 * 将文档恢复/回退到指定的历史版本快照
 * 保持同一文档身份 (replaceIntent: "same") 以保留阅读视口
 */
export function revertDocumentToSnapshot(
  documentState: DocumentState,
  snapshotMarkdown: string,
): DocumentMutationResult {
  const current = documentState.getSnapshot();
  return documentState.replaceDocument(
    {
      markdown: snapshotMarkdown,
      savedMarkdown: current.savedMarkdown,
      filePath: current.filePath,
      mode: current.mode,
      replaceIntent: "same",
    },
    { kind: "command", commandId: "history.revertSnapshot" },
  );
}
