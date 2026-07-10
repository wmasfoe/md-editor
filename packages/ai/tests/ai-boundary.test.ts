import { readdirSync, readFileSync, statSync } from "node:fs";
import { extname, join } from "node:path";
import { describe, expect, it } from "vitest";

const sourceRoot = new URL("../src", import.meta.url);
const packageJsonUrl = new URL("../package.json", import.meta.url);

const forbiddenSourceImports = ["@tauri-apps/api", "@milkdown/", "prosemirror-", "apps/desktop"];

const forbiddenDependencies = [
  "@tauri-apps/api",
  "@milkdown/kit",
  "@milkdown/react",
  "react",
  "react-dom",
];

describe("AI package boundary", () => {
  it("keeps source free of platform, editor runtime, and React imports", () => {
    const source = sourceFiles(sourceRoot)
      .map((file) => readFileSync(file, "utf8"))
      .join("\n");

    for (const forbiddenImport of forbiddenSourceImports) {
      expect(source).not.toContain(forbiddenImport);
    }
    expect(source).not.toMatch(/from\s+["']react["']/u);
    expect(source).not.toMatch(/from\s+["']react-dom["']/u);
  });

  it("keeps the package manifest free of platform, editor runtime, and React dependencies", () => {
    const manifest = JSON.parse(readFileSync(packageJsonUrl, "utf8")) as {
      readonly dependencies?: Record<string, string>;
      readonly devDependencies?: Record<string, string>;
      readonly peerDependencies?: Record<string, string>;
    };
    const dependencyNames = new Set([
      ...Object.keys(manifest.dependencies ?? {}),
      ...Object.keys(manifest.devDependencies ?? {}),
      ...Object.keys(manifest.peerDependencies ?? {}),
    ]);

    for (const dependency of forbiddenDependencies) {
      expect(dependencyNames.has(dependency)).toBe(false);
    }
  });
});

function sourceFiles(root: URL): string[] {
  return listFiles(root.pathname).filter(
    (file) => extname(file) === ".ts" || extname(file) === ".tsx",
  );
}

function listFiles(directory: string): string[] {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory() ? listFiles(path) : [path];
  });
}
