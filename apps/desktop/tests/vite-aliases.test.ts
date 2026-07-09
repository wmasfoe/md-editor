import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveConfig } from "vite";
import viteConfig from "../vite.config";

const importer = fileURLToPath(new URL("../src/components/DesktopMilkdownEditor.tsx", import.meta.url));

describe("desktop Vite aliases", () => {
  it("resolves workspace package subpaths before exact root package aliases", async () => {
    const resolveId = await createWorkspaceResolver();

    await expect(resolveId("@md-editor/editor-core")).resolves.toBe(workspacePath(
      "../../../packages/editor-core/src/index.ts"
    ));
    await expect(resolveId("@md-editor/ai")).resolves.toBe(workspacePath(
      "../../../packages/ai/src/index.ts"
    ));
    await expect(resolveId("@md-editor/editor-ui")).resolves.toBe(workspacePath(
      "../../../packages/editor-ui/src/index.ts"
    ));
    await expect(resolveId("@md-editor/editor-ui/hooks")).resolves.toBe(workspacePath(
      "../../../packages/editor-ui/src/hooks/index.ts"
    ));
    await expect(resolveId("@md-editor/editor-ui/milkdown-editor")).resolves.toBe(workspacePath(
      "../../../packages/editor-ui/src/components/MilkdownEditor.tsx"
    ));
    await expect(resolveId("@md-editor/editor-ui/source-editor")).resolves.toBe(workspacePath(
      "../../../packages/editor-ui/src/components/SourceEditor.tsx"
    ));
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
