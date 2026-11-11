import { describe, expect, it } from "vitest";
import { EDITOR_STYLE_CSS } from "@md-editor/editor";

describe("Editor CSS Decoupling & Dynamic Style Variables", () => {
  // 这些规则已随「样式主权」迁入渲染器（renderer 产出 DOM ⇒ 拥有其渲染规则）。
  const cssContent = EDITOR_STYLE_CSS;

  it("decouples bold font weight using CSS variable instead of fixed 700", () => {
    expect(cssContent).not.toMatch(/\.cm-md-bold[^{]*\{[^}]*font-weight:\s*700\s*!important/);
    expect(cssContent).toContain("--theme-bold-font-weight");
  });

  it("decouples letter-spacing in scroller using CSS variable instead of fixed 0", () => {
    expect(cssContent).not.toMatch(/\.cm-scroller[^{]*\{[^}]*letter-spacing:\s*0\s*;/);
    expect(cssContent).toContain("--theme-letter-spacing");
  });

  it("supports heading font family and heading font weight variables", () => {
    expect(cssContent).toContain("--theme-heading-font");
    expect(cssContent).toContain("--theme-heading-font-weight");
  });

  it("supports heading bottom divider toggle via variable", () => {
    expect(cssContent).toContain("--theme-heading-divider");
  });

  it("supports quote border and background variables", () => {
    expect(cssContent).toContain("--theme-blockquote-border");
    expect(cssContent).toContain("--theme-blockquote-bg");
  });

  it("supports code block border-radius variable", () => {
    expect(cssContent).toContain("--theme-radius-base");
  });
});
