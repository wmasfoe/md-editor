import { isTauri } from "@tauri-apps/api/core";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isDiscardProtectionRequired } from "../controller/document-save";
import { runtime } from "../runtime/editor-runtime";
import { saveHotExitSession } from "../controller/session-controller";

function preventProtectedDocumentUnload(event: BeforeUnloadEvent) {
  const snapshot = runtime.document.getSnapshot();
  if (!isDiscardProtectionRequired(snapshot)) {
    return;
  }

  void saveHotExitSession(snapshot);
  event.preventDefault();
  event.returnValue = "";
}

export function bindBrowserDirtyDocumentGuard() {
  window.addEventListener("beforeunload", preventProtectedDocumentUnload);
  return () => window.removeEventListener("beforeunload", preventProtectedDocumentUnload);
}

export function bindTauriCloseGuard(confirmClose: () => Promise<boolean>) {
  let unlisten: (() => void) | undefined;

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
      void saveHotExitSession(snapshot).catch((err) => {
        console.error("Hot Exit 暂存草稿失败", err);
      });

      void confirmClose().then((allowed) => {
        if (allowed) {
          void getCurrentWindow().destroy();
        }
      });
    })
    .then((dispose) => {
      unlisten = dispose;
    });

  return () => {
    unlisten?.();
  };
}
