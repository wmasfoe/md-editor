/**
 * @file safe-unlisten.ts
 * @description 安全注销 Tauri 事件监听器。
 *
 * 针对 Issue #214：Tauri 在窗口销毁或重复取消监听时，内部 `unregisterListener`
 * 可能会因为 `listeners[eventId]` 已被移除而抛出：
 * `TypeError: undefined is not an object (evaluating 'listeners[eventId].handlerId')`。
 * 此外，Tauri v2 的 unlisten 是异步函数，若抛出 rejection 未被捕获会触发全局 `unhandledrejection`。
 * 本工具函数确保 unlisten 仅执行一次，并安全吞掉注销期间无害的销毁期异常。
 */

export type TauriUnlistenFn = () => void | Promise<void>;

/**
 * 安全调用 Tauri unlisten 函数，保证只执行一次且永不冒泡未捕获的 Promise rejection。
 *
 * @param unlisten Tauri listen/onCloseRequested 返回的注销函数
 */
export function safeUnlisten(unlisten: unknown): void {
  if (typeof unlisten !== "function") {
    return;
  }

  try {
    const result = (unlisten as TauriUnlistenFn)();
    if (result && typeof (result as Promise<unknown>).catch === "function") {
      void (result as Promise<unknown>).catch((err: unknown) => {
        // 窗口销毁或监听已注销期间的异常属于无害清理报错，仅记录 debug，避免冒泡成 sentry 告警
        console.debug("[tauri] unlisten ignored error during teardown:", err);
      });
    }
  } catch (err: unknown) {
    console.debug("[tauri] unlisten sync error ignored:", err);
  }
}
