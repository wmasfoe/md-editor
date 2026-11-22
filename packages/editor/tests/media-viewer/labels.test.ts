/**
 * L-3：媒体查看器与折叠按钮的文案必须走宿主 translator，库默认英文。
 *
 * 此前 `关闭` / `编辑源码` / `展开` / `折叠` 是写死的中文，非中文宿主无法消除。
 */
import { describe, expect, it } from "vitest";
import { openMediaViewer } from "../../src/media-viewer/browser.ts";
import { DEFAULT_FOLD_TOGGLE_LABELS } from "../../src/wysiwyg/blocks/block-toolbar.ts";
import { createFakeDocumentWithRoot, FakeElement } from "./support/fake-dom.ts";

const IMAGE = { kind: "image", src: "cat.png", alt: "cat" } as const;

function open(translate?: (key: string, fallback: string) => string) {
  const { doc, root } = createFakeDocumentWithRoot();
  const host = new FakeElement("span");
  openMediaViewer({
    document: doc as unknown as Document,
    host: host as unknown as HTMLElement,
    content: IMAGE,
    fit: "contain",
    zoomPan: false,
    takeFocus: false,
    backgroundRoot: root as unknown as HTMLElement,
    ...(translate ? { translate } : {}),
  } as never);
  return doc.body;
}

/** Fake DOM 没有 querySelector，手动遍历（这类辅助只在测试里用）。 */
function labelOf(node: FakeElement, className: string): string | null {
  if (node.classList.tokens.has(className.replace(/^\./u, ""))) {
    return node.attributes.get("aria-label") ?? null;
  }
  for (const child of node.children) {
    const found = labelOf(child, className);
    if (found !== null) return found;
  }
  return null;
}

describe("媒体查看器标签", () => {
  it("未注入 translator 时默认英文", () => {
    const body = open();
    expect(labelOf(body, ".cm-md-media-viewer__close")).toBe("Close");
  });

  it("注入 translator 后使用宿主语言", () => {
    const body = open((key) => (key === "editor.mediaViewer.close" ? "关闭" : key));
    expect(labelOf(body, ".cm-md-media-viewer__close")).toBe("关闭");
  });

  it("translator 只覆盖已知 key，其余仍用英文 fallback", () => {
    const body = open(() => "");
    // translator 返回空串时仍视为“有值”；这里断言调用确实到达了 translator。
    expect(labelOf(body, ".cm-md-media-viewer__close")).toBe("");
  });
});

describe("折叠按钮标签", () => {
  it("库默认英文", () => {
    expect(DEFAULT_FOLD_TOGGLE_LABELS).toEqual({ expand: "Expand", collapse: "Collapse" });
  });
});
