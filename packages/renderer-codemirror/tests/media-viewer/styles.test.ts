/**
 * AC17 契约测试（**测试先行**）：浮层样式的"载体自证"。
 *
 * 为什么要这层断言：历史上浮层规则写成 `.code-mirror-editor-host .cm-md-image-viewer{…}`，
 * 而浮层挂在 `document.body`（不是宿主 div 的后代）⇒ 规则永不匹配，浮层长期"全裸"却测试全绿。
 * 同样的错法还有 `EditorView.baseTheme`（编译成 `.ͼ1 <sel>`，要求浮层是 `.cm-editor` 后代）。
 * 因此这里把"载体必须无祖先前缀"钉成可失败的断言。
 *
 * 能力边界（诚实声明）：本测试只能证明**常量与调用路径结构**；计算样式/继承/层叠/包含块
 * 只能由 e2e 的 `getComputedStyle` 断言证明（见 test-spec §1）。
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  VIEWER_CSS,
  VIEWER_STYLE_ELEMENT_ID,
  ensureViewerStyleElement,
  type ViewerStyleElement,
  type ViewerStylePort,
} from "../../src/media-viewer/styles.ts";

/** 取出每条规则的顶层选择器列表（先剥注释，再按 `}` 切块取 `{` 之前的部分）。 */
function topLevelSelectors(css: string): readonly string[] {
  return css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("}")
    .map((block) => block.split("{")[0]?.trim() ?? "")
    .filter((selector) => selector !== "" && !selector.startsWith("@"))
    .flatMap((selector) => selector.split(",").map((part) => part.trim()))
    .filter((selector) => selector !== "");
}

/** 构造最小样式端口（node 环境无 document）。 */
function createFakePort(): ViewerStylePort & { readonly appended: ViewerStyleElement[] } {
  const byId = new Map<string, ViewerStyleElement>();
  const appended: ViewerStyleElement[] = [];
  return {
    appended,
    getElementById: (id: string) => byId.get(id) ?? null,
    createStyleElement: () => {
      const element: ViewerStyleElement = {
        textContent: null,
        setAttribute: (name: string, value: string) => {
          if (name === "id") {
            byId.set(value, element);
          }
        },
      };
      return element;
    },
    appendToHead: (node: ViewerStyleElement) => {
      appended.push(node);
    },
  };
}

describe("VIEWER_CSS 载体结构", () => {
  it("每条顶层选择器都以 .cm-md-media-viewer 开头（无任何祖先前缀）", () => {
    const selectors = topLevelSelectors(VIEWER_CSS);
    expect(selectors.length).toBeGreaterThan(0);
    for (const selector of selectors) {
      expect(selector.startsWith(".cm-md-media-viewer")).toBe(true);
    }
  });

  it("不含已废弃的两类前缀（宿主前缀与 baseTheme 作用域前缀）", () => {
    expect(VIEWER_CSS).not.toContain("code-mirror-editor-host");
    expect(VIEWER_CSS).not.toContain(".ͼ");
  });

  it("根规则声明 AC17 断言所依赖的定位与层级", () => {
    expect(VIEWER_CSS).toMatch(/\.cm-md-media-viewer\s*\{[^}]*position:\s*fixed/);
    expect(VIEWER_CSS).toMatch(/\.cm-md-media-viewer\s*\{[^}]*inset:\s*0/);
    expect(VIEWER_CSS).toMatch(/\.cm-md-media-viewer\s*\{[^}]*z-index:\s*1000/);
    expect(VIEWER_CSS).toMatch(/\.cm-md-media-viewer\s*\{[^}]*background:\s*rgba\(0,\s*0,\s*0/);
  });

  it("提供关闭按钮与缩放舞台所需类名", () => {
    expect(VIEWER_CSS).toContain(".cm-md-media-viewer__close");
    expect(VIEWER_CSS).toContain(".cm-md-media-viewer__stage");
    expect(VIEWER_CSS).toContain(".cm-md-media-viewer__media");
  });
});

describe("ensureViewerStyleElement", () => {
  it("首次调用创建并注入 head，且设置 id 与文本", () => {
    const port = createFakePort();
    ensureViewerStyleElement(port);
    expect(port.appended).toHaveLength(1);
    expect(port.appended[0]?.textContent).toBe(VIEWER_CSS);
    expect(port.getElementById(VIEWER_STYLE_ELEMENT_ID)).toBe(port.appended[0]);
  });

  it("幂等：重复调用只注入一个元素", () => {
    const port = createFakePort();
    ensureViewerStyleElement(port);
    ensureViewerStyleElement(port);
    ensureViewerStyleElement(port);
    expect(port.appended).toHaveLength(1);
  });

  it("已存在但文本过期时刷新文本（HMR / 常量升级场景）", () => {
    const port = createFakePort();
    ensureViewerStyleElement(port);
    const element = port.appended[0];
    if (element) {
      element.textContent = "/* stale */";
    }
    ensureViewerStyleElement(port);
    expect(element?.textContent).toBe(VIEWER_CSS);
    expect(port.appended).toHaveLength(1);
  });
});

describe("死规则清理（结构性约束）", () => {
  it("editor-ui 的 CodeMirrorEditor.css 不再存在带宿主前缀的 .cm-md-image-viewer 规则", () => {
    const cssPath = fileURLToPath(
      new URL(
        "../../../editor-ui/src/components/CodeMirrorEditor/CodeMirrorEditor.css",
        import.meta.url,
      ),
    );
    const css = readFileSync(cssPath, "utf-8");
    // 只检查**选择器**（注释里可以提到类名；真正的风险是活规则）
    const offenders = topLevelSelectors(css).filter((selector) =>
      selector.includes(".cm-md-image-viewer"),
    );
    expect(offenders).toEqual([]);
  });
});
