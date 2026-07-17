import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "vite";
import viteConfig from "../vite.config";

const importer = fileURLToPath(
  new URL("../src/components/DesktopCodeMirrorEditor.tsx", import.meta.url),
);
const viteConfigSource = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");

describe("desktop Vite aliases", () => {
  it("resolves the retained workspace package entrypoints", async () => {
    const resolveId = await createWorkspaceResolver();

    await expect(resolveId("@md-editor/editor-core")).resolves.toBe(
      workspacePath("../../../packages/editor-core/src/index.ts"),
    );
    await expect(resolveId("@md-editor/ai")).resolves.toBe(
      workspacePath("../../../packages/ai/src/index.ts"),
    );
    await expect(resolveId("@md-editor/editor-ui")).resolves.toBe(
      workspacePath("../../../packages/editor-ui/src/index.ts"),
    );
    await expect(resolveId("@md-editor/editor-ui/hooks")).resolves.toBe(
      workspacePath("../../../packages/editor-ui/src/hooks/index.ts"),
    );
  });

  it("contains no legacy editor or dependency aliases", () => {
    expect(viteConfigSource).not.toMatch(/Milkdown|SourceEditor|@milkdown|@uiw\/react-codemirror/u);
  });
});

async function createWorkspaceResolver(): Promise<(id: string) => Promise<string | undefined>> {
  const config = await resolveConfig(viteConfig, "serve", "development");
  const resolver = config.createResolver({ asSrc: true });
  return (id) => resolver(id, importer);
}

function workspacePath(path: string): string {
  return fileURLToPath(new URL(path, import.meta.url));
}
