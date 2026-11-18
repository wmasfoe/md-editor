// @vitest-environment jsdom

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { listen } from "@tauri-apps/api/event";
import { bindDesktopSelectAllMenuAction } from "../../src/desktop/menu-events";

vi.mock("@tauri-apps/api/core", () => ({ isTauri: () => true }));
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn(async () => vi.fn()),
}));

function selectAll(): void {
  const event = "md-editor-menu-select-all";
  bindDesktopSelectAllMenuAction();
  expect(listen).toHaveBeenCalledWith(event, expect.any(Function));
  const [, callback] = vi.mocked(listen).mock.calls[0]!;
  callback({ event, id: 1, payload: null });
}

describe("desktop Select All menu action", () => {
  const selectWebViewText = vi.fn();

  beforeEach(() => {
    Object.defineProperty(document, "execCommand", {
      configurable: true,
      value: selectWebViewText,
    });
    document.body.innerHTML =
      '<div class="cm-content" tabindex="0"><div tabindex="0" contenteditable></div></div><input type="search">';
  });

  afterEach(() => {
    Reflect.deleteProperty(document, "execCommand");
    document.body.replaceChildren();
    vi.clearAllMocks();
  });

  it("sends the editor shortcut to the focused content, without invoking DOM selection", () => {
    const content = document.querySelector<HTMLElement>(".cm-content")!;
    const onKeyDown = vi.fn();
    content.focus();
    content.addEventListener("keydown", onKeyDown);

    selectAll();

    expect(onKeyDown).toHaveBeenCalledTimes(1);
    expect(onKeyDown).toHaveBeenCalledWith(
      expect.objectContaining({
        target: content,
        key: "a",
        code: "KeyA",
        metaKey: true,
        ctrlKey: false,
        bubbles: true,
        cancelable: true,
      }),
    );
    expect(selectWebViewText).not.toHaveBeenCalled();
  });

  it("delegates selection to the webview when the search field has focus", () => {
    const input = document.querySelector("input")!;
    input.focus();

    selectAll();

    expect(selectWebViewText).toHaveBeenCalledTimes(1);
    expect(selectWebViewText).toHaveBeenCalledWith("selectAll");
    expect(document.activeElement).toBe(input);
  });

  it("lets an editable widget handle the shortcut while it owns focus", () => {
    const widget = document.querySelector<HTMLElement>("[contenteditable]")!;
    const onKeyDown = vi.fn();
    widget.focus();
    widget.addEventListener("keydown", onKeyDown);

    selectAll();

    expect(onKeyDown).toHaveBeenCalledWith(expect.objectContaining({ target: widget, key: "a" }));
    expect(selectWebViewText).not.toHaveBeenCalled();
  });
});
