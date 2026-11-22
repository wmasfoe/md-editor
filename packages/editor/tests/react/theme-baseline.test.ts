// @vitest-environment jsdom
/**
 * @file theme-baseline.test.ts
 * @description P2 主题契约的宿主层断言（单测层）。
 *
 * 层级约定：本文件只断言**宿主元素上的内联自定义属性**与像素字面量。
 * 凡依赖 `var()` 解析或 CSS 继承的断言（`.cm-scroller` 的计算字号）只能在
 * `apps/desktop/e2e` 判定——jsdom 对 `var()` 返回字面字符串。
 *
 * 迁移等价性：9 个旧排版 prop 的每一条断言都在这里以 `theme` 写法重建，
 * 预期变量名与值保持不变（唯一变化的是 `fontSize`：由内联 `font-size`
 * 改为第 71 条契约变量 `--theme-editor-font-size`）。
 */
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createDocumentState } from "@md-editor/core";
import { CodeMirrorEditor } from "../../src/react/index.ts";

const bridge = vi.hoisted(() => ({
  ports: {
    setCodeBlockLineNumbers: vi.fn(),
    setInlineStyleMarkers: vi.fn(),
    setMarkdownLint: vi.fn(),
    setMarkdownLintEngine: vi.fn(),
    recomputeMarkdownLint: vi.fn(),
    setLanguage: vi.fn(),
    setAiSuggestionLabels: vi.fn(),
    setPlugins: vi.fn(),
    requestMeasure: vi.fn(),
    setHostVisibility: vi.fn(),
  },
  destroy: vi.fn(),
}));
vi.mock("../../src/bridge.ts", () => ({ createCodeMirrorEditorBridge: vi.fn(() => bridge) }));

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });

let root: Root | undefined;
let container: HTMLDivElement | undefined;

beforeEach(() => {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(() => root?.unmount());
  root = undefined;
  container?.remove();
  vi.clearAllMocks();
});

type EditorProps = Parameters<typeof CodeMirrorEditor>[0];

async function mountHost(props: Omit<EditorProps, "document"> = {}): Promise<HTMLElement> {
  const documentState = createDocumentState({ markdown: "# Baseline" });
  await act(() =>
    root!.render(createElement(CodeMirrorEditor, { document: documentState, ...props })),
  );
  const host = container!.querySelector<HTMLElement>(".code-mirror-editor-host");
  if (!host) throw new Error("editor host was not rendered");
  return host;
}

const cssVar = (host: HTMLElement, name: string) => host.style.getPropertyValue(name);

describe("M-1 八个排版能力在 theme 写法下逐一等价", () => {
  it("字体族三项", async () => {
    const host = await mountHost({
      theme: {
        typography: {
          proseFontFamily: "Prose Sans",
          codeFontFamily: "Mono Sans",
          headingFontFamily: "Heading Sans",
        },
      },
    });
    expect(cssVar(host, "--theme-font")).toBe("Prose Sans");
    expect(cssVar(host, "--theme-mono-font")).toBe("Mono Sans");
    expect(cssVar(host, "--theme-heading-font")).toBe("Heading Sans");
  });

  it("行高、字距、字重四项", async () => {
    const host = await mountHost({
      theme: {
        typography: {
          lineHeight: 1.9,
          letterSpacing: "0.03em",
          boldFontWeight: 800,
          headingFontWeight: 650,
        },
      },
    });
    expect(cssVar(host, "--theme-editor-line-height")).toBe("1.9");
    expect(cssVar(host, "--theme-letter-spacing")).toBe("0.03em");
    expect(cssVar(host, "--theme-bold-font-weight")).toBe("800");
    expect(cssVar(host, "--theme-heading-font-weight")).toBe("650");
  });

  it("版心：数字加 px，字符串原样", async () => {
    expect(
      cssVar(
        await mountHost({ theme: { geometry: { contentMaxWidth: 720 } } }),
        "--theme-content-width",
      ),
    ).toBe("720px");
    expect(
      cssVar(
        await mountHost({ theme: { geometry: { contentMaxWidth: "48rem" } } }),
        "--theme-content-width",
      ),
    ).toBe("48rem");
  });
});

describe("M-2 字号走第 71 条契约变量（不再写内联 font-size）", () => {
  it("fontSize 写变量而非内联", async () => {
    const host = await mountHost({ theme: { typography: { fontSize: 19 } } });
    expect(cssVar(host, "--theme-editor-font-size")).toBe("19px");
    expect(host.style.fontSize).toBe("");
  });

  it("配色槽编译到对应变量", async () => {
    const host = await mountHost({
      theme: { colors: { canvasBg: "#fff", primaryColor: "#0969da" } },
    });
    expect(cssVar(host, "--theme-bg")).toBe("#fff");
    expect(cssVar(host, "--theme-surface")).toBe("#fff");
    expect(cssVar(host, "--theme-primary")).toBe("#0969da");
  });
});

describe("M-3 base 映射为 color-scheme，且不产变量", () => {
  it("dark", async () => {
    const host = await mountHost({ theme: { base: "dark" } });
    expect(host.style.colorScheme).toBe("dark");
    expect(cssVar(host, "--theme-bg")).toBe("");
  });
});

describe("M-4 优先级：style < theme", () => {
  it("同名字号时 theme 胜出", async () => {
    const host = await mountHost({
      style: { fontSize: "30px" } as React.CSSProperties,
      theme: { typography: { fontSize: 19 } },
    });
    expect(cssVar(host, "--theme-editor-font-size")).toBe("19px");
  });

  it("同名变量时 theme 胜出", async () => {
    const host = await mountHost({
      style: { "--theme-font": "From Style" } as React.CSSProperties,
      theme: { typography: { proseFontFamily: "From Theme" } },
    });
    expect(cssVar(host, "--theme-font")).toBe("From Theme");
  });

  it("布局样式不被 theme 覆盖", async () => {
    const host = await mountHost({
      style: { height: "50vh", padding: "4px" },
      theme: { typography: { fontSize: 19 } },
    });
    expect(host.style.height).toBe("50vh");
    expect(host.style.padding).toBe("4px");
  });
});

describe("M-7 无效值不产生变量", () => {
  it.each([0, -1, Number.NaN])("fontSize=%s", async (fontSize) => {
    const host = await mountHost({ theme: { typography: { fontSize } } });
    expect(cssVar(host, "--theme-editor-font-size")).toBe("");
  });

  it("空字符串被忽略", async () => {
    const host = await mountHost({
      theme: { typography: { letterSpacing: "", proseFontFamily: "  " } },
    });
    expect(cssVar(host, "--theme-letter-spacing")).toBe("");
    expect(cssVar(host, "--theme-font")).toBe("");
  });
});

describe("裸用基线（不传 theme）", () => {
  it("不写任何排版变量与内联字号", async () => {
    const host = await mountHost();
    expect(host.style.fontSize).toBe("");
    for (const name of [
      "--theme-font",
      "--theme-mono-font",
      "--theme-heading-font",
      "--theme-editor-font-size",
      "--theme-editor-line-height",
      "--theme-letter-spacing",
      "--theme-content-width",
      "--theme-bold-font-weight",
      "--theme-heading-font-weight",
    ]) {
      expect(cssVar(host, name)).toBe("");
    }
  });
});

describe("M-8 已删除的 9 个排版 props 在类型层逐个不合法", () => {
  it("传 proseFontFamily 会编译失败（旧写法不得悄悄生效）", () => {
    const documentState = createDocumentState({ markdown: "" });
    const legacy = createElement(CodeMirrorEditor, {
      document: documentState,
      // @ts-expect-error —— 9 个排版 props 已删除，改由 theme.typography/geometry 提供
      proseFontFamily: "serif",
    });
    expect(legacy).toBeTruthy();
  });

  it("传 codeFontFamily 会编译失败（旧写法不得悄悄生效）", () => {
    const documentState = createDocumentState({ markdown: "" });
    const legacy = createElement(CodeMirrorEditor, {
      document: documentState,
      // @ts-expect-error —— 9 个排版 props 已删除，改由 theme.typography/geometry 提供
      codeFontFamily: "monospace",
    });
    expect(legacy).toBeTruthy();
  });

  it("传 headingFontFamily 会编译失败（旧写法不得悄悄生效）", () => {
    const documentState = createDocumentState({ markdown: "" });
    const legacy = createElement(CodeMirrorEditor, {
      document: documentState,
      // @ts-expect-error —— 9 个排版 props 已删除，改由 theme.typography/geometry 提供
      headingFontFamily: "serif",
    });
    expect(legacy).toBeTruthy();
  });

  it("传 fontSize 会编译失败（旧写法不得悄悄生效）", () => {
    const documentState = createDocumentState({ markdown: "" });
    const legacy = createElement(CodeMirrorEditor, {
      document: documentState,
      // @ts-expect-error —— 9 个排版 props 已删除，改由 theme.typography/geometry 提供
      fontSize: 19,
    });
    expect(legacy).toBeTruthy();
  });

  it("传 lineHeight 会编译失败（旧写法不得悄悄生效）", () => {
    const documentState = createDocumentState({ markdown: "" });
    const legacy = createElement(CodeMirrorEditor, {
      document: documentState,
      // @ts-expect-error —— 9 个排版 props 已删除，改由 theme.typography/geometry 提供
      lineHeight: 1.8,
    });
    expect(legacy).toBeTruthy();
  });

  it("传 letterSpacing 会编译失败（旧写法不得悄悄生效）", () => {
    const documentState = createDocumentState({ markdown: "" });
    const legacy = createElement(CodeMirrorEditor, {
      document: documentState,
      // @ts-expect-error —— 9 个排版 props 已删除，改由 theme.typography/geometry 提供
      letterSpacing: "0.1em",
    });
    expect(legacy).toBeTruthy();
  });

  it("传 boldFontWeight 会编译失败（旧写法不得悄悄生效）", () => {
    const documentState = createDocumentState({ markdown: "" });
    const legacy = createElement(CodeMirrorEditor, {
      document: documentState,
      // @ts-expect-error —— 9 个排版 props 已删除，改由 theme.typography/geometry 提供
      boldFontWeight: 700,
    });
    expect(legacy).toBeTruthy();
  });

  it("传 headingFontWeight 会编译失败（旧写法不得悄悄生效）", () => {
    const documentState = createDocumentState({ markdown: "" });
    const legacy = createElement(CodeMirrorEditor, {
      document: documentState,
      // @ts-expect-error —— 9 个排版 props 已删除，改由 theme.typography/geometry 提供
      headingFontWeight: 600,
    });
    expect(legacy).toBeTruthy();
  });

  it("传 contentMaxWidth 会编译失败（旧写法不得悄悄生效）", () => {
    const documentState = createDocumentState({ markdown: "" });
    const legacy = createElement(CodeMirrorEditor, {
      document: documentState,
      // @ts-expect-error —— 9 个排版 props 已删除，改由 theme.typography/geometry 提供
      contentMaxWidth: 720,
    });
    expect(legacy).toBeTruthy();
  });
});
