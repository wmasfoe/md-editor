import { describe, expect, it } from "vitest";
import { compileEditorTheme } from "../../src/theme/index.ts";

/**
 * 纯映射层：不碰 DOM、不产 CSS 文本，所以可以在 node 里逐条断言。
 * 这一层是 P2 迁移等价性的基础——9 个排版能力必须映射到**与迁移前完全相同**的变量。
 */
describe("配色槽 → --theme-*", () => {
  it("canvasBg 同时写 bg 与 surface", () => {
    expect(compileEditorTheme({ colors: { canvasBg: "#fff" } })).toEqual({
      "--theme-bg": "#fff",
      "--theme-surface": "#fff",
    });
  });

  it("primaryColor 派生四个语义变量", () => {
    expect(compileEditorTheme({ colors: { primaryColor: "#0969da" } })).toEqual({
      "--theme-primary": "#0969da",
      "--theme-primary-fill": "#0969da",
      "--theme-primary-soft": "color-mix(in srgb, #0969da 12%, transparent)",
      "--theme-primary-selected": "color-mix(in srgb, #0969da 26%, transparent)",
      "--theme-control-hover": "color-mix(in srgb, #0969da 8%, transparent)",
    });
  });

  it("其余配色槽一一对应", () => {
    expect(
      compileEditorTheme({
        colors: {
          chromeBg: "#eee",
          textColor: "#111",
          titleColor: "#000",
          codeBg: "#f6f8fa",
          inlineCodeBg: "#eef",
          borderColor: "#ddd",
        },
      }),
    ).toEqual({
      "--theme-chrome": "#eee",
      "--theme-bg-muted": "#eee",
      "--theme-text": "#111",
      "--theme-title": "#000",
      "--theme-code-bg": "#f6f8fa",
      "--theme-inline-code-bg": "#eef",
      "--theme-border": "#ddd",
    });
  });
});

describe("排版槽 → --theme-*（9 个旧 prop 的等价映射）", () => {
  it("字体族三项", () => {
    expect(
      compileEditorTheme({
        typography: {
          proseFontFamily: "Prose",
          codeFontFamily: "Mono",
          headingFontFamily: "Heading",
        },
      }),
    ).toEqual({
      "--theme-font": "Prose",
      "--theme-mono-font": "Mono",
      "--theme-heading-font": "Heading",
    });
  });

  it("字号是第 71 条契约变量，带 px", () => {
    expect(compileEditorTheme({ typography: { fontSize: 19 } })).toEqual({
      "--theme-editor-font-size": "19px",
    });
  });

  it("行高、字距、字重", () => {
    expect(
      compileEditorTheme({
        typography: {
          lineHeight: 1.9,
          letterSpacing: "0.03em",
          boldFontWeight: 800,
          headingFontWeight: 650,
        },
      }),
    ).toEqual({
      "--theme-editor-line-height": "1.9",
      "--theme-letter-spacing": "0.03em",
      "--theme-bold-font-weight": "800",
      "--theme-heading-font-weight": "650",
    });
  });

  it("版心：数字加 px，字符串原样", () => {
    expect(compileEditorTheme({ geometry: { contentMaxWidth: 720 } })).toEqual({
      "--theme-content-width": "720px",
    });
    expect(compileEditorTheme({ geometry: { contentMaxWidth: "48rem" } })).toEqual({
      "--theme-content-width": "48rem",
    });
  });
});

describe("无效值与缺省", () => {
  it("undefined 主题产出空字典（不填充默认值）", () => {
    expect(compileEditorTheme(undefined)).toEqual({});
  });

  it("base 本身不产变量（由 React 层映射为 color-scheme）", () => {
    expect(compileEditorTheme({ base: "dark" })).toEqual({});
  });

  it.each([0, -1, Number.NaN])("字号 %s 被忽略", (fontSize) => {
    expect(compileEditorTheme({ typography: { fontSize } })).toEqual({});
  });

  it("空字符串与空白字符串被忽略", () => {
    expect(
      compileEditorTheme({ colors: { textColor: "" }, typography: { proseFontFamily: "  " } }),
    ).toEqual({});
  });
});
