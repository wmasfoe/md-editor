import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("compiler callout import boundary", () => {
  it("imports callout data without the syntax entry", () => {
    const src = fileURLToPath(new URL("../src/", import.meta.url));
    const offenders = sourceFiles(src).filter((file) =>
      readFileSync(file, "utf8").includes("@md-editor/plugin-sdk/syntax"),
    );
    expect(offenders).toEqual([]);
  });
});
