// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { EditorToast } from "../../src/app/AppWindowChrome";

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

describe("I-6: toast action (undo)", () => {
  it("renders the undo action and runs it on click", async () => {
    const run = vi.fn();
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(
        createElement(EditorToast, {
          toast: {
            id: 1,
            message: "已识别工作区移动，写作偏好已跟随",
            action: { label: "撤销找回", run },
          },
        }),
      ),
    );

    const button = [...container.querySelectorAll("button")].find((b) =>
      b.textContent?.includes("撤销找回"),
    )!;
    expect(button).toBeTruthy();
    act(() => button.click());
    expect(run).toHaveBeenCalledTimes(1);
    // 点击操作后提示关闭。
    expect(container.querySelector("[role=alert]")).toBeNull();

    act(() => root.unmount());
    container.remove();
  });

  it("renders no action button for a plain toast", async () => {
    const container = document.createElement("div");
    document.body.append(container);
    const root = createRoot(container);
    await act(async () =>
      root.render(createElement(EditorToast, { toast: { id: 2, message: "已保存" } })),
    );
    expect(container.querySelector("button")).toBeNull();
    act(() => root.unmount());
    container.remove();
  });
});
