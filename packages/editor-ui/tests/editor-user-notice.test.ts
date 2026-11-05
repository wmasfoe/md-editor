import { describe, expect, it, vi } from "vitest";
import { EDITOR_USER_NOTICE_EVENT } from "@md-editor/renderer-codemirror";
import { handleEditorUserNotice, subscribeEditorUserNotice } from "../src/hooks/editor-user-notice";

describe("editor user notice", () => {
  it("forwards a non-empty editor notice into the host toast", () => {
    const showToast = vi.fn();
    const target = new EventTarget();
    const stop = subscribeEditorUserNotice(target, showToast);

    target.dispatchEvent(
      new CustomEvent(EDITOR_USER_NOTICE_EVENT, {
        detail: { message: "未能保存 HTML 块：原内容已不在文档中。" },
      }),
    );
    target.dispatchEvent(new CustomEvent(EDITOR_USER_NOTICE_EVENT, { detail: { message: "" } }));
    target.dispatchEvent(new Event("something-else"));

    expect(showToast).toHaveBeenCalledTimes(1);
    expect(showToast).toHaveBeenCalledWith("未能保存 HTML 块：原内容已不在文档中。");

    stop();
    target.dispatchEvent(
      new CustomEvent(EDITOR_USER_NOTICE_EVENT, { detail: { message: "再次提示" } }),
    );
    expect(showToast).toHaveBeenCalledTimes(1);
  });

  it("ignores notices whose detail is not a string", () => {
    const showToast = vi.fn();
    handleEditorUserNotice(
      new CustomEvent(EDITOR_USER_NOTICE_EVENT, { detail: { message: 12 } }),
      showToast,
    );
    expect(showToast).not.toHaveBeenCalled();
  });
});
