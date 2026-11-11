import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { EDITOR_STYLE_CSS } from "@md-editor/editor";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  exports?: Record<string, string>;
  dependencies?: Record<string, string>;
};
const indexSource = readFileSync(new URL("../../src/react/index.ts", import.meta.url), "utf8");
const codeMirrorEditorSource = readFileSync(
  new URL("../../src/react/CodeMirrorEditor.tsx", import.meta.url),
  "utf8",
);
// 编辑器区样式已归渲染器所有（renderer 产出 DOM ⇒ 拥有其渲染规则）。
const codeMirrorEditorStyles = EDITOR_STYLE_CSS;

describe("editor/react public editor entrypoints", () => {
  it("keeps the standalone React layer independent of application UI and localization", () => {
    expect(packageJson.dependencies?.["@md-editor/app-ui"]).toBeUndefined();
    expect(packageJson.dependencies?.["@md-editor/i18n"]).toBeUndefined();
    expect(codeMirrorEditorSource).not.toContain("md-editor:language-changed");
    expect(codeMirrorEditorSource).not.toContain("useTranslation");
    expect(codeMirrorEditorSource).not.toContain("useOptionalEditorUiActions");
  });

  it("exposes CodeMirror as the only editor implementation", () => {
    expect(packageJson.exports?.["./react"]).toBe("./src/react/index.ts");
    expect(packageJson.exports?.["./react/testing"]).toBe("./src/react/testing.ts");
    expect(indexSource).toContain("CodeMirrorEditorProps");
    expect(runtimeExportSources(indexSource)).toContain("./CodeMirrorEditor");
  });

  it("forwards the inline-style marker source toggle to renderer ports", () => {
    // 开关值只在宿主读取，编辑器层只负责把布尔值推给 renderer 端口（不得在此计算编辑器语义）。
    expect(codeMirrorEditorSource).toContain("showInlineStyleMarkers?: boolean");
    expect(codeMirrorEditorSource).toContain("ports.setInlineStyleMarkers(showInlineStyleMarkers)");
  });

  it("forwards markdown lint toggle to renderer ports", () => {
    expect(codeMirrorEditorSource).toContain("enableMarkdownLint?: boolean");
    expect(codeMirrorEditorSource).toContain("ports.setMarkdownLint(enableMarkdownLint)");
  });

  it("mounts the raw CodeMirror bridge without a controlled Markdown value", () => {
    expect(codeMirrorEditorSource).toContain("createCodeMirrorEditorBridge");
    expect(codeMirrorEditorSource).toContain("useSyncExternalStore");
    expect(codeMirrorEditorSource).not.toContain("registerRendererPorts");
    expect(codeMirrorEditorSource).not.toMatch(/\bvalue\s*=/u);
    expect(codeMirrorEditorSource).not.toContain("snapshot.markdown");
  });

  it("styles parser-owned inline and heading projection classes through theme variables", () => {
    for (const className of [
      "cm-md-bold",
      "cm-md-italic",
      "cm-md-strikethrough",
      "cm-md-inline-code",
      "cm-md-heading--level-1",
      "cm-md-heading--level-6",
      "cm-md-heading--source-only",
      "cm-md-marker",
    ]) {
      expect(codeMirrorEditorStyles).toContain(`.${className}`);
    }
    for (const variableName of [
      "--theme-strong-accent",
      "--theme-em-accent",
      "--theme-del-accent",
      "--theme-code-accent",
      "--theme-heading-accent",
      "--theme-marker-dim",
    ]) {
      expect(codeMirrorEditorStyles).toContain(variableName);
    }
  });

  it("styles quote, list, and task projection without nested form controls", () => {
    for (const className of [
      "cm-md-block-line--quote",
      "cm-md-block-marker--quote",
      "cm-md-block-marker--list-item-ordered",
      "cm-md-task-checkbox",
      "cm-md-task-checkbox--checked",
    ]) {
      expect(codeMirrorEditorStyles).toContain(`.${className}`);
    }
    for (const variableName of [
      "--theme-blockquote-border",
      "--theme-list-marker",
      "--theme-checkbox-border",
      "--theme-checkbox-check",
    ]) {
      expect(codeMirrorEditorStyles).toContain(variableName);
    }
  });

  it("keeps image resolution injected while renderer-owned media projection uses stable classes", () => {
    expect(codeMirrorEditorSource).toContain("resolveImageSrc");
    for (const className of [
      "cm-md-link-label",
      "cm-md-image-widget",
      "cm-md-image-widget--failed",
      "cm-md-thematic-break-widget",
      "cm-md-thematic-break-widget--selected",
    ]) {
      expect(codeMirrorEditorStyles).toContain(`.${className}`);
    }
  });
});

function runtimeExportSources(source: string): string[] {
  return Array.from(source.matchAll(/\bexport\s+\{[^}]+\}\s+from\s+["']([^"']+)["']/gu))
    .map((match) => match[1] ?? "")
    .filter(Boolean);
}
