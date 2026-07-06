import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const appSource = readFileSync(new URL("../src/app/App.tsx", import.meta.url), "utf8");
const appearancePanelSource = readFileSync(
  new URL("../src/components/settings/AppearanceSettingsPanel.tsx", import.meta.url),
  "utf8"
);
const milkdownEditorSource = readFileSync(
  new URL("../../../packages/editor-ui/src/components/MilkdownEditor.tsx", import.meta.url),
  "utf8"
);
const milkdownEditorStyles = readFileSync(
  new URL("../../../packages/editor-ui/src/components/MilkdownEditor.css", import.meta.url),
  "utf8"
);

describe("WYSIWYG appearance settings", () => {
  it("passes the configured WYSIWYG font size into the reusable editor", () => {
    expect(appSource).toContain("wysiwygFontSize={editor.settings.editor.wysiwygFontSize}");
    expect(milkdownEditorSource).toContain("readonly wysiwygFontSize?: number;");
    expect(milkdownEditorSource).toContain("WYSIWYG_FONT_SIZE_MIN = 13");
    expect(milkdownEditorSource).toContain('"--theme-editor-font-size": `${safeFontSize}px`');
  });

  it("exposes a bounded font-size control in appearance settings", () => {
    expect(appearancePanelSource).toContain("所见即所得字号");
    expect(appearancePanelSource).toContain("type=\"range\"");
    expect(appearancePanelSource).toContain("WYSIWYG_FONT_SIZE_MIN = 13");
    expect(appearancePanelSource).toContain("WYSIWYG_FONT_SIZE_MAX = 22");
  });

  it("keeps source mode independent while aligning WYSIWYG soft-wrapped text", () => {
    expect(milkdownEditorStyles).toContain("font-family: var(--theme-editor-font, var(--theme-font));");
    expect(milkdownEditorStyles).toContain("font-size: var(--theme-editor-font-size, 17px);");
    expect(milkdownEditorStyles).toContain("line-height: var(--theme-editor-line-height, 1.68);");
    expect(milkdownEditorStyles).toContain("letter-spacing: var(--theme-editor-letter-spacing, 0.015em);");
    expect(milkdownEditorStyles).toContain(".milkdown .ProseMirror p {\n  line-height: inherit;");
    expect(milkdownEditorStyles).not.toContain("--theme-source-line-height");
  });
});
