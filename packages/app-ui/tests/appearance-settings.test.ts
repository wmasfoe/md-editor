import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EDITOR_STYLE_CSS } from "@md-editor/editor";

const panelSource = readFileSync(
  new URL("../src/components/settings/AppearanceSettingsPanel.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../src/components/settings/settings-styles.ts", import.meta.url),
  "utf8",
);
// 编辑器区样式已归渲染器所有（renderer 产出 DOM ⇒ 拥有其渲染规则）。
const editorCssSource = EDITOR_STYLE_CSS;

describe("appearance settings panel & custom CSS visibility", () => {
  it("embeds custom CSS toggle inside theme select options when customCss is supported", () => {
    expect(panelSource).toContain('customCss ? (\n                      <option value="custom">');
    expect(panelSource).toContain('customCss?.isLightCustom ? "custom" : builtInThemes.lightTheme');
    expect(panelSource).toContain('customCss?.isDarkCustom ? "custom" : builtInThemes.darkTheme');
  });

  it("only renders custom CSS file picker when custom is selected", () => {
    expect(panelSource).toContain(
      "customCss && (customCss.isLightCustom || customCss.lightPath !== null)",
    );
    expect(panelSource).toContain(
      "customCss && (customCss.isDarkCustom || customCss.darkPath !== null)",
    );
    // 确保不再存在独立常显的二级模块
    expect(panelSource).not.toContain('id="custom-css-title"');
  });

  it("applies shrink-0 whitespace-nowrap to small buttons to prevent button text wrapping", () => {
    expect(stylesSource).toContain("shrink-0 whitespace-nowrap");
  });

  it("adapts CodeMirror lint tooltip and diagnostics to theme colors and dark mode", () => {
    expect(editorCssSource).toContain("var(--theme-surface");
    expect(editorCssSource).toContain("var(--theme-border-strong");
    // 迁移后选择器不再带宿主前缀（scope 由渲染器自产的 .cm-md-editor 提供）。
    // 选择器经拼接/格式化后空格不固定，用正则断言关键结构：
    // 暗色主题限定 + renderer 自产 scope 类 + lint tooltip 类。
    expect(editorCssSource).toMatch(
      /:root\[data-theme-scheme="dark"\]\s+\.cm-md-editor\.cm-editor\s+\.cm-tooltip\.cm-tooltip-lint/,
    );
    expect(editorCssSource).toContain("text-decoration: underline wavy");
  });
});
