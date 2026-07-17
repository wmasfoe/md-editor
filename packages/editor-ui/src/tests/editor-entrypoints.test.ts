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
});

function runtimeExportSources(source: string): string[] {
  return Array.from(source.matchAll(/\bexport\s+\{[^}]+\}\s+from\s+["']([^"']+)["']/gu))
    .map((match) => match[1] ?? "")
    .filter(Boolean);
}
