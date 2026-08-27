import { useSyncExternalStore } from "react";
import type { DocumentSnapshot } from "@md-editor/editor-core";
import { runtime } from "./runtime/editor-runtime";

/**
 * 订阅 document snapshot 的 React hook。
 *
 * 任何组件都可以直接调用这个 hook，不需要从 App 顶层接收 snapshot prop。
 * 当 runtime.document 提交语义 transition 后，所有 snapshot 订阅组件会自动重新渲染。
 *
 * @example
 * function MyComponent() {
 *   const snapshot = useDocumentSnapshot();
 *   return <div>{snapshot.filePath}</div>;
 * }
 */
export function useDocumentSnapshot(): DocumentSnapshot {
  return useSyncExternalStore(runtime.document.subscribe, runtime.document.getSnapshot);
}
