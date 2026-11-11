/**
 * @fileoverview 会话与历史版本文档恢复辅助契约 (Session & History Revert Helpers)
 */

import type { DocumentMutationResult, DocumentState } from "../document-state.ts";

export interface RestoreDraftOptions {
  readonly mode?: "wysiwyg" | "source";
}

/**
 * 将未保存草稿恢复到文档状态机中
 * 保持 savedMarkdown 为原物理磁盘内容，从而使 isDirty === true 自动成立（标题带 *）
 */
export function restoreDraftToDocument(
  documentState: DocumentState,
  draftMarkdown: string,
  options: RestoreDraftOptions = {},
): DocumentMutationResult {
  const current = documentState.getSnapshot();
  return documentState.replaceDocument(
    {
      markdown: draftMarkdown,
      savedMarkdown: current.savedMarkdown,
      filePath: current.filePath,
      mode: options.mode ?? current.mode,
      replaceIntent: "same",
    },
    { kind: "command", commandId: "session.restoreDraft" },
  );
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
