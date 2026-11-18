import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { safeUnlisten } from "../../desktop/safe-unlisten";
import { isDiscardProtectionRequired } from "@md-editor/core";
import { runtime } from "../runtime/editor-runtime";
import { saveHotExitSession } from "../controller/session-controller";

/**
 * 光标快照读取端口。
 *
 * Hot Exit 写入侧需要知道用户离开时的光标位置，但 `window-guards` 是模块级函数，
 * 不持有 React 上下文；因此由调用方在绑定守卫时注入这个只读能力。
 * 拿不到（编辑器未挂载）时返回 `null`，由会话层回退到默认值。
 */
export type CursorSnapshotReader = () => number | null;

function readCursorOffset(readCursor: CursorSnapshotReader | undefined): number | null {
  if (!readCursor) {
    return null;
  }
  try {
    const offset = readCursor();
    return typeof offset === "number" && Number.isFinite(offset) ? offset : null;
  } catch {
    // 关闭路径不能因为读取光标失败而阻塞退出。
    return null;
  }
}

function preventProtectedDocumentUnload(
  event: BeforeUnloadEvent,
  readCursor: CursorSnapshotReader | undefined,
) {
  const snapshot = runtime.document.getSnapshot();
  if (!isDiscardProtectionRequired(snapshot)) {
    return;
  }

  void saveHotExitSession(snapshot, readCursorOffset(readCursor));
  event.preventDefault();
  event.returnValue = "";
}

export function bindBrowserDirtyDocumentGuard(readCursor?: CursorSnapshotReader) {
  const handler = (event: BeforeUnloadEvent) => preventProtectedDocumentUnload(event, readCursor);
  window.addEventListener("beforeunload", handler);
  return () => window.removeEventListener("beforeunload", handler);
}

export function bindTauriCloseGuard(
  confirmClose: () => Promise<boolean>,
  readCursor?: CursorSnapshotReader,
) {
  let unlisten: (() => void | Promise<void>) | undefined;
  let disposed = false;

  if (!isTauri()) {
    return undefined;
  }

  void getCurrentWindow()
    .onCloseRequested((event) => {
      const snapshot = runtime.document.getSnapshot();
      if (!isDiscardProtectionRequired(snapshot)) {
        return;
      }

      // 原生关闭事件必须同步 preventDefault 取消，随后异步处理
      event.preventDefault();

      // 作为 Cmd+Q / 强关 / 意外中断的毫秒级兜底：先快速暂存草稿
      void saveHotExitSession(snapshot, readCursorOffset(readCursor)).catch((err) => {
        console.error("Hot Exit 暂存草稿失败", err);
      });

      void confirmClose().then((allowed) => {
        if (allowed) {
          void getCurrentWindow().destroy();
        }
      });
    })
    .then((dispose) => {
      if (disposed) {
        safeUnlisten(dispose);
        return;
      }
      unlisten = dispose;
    })
    .catch((err: unknown) => {
      console.debug("[tauri] bindTauriCloseGuard failed:", err);
    });

  return () => {
    disposed = true;
    const fn = unlisten;
    unlisten = undefined;
    safeUnlisten(fn);
  };
}
