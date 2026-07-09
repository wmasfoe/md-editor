import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = new URL("../src", import.meta.url);
const packageJsonUrl = new URL("../package.json", import.meta.url);

describe("editor-core AI boundary", () => {
  it("keeps source free of platform and React imports", () => {
    const source = sourceFiles(sourceRoot)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    expect(source).not.toContain("@tauri-apps/api");
    expect(source).not.toMatch(/from\s+["']react["']/u);
    expect(source).not.toMatch(/from\s+["']react-dom["']/u);
    expect(source).not.toContain("apps/desktop");
  });

  it("keeps the package manifest free of platform and React dependencies", () => {
    const manifest = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as {
      readonly exports?: Record<string, string>;
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
      readonly peerDependencies?: Record<string, string>;
    };
    const dependencyNames = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {})
    ]);

    expect(dependencyNames.has("@tauri-apps/api")).toBe(false);
    expect(dependencyNames.has("react")).toBe(false);
    expect(dependencyNames.has("react-dom")).toBe(false);
  });

  it("keeps AI imports out of editor-core exports", () => {
    const manifest = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as {
      readonly exports?: Record<string, string>;
      readonly dependencies?: Record<string, string>;
    };
    const packageEntry = readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");

    expect(manifest.exports?.["./ai"]).toBeUndefined();
    expect(manifest.dependencies?.["@md-editor/ai"]).toBeUndefined();
    expect(packageEntry).not.toContain("./ai");
    expect(packageEntry).not.toContain("@md-editor/ai");
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
