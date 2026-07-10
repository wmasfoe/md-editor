import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
) as {
  exports?: Record<string, string>;
};
const indexSource = readFileSync(new URL("../index.ts", import.meta.url), "utf8");
const hooksIndexSource = readFileSync(new URL("../hooks/index.ts", import.meta.url), "utf8");
const milkdownEditorSource = readFileSync(
  new URL("../components/MilkdownEditor/MilkdownEditor.tsx", import.meta.url),
  "utf8",
);
const milkdownEditorPrimitiveSource = readFileSync(
  new URL("../components/MilkdownEditor/MilkdownEditorPrimitive.tsx", import.meta.url),
  "utf8",
);
const sourceEditorSource = readFileSync(
  new URL("../components/SourceEditor/SourceEditor.tsx", import.meta.url),
  "utf8",
);

describe("editor-ui public editor entrypoints", () => {
  it("keeps root and editor subpath entrypoints usable", () => {
    expect(packageJson.exports?.["."]).toBe("./src/index.ts");
    expect(packageJson.exports?.["./MilkdownEditor"]).toBe(
      "./src/components/MilkdownEditor/index.ts",
    );
    expect(packageJson.exports?.["./SourceEditor"]).toBe("./src/components/SourceEditor/index.ts");

    expect(indexSource).toContain("MilkdownEditorCommandHandlers");
    expect(indexSource).toContain("MilkdownEditorProps");
    expect(hooksIndexSource).toContain('export * from "./useEditorUi"');
    expect(indexSource).toContain("SourceEditorProps");
    expect(indexSource).toContain("SourceEditorPrimitiveProps");
    expect(indexSource).toContain('export * from "./hooks"');
    expect(runtimeExportSources(indexSource)).toContain("./components/MilkdownEditor");
    expect(runtimeExportSources(indexSource)).toContain("./components/SourceEditor");
  });

  it("keeps Milkdown as a public surface over a platform-free primitive", () => {
    expect(milkdownEditorSource).toContain("export function MilkdownEditor");
    expect(milkdownEditorSource).toContain("useEditorUiState()");
    expect(milkdownEditorSource).toContain("useEditorUiActions()");
    expect(milkdownEditorSource).toContain("useMdxAiController<TPlugin>(mdxAi)");
    expect(milkdownEditorSource).toContain("renderMdxComponentMenu");
    expect(milkdownEditorSource).toContain("registerEditorCommands");
    expect(milkdownEditorSource).toContain("<MilkdownProvider key={editorUiState.documentKey}>");
    expect(milkdownEditorSource).toContain("<MilkdownEditorPrimitive");
    expect(milkdownEditorPrimitiveSource).toContain("function MilkdownEditorPrimitive");
    expect(milkdownEditorSource).not.toMatch(/from ["']apps\/desktop/u);
    expect(milkdownEditorSource).not.toContain("@tauri-apps/api");
  });

  it("keeps SourceEditor connected to the editor UI provider over a platform-free primitive", () => {
    expect(sourceEditorSource).toContain("export function SourceEditor");
    expect(sourceEditorSource).toContain("useEditorUiState()");
    expect(sourceEditorSource).toContain("useEditorUiActions()");
    expect(sourceEditorSource).toContain("export function SourceEditorPrimitive");
    expect(sourceEditorSource).toContain("onChange");
    expect(sourceEditorSource).toContain(
      'getModeScrollTargetForMode(editorUiState.modeScrollTarget, "source")',
    );
    expect(sourceEditorSource).not.toMatch(/from ["']apps\/desktop/u);
    expect(sourceEditorSource).not.toContain("@tauri-apps/api");
  });
});

function runtimeExportSources(source: string): string[] {
  return Array.from(source.matchAll(/\bexport\s+\{[^}]+\}\s+from\s+["']([^"']+)["']/gu))
    .map((match) => match[1] ?? "")
    .filter(Boolean);
}
