import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = new URL("../", import.meta.url);
const packageJson = JSON.parse(
  readFileSync(new URL("../../package.json", import.meta.url), "utf8")
) as {
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
};
const hooksIndexSource = readFileSync(new URL("../hooks/index.ts", import.meta.url), "utf8");
const mdxAiControllerSource = readFileSync(
  new URL("../hooks/useMdxAiController.ts", import.meta.url),
  "utf8"
);
const outlineControllerSource = readFileSync(
  new URL("../hooks/useOutlineController.ts", import.meta.url),
  "utf8"
);

describe("editor-ui hooks and package boundary", () => {
  it("exports migrated hooks from the editor-ui hooks entrypoint", () => {
    expect(hooksIndexSource).toContain('export * from "./controller-errors"');
    expect(hooksIndexSource).toContain('export * from "./useConfirmationController"');
    expect(hooksIndexSource).toContain('export * from "./useFileActionController"');
    expect(hooksIndexSource).toContain('export * from "./useMdxAiController"');
    expect(hooksIndexSource).toContain('export * from "./useOutlineController"');
  });

  it("keeps MDX and AI controller behavior injected instead of desktop/provider-owned", () => {
    expect(mdxAiControllerSource).toContain("getMdxComponentPlugins");
    expect(mdxAiControllerSource).toContain("getAiCompletionReadiness");
    expect(mdxAiControllerSource).toContain("requestAiCompletion");
    expect(mdxAiControllerSource).not.toContain("requestDesktopAiContinuation");
    expect(mdxAiControllerSource).not.toContain("@md-editor/editor-core/ai");
    expect(mdxAiControllerSource).not.toContain("editor-runtime");
    expect(mdxAiControllerSource).not.toContain("@tauri-apps/api");
  });

  it("keeps editor-ui source free of desktop and native runtime imports", () => {
    const source = sourceFiles(sourceRoot)
      .filter((file) => !file.endsWith(".test.ts"))
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(source).not.toContain("apps/desktop");
    expect(source).not.toContain("@tauri-apps/api");
    expect(source).not.toContain("requestDesktopAiContinuation");
    expect(source).not.toContain("editor-runtime");
    expect(source).not.toContain("@md-editor/editor-core/ai");
    expect(source).not.toContain("@md-editor/mdx-component-registry");
  });

  it("keeps the editor-ui import graph free of platform-only modules", () => {
    const forbiddenSpecifiers = sourceFiles(sourceRoot)
      .filter((file) => !file.endsWith(".test.ts"))
      .flatMap((file) => collectImportSpecifiers(readFileSync(file, "utf8")))
      .filter(isForbiddenImportSpecifier);

    expect(forbiddenSpecifiers).toEqual([]);
  });

  it("keeps the editor-ui manifest free of platform-only packages", () => {
    const dependencyNames = new Set([
      ...Object.keys(packageJson.dependencies ?? {}),
      ...Object.keys(packageJson.devDependencies ?? {}),
      ...Object.keys(packageJson.peerDependencies ?? {})
    ]);

    expect(dependencyNames.has("@tauri-apps/api")).toBe(false);
    expect(dependencyNames.has("@md-editor/mdx-component-registry")).toBe(false);
  });

  it("keeps outline state reusable through markdown-fidelity instead of desktop stores", () => {
    expect(outlineControllerSource).toContain("@md-editor/markdown-fidelity");
    expect(outlineControllerSource).not.toContain("useOutlineStore");
    expect(outlineControllerSource).not.toContain("apps/desktop");
  });
});

function sourceFiles(root: URL): string[] {
  return listFiles(root.pathname).filter((file) => extname(file) === ".ts" || extname(file) === ".tsx");
}

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}

function collectImportSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const importExportPattern =
    /\b(?:import|export)\s+(?:type\s+)?(?:[^"']*?\s+from\s+)?["']([^"']+)["']/gu;
  const dynamicImportPattern = /\bimport\(\s*["']([^"']+)["']\s*\)/gu;

  for (const match of source.matchAll(importExportPattern)) {
    specifiers.push(match[1] ?? "");
  }
  for (const match of source.matchAll(dynamicImportPattern)) {
    specifiers.push(match[1] ?? "");
  }

  return specifiers.filter(Boolean);
}

function isForbiddenImportSpecifier(specifier: string): boolean {
  return (
    specifier.includes("apps/desktop") ||
    specifier.includes("editor-runtime") ||
    specifier === "@tauri-apps/api" ||
    specifier.startsWith("@tauri-apps/api/") ||
    specifier === "@md-editor/editor-core/ai" ||
    specifier === "@md-editor/mdx-component-registry" ||
    specifier.startsWith("@md-editor/mdx-component-registry/")
  );
}
