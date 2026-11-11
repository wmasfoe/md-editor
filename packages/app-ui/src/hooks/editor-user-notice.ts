import { EDITOR_USER_NOTICE_EVENT, type EditorUserNoticeDetail } from "@md-editor/editor";

/** 把编辑器发出的用户提示交给宿主已经接好的 toast。 */
export function handleEditorUserNotice(
  event: Event,
  showToast: (message: string | null) => void,
): void {
  if (event.type !== EDITOR_USER_NOTICE_EVENT) {
    return;
  }
  const message = (event as CustomEvent<EditorUserNoticeDetail | undefined>).detail?.message;
  if (typeof message !== "string" || message.length === 0) {
    return;
  }
  showToast(message);
}

export function subscribeEditorUserNotice(
  target: EventTarget,
  showToast: (message: string | null) => void,
): () => void {
  const onNotice = (event: Event) => {
    handleEditorUserNotice(event, showToast);
  };
  target.addEventListener(EDITOR_USER_NOTICE_EVENT, onNotice);
  return () => target.removeEventListener(EDITOR_USER_NOTICE_EVENT, onNotice);
}
