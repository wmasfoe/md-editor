import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const panelSource = readFileSync(
  new URL("../src/components/settings/AppearanceSettingsPanel.tsx", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("../src/components/settings/settings-styles.ts", import.meta.url),
  "utf8",
);
const editorCssSource = readFileSync(
  new URL("../src/components/CodeMirrorEditor/CodeMirrorEditor.css", import.meta.url),
  "utf8",
);

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
    expect(editorCssSource).toContain(
      ':root[data-theme-scheme="dark"] .code-mirror-editor-host .cm-tooltip.cm-tooltip-lint',
    );
    expect(editorCssSource).toContain("text-decoration: underline wavy");
  });
});
