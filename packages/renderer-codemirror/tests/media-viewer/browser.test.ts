/**
 * `media-viewer/browser.ts` 的 **node 级适配测试**——补上"本次唯一零 node 测试文件"的缺口
 * （评审 r3 L-3/L-9、r4 点名）。
 *
 * 覆盖（原先只能靠 e2e 盲测的部分）：
 * - 组装：浮层根进入 `body`、dialog 语义属性齐全、内容节点就位；
 * - 样式自持：`<style>` 注入 `head` 且**幂等**（第二次 open 不再重复注入）；
 * - 模态诚实化：`#root` 置 `inert`，关闭后恢复；
 * - 监听成对：`document` **捕获相** keydown 注册 → 关闭时注销；
 * - 句柄登记：同 host 重复 open 只保留最新浮层；`closeMediaViewerFor` 未登记时幂等；
 * - 键盘：`Escape` 经 document 捕获相关闭浮层并 `preventDefault`；
 * - 指针捕获：`pointerdown` 捕获、`pointerup` 释放（拖拽健壮性）。
 *
 * 能力边界（诚实）：fake DOM 不解析 HTML ⇒ 只驱动**图片路径**（`createElement("img")`）；
 * SVG 路径的 `stage.innerHTML = svg` + `querySelector("svg")` 由 e2e 覆盖。
 */
import { describe, expect, it } from "vitest";
import { closeMediaViewerFor, openMediaViewer } from "../../src/media-viewer/browser.ts";
import { VIEWER_STYLE_ELEMENT_ID } from "../../src/media-viewer/styles.ts";
import { createFakeDocumentWithRoot, FakeElement, type FakeDocument } from "./support/fake-dom.ts";

const IMAGE_CONTENT = { kind: "image", src: "cat.png", alt: "猫" } as const;

interface Harness {
  readonly doc: FakeDocument;
  readonly backgroundRoot: FakeElement;
  readonly host: FakeElement;
  readonly handle: ReturnType<typeof openMediaViewer>;
  readonly overlays: () => readonly FakeElement[];
}

function openImage(shared?: { readonly doc: FakeDocument; readonly root: FakeElement }): Harness {
  const { doc, root } = shared ?? createFakeDocumentWithRoot();
  const host = new FakeElement("span");
  const handle = openMediaViewer({
    document: doc as unknown as Document,
    host: host as unknown as HTMLElement,
    content: IMAGE_CONTENT,
    fit: "contain",
    zoomPan: false,
    takeFocus: true,
    backgroundRoot: root as unknown as HTMLElement,
  });
  return {
    doc,
    backgroundRoot: root,
    host,
    handle,
    overlays: () =>
      doc.body.children.filter((child) => child.classList.contains("cm-md-media-viewer")),
  };
}

describe("openMediaViewer（node 级适配）", () => {
  it("组装浮层：挂 body、dialog 语义、内容就位，并注入自持样式与 inert 背景", () => {
    const harness = openImage();
    const overlays = harness.overlays();
    expect(overlays).toHaveLength(1);
    const overlay = overlays[0]!;

    expect(overlay.getAttribute("role")).toBe("dialog");
    expect(overlay.getAttribute("aria-modal")).toBe("true");
    expect(overlay.getAttribute("aria-label")).toBe("猫");
    expect(overlay.tabIndex).toBe(-1);
    expect(overlay.querySelector("img")?.src).toBe("cat.png");

    const styleElement = harness.doc.head.children.find(
      (child) => child.getAttribute("id") === VIEWER_STYLE_ELEMENT_ID,
    );
    expect(styleElement, "样式必须注入 head").toBeDefined();
    expect(styleElement?.textContent ?? "").toContain(".cm-md-media-viewer");

    expect(harness.backgroundRoot.hasAttribute("inert"), "模态期间背景必须 inert").toBe(true);
    expect(harness.doc.listeners.some((entry) => entry.type === "keydown" && entry.capture)).toBe(
      true,
    );
  });

  it("样式注入幂等：重复 open 只保留一个 style 元素", () => {
    const shared = createFakeDocumentWithRoot();
    // 用同一个 document 打开两次（第二次会先关掉第一次的浮层）
    openImage(shared);
    openImage(shared);
    const styleElements = shared.doc.head.children.filter(
      (child) => child.getAttribute("id") === VIEWER_STYLE_ELEMENT_ID,
    );
    expect(styleElements).toHaveLength(1);
  });

  it("关闭：移除浮层、注销 document 监听、恢复 inert，且重复关闭是幂等的", () => {
    const harness = openImage();
    harness.handle.close();

    expect(harness.overlays()).toHaveLength(0);
    expect(harness.backgroundRoot.hasAttribute("inert")).toBe(false);
    expect(harness.doc.listeners.filter((entry) => entry.type === "keydown")).toHaveLength(0);
    expect(() => harness.handle.close()).not.toThrow();
  });

  it("同 host 重复 open：只保留最新浮层与单个 document 监听", () => {
    const { doc, root } = createFakeDocumentWithRoot();
    const host = new FakeElement("span");
    const options = {
      document: doc as unknown as Document,
      host: host as unknown as HTMLElement,
      content: IMAGE_CONTENT,
      fit: "contain" as const,
      zoomPan: false as const,
      takeFocus: true,
      backgroundRoot: root as unknown as HTMLElement,
    };
    openMediaViewer(options);
    openMediaViewer(options);

    expect(
      doc.body.children.filter((child) => child.classList.contains("cm-md-media-viewer")),
    ).toHaveLength(1);
    expect(doc.listeners.filter((entry) => entry.type === "keydown")).toHaveLength(1);
  });

  it("未登记的 host：closeMediaViewerFor 为幂等 no-op", () => {
    const { doc } = createFakeDocumentWithRoot();
    const stranger = new FakeElement("div");
    expect(() => closeMediaViewerFor(stranger as unknown as HTMLElement)).not.toThrow();
    expect(
      doc.body.children.filter((child) => child.classList.contains("cm-md-media-viewer")),
    ).toHaveLength(0);
  });

  it("Escape 经 document 捕获相关闭浮层并 preventDefault", () => {
    const harness = openImage();
    let prevented = false;
    harness.doc.fire("keydown", {
      key: "Escape",
      metaKey: false,
      ctrlKey: false,
      altKey: false,
      preventDefault: () => {
        prevented = true;
      },
    });
    expect(prevented).toBe(true);
    expect(harness.overlays()).toHaveLength(0);
  });

  it("指针拖拽：pointerdown 进入拖拽态、pointerup 退出（不使用指针捕获）", () => {
    const harness = openImage();
    const overlay = harness.overlays()[0]!;
    // zoomPan:false（图片路径）下不进入拖拽——用滚动层外的 mermaid 路径由 e2e 覆盖；
    // 这里断言的是“不调用 setPointerCapture”：曾因捕获改变了事件路由导致浮层内 click/dblclick 失效。
    overlay.fire("pointerdown", { pointerId: 7, clientX: 10, clientY: 10 });
    expect(overlay.captureCalls).toBe(0);
    overlay.fire("pointerup", { pointerId: 7, clientX: 10, clientY: 10 });
    expect(overlay.releasedCaptureCalls).toBe(0);
  });
});
