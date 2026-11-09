/**
 * @file edit-feedback-buffer.ts
 * @description
 * 采纳 AI 建议后“用户又改了什么”的内存缓冲。
 *
 * 采纳时只在内存中保留 AI 原文（按文件），保存文档时与当前正文对比，
 * 提取写作偏好特征写入本地画像，然后立即丢弃原文；任何 AI 原文都不会落盘。
 */
import {
  appendEditFeatures,
  collectEditFeatures,
  type StyleProfileDocument,
} from "@md-editor/ai/style";

/** 每个文件最多暂存的采纳文本条数 */
const MAX_PENDING_PER_FILE = 50;

const pending = new Map<string, string[]>();

function key(workspaceId: string, relPath: string): string {
  return `${workspaceId}\u0000${relPath}`;
}

/** 记录一次采纳的 AI 文本（仅内存） */
export function rememberAcceptedAiText(workspaceId: string, relPath: string, text: string): void {
  const entry = key(workspaceId, relPath);
  const texts = pending.get(entry) ?? [];
  texts.push(text);
  pending.set(entry, texts.slice(-MAX_PENDING_PER_FILE));
}

/**
 * 文档保存后调用：对比暂存的 AI 原文与保存后的正文，提取编辑特征写入画像，并清空该文件的暂存。
 * 没有暂存或没有提取到特征时返回原文档。
 */
export function flushEditFeedback(
  document: StyleProfileDocument,
  workspaceId: string,
  relPath: string,
  savedMarkdown: string,
  at: string,
): StyleProfileDocument {
  const entry = key(workspaceId, relPath);
  const texts = pending.get(entry);
  pending.delete(entry);
  if (!texts?.length) return document;
  const features = collectEditFeatures(texts, savedMarkdown, at);
  if (features.length === 0) return document;
  return {
    ...document,
    workspaces: document.workspaces.map((workspace) =>
      workspace.id === workspaceId
        ? { ...workspace, editFeedback: appendEditFeatures(workspace.editFeedback, features) }
        : workspace,
    ),
  };
}

/** 关闭风格学习或清除数据时丢弃全部暂存 */
export function clearPendingEditFeedback(): void {
  pending.clear();
}

/** 仅测试使用：当前暂存条数 */
export function pendingEditFeedbackSize(): number {
  let total = 0;
  for (const texts of pending.values()) total += texts.length;
  return total;
}
