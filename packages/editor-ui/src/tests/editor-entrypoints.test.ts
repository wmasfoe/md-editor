import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  exports?: Record<string, string>;
};
const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const hooksIndexSource = readFileSync(new URL("../hooks/index.ts", import.meta.url), "utf8");
const codeMirrorEditorSource = readFileSync(
  new URL("../components/CodeMirrorEditor/CodeMirrorEditor.tsx", import.meta.url),
  "utf8",
);
const codeMirrorBridgeSource = readFileSync(
  new URL("../components/CodeMirrorEditor/bridge.ts", import.meta.url),
  "utf8",
);
const codeMirrorEditorStyles = readFileSync(
  new URL("../components/CodeMirrorEditor/CodeMirrorEditor.css", import.meta.url),
  "utf8",
);

describe("editor-ui public editor entrypoints", () => {
  it("exposes CodeMirror as the only editor implementation", () => {
    expect(packageJson.exports).toEqual({
      ".": "./src/index.ts",
      "./hooks": "./src/hooks/index.ts",
      "./CodeMirrorEditor": "./src/components/CodeMirrorEditor/index.ts",
      "./CodeMirrorEditor/testing": "./src/components/CodeMirrorEditor/testing.ts",
      "./OutlinePanel": "./src/components/OutlinePanel.tsx",
    });

    expect(hooksIndexSource).toContain('export * from "./useEditorUi"');
    expect(indexSource).toContain("CodeMirrorEditorProps");
    expect(indexSource).toContain('export * from "./hooks"');
    expect(runtimeExportSources(indexSource)).toContain("./components/CodeMirrorEditor");
  });

  it("mounts the raw CodeMirror bridge without a controlled Markdown value", () => {
    expect(codeMirrorEditorSource).toContain("createCodeMirrorEditorBridge");
    expect(codeMirrorEditorSource).toContain("useSyncExternalStore");
    expect(codeMirrorEditorSource).toContain("registerRendererPorts");
    expect(codeMirrorBridgeSource).toContain("subscribeTransitions");
    expect(codeMirrorBridgeSource).toContain("synchronizeRendererEvent");
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
    expect(codeMirrorBridgeSource).toContain("resolveImagePreview");
    expect(codeMirrorBridgeSource).not.toContain("convertFileSrc");
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
