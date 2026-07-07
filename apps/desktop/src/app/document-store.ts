import { useSyncExternalStore } from "react";
import type { DocumentSnapshot, EditorMode } from "@md-editor/editor-core";
import type { Markdown } from "@md-editor/shared";
import { runtime } from "./runtime/editor-runtime";

/**
 * 订阅 document snapshot 的 React hook。
 *
 * 任何组件都可以直接调用这个 hook，不需要从 App 顶层接收 snapshot prop。
 * 当 runtime.document 的任何 mutation 发生时（updateMarkdown/markSaved/setMode 等），
 * 所有订阅的组件会自动重新渲染。
 *
 * @example
 * function MyComponent() {
 *   const snapshot = useDocumentSnapshot();
 *   return <div>{snapshot.filePath}</div>;
 * }
 */
export function useDocumentSnapshot(): DocumentSnapshot {
  return useSyncExternalStore(
    runtime.document.subscribe,
    runtime.document.getSnapshot
  );
}

/**
 * 便捷的 mutation 函数：更新 markdown 内容。
 *
 * 调用后会自动通知所有 useDocumentSnapshot() 订阅者重新渲染。
 * 不再需要手动 setSnapshot。
 */
export function updateDocumentMarkdown(markdown: Markdown): void {
  runtime.document.updateMarkdown(markdown);
}

/**
 * 便捷的 mutation 函数：标记文档已保存。
 */
export function markDocumentSaved(input?: {
  readonly markdown?: Markdown;
  readonly filePath?: string | null;
}): void {
  runtime.document.markSaved(input);
}

/**
 * 便捷的 mutation 函数：更新保存基线（用于另存为等场景）。
 */
export function updateDocumentSavedBaseline(input: {
  readonly markdown: Markdown;
  readonly filePath?: string | null;
}): void {
  runtime.document.updateSavedBaseline(input);
}

/**
 * 便捷的 mutation 函数：切换编辑模式。
 */
export function setDocumentMode(mode: EditorMode): void {
  runtime.document.setMode(mode);
}
