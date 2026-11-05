import { Transaction } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** 宿主把这条事件转成应用内已有的 toast。编辑器包不直接依赖桌面/Web 的 React 通知。 */
export const EDITOR_USER_NOTICE_EVENT = "md-editor:user-notice";

export interface EditorUserNoticeDetail {
  readonly message: string;
}

/**
 * 同时走两路：屏幕阅读器（CodeMirror announce）和窗口事件（宿主 toast）。
 * 行内提示由调用方自己画；这里不假设宿主一定监听了事件。
 */
export function dispatchEditorUserNotice(view: EditorView, message: string): void {
  view.dom.ownerDocument.defaultView?.dispatchEvent(
    new CustomEvent<EditorUserNoticeDetail>(EDITOR_USER_NOTICE_EVENT, {
      detail: { message },
    }),
  );
  try {
    view.dispatch({
      effects: EditorView.announce.of(message),
      annotations: Transaction.addToHistory.of(false),
    });
  } catch {
    // 父视图正在销毁时 announce 可能抛错。toast 事件已经发出。
  }
}
