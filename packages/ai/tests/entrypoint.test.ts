import { describe, expect, it } from "vitest";
import { createAiCacheKey, getAiCompletionReadiness } from "../src/index.ts";

describe("AI package entrypoint", () => {
  it("exposes platform-free AI capabilities", () => {
    expect(typeof getAiCompletionReadiness).toBe("function");
    expect(typeof createAiCacheKey).toBe("function");
  });
});

describe("AI package main entry import graph", () => {
  it("U-ENT-1: never reaches marked or the style extraction module", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const entry = fileURLToPath(new URL("../src/index.ts", import.meta.url));
    const visited = new Set<string>();
    const external = new Set<string>();
    const queue = [entry];
    // 覆盖 `import x from "y"`、`export * from "y"` 与副作用导入 `import "y"`。
    const importPattern =
      /(?:\b(?:import|export)\b[^"';]*?\bfrom\s*|\bimport\s*)["']([^"']+)["']/gu;

    while (queue.length > 0) {
      const file = queue.pop()!;
      if (visited.has(file)) continue;
      visited.add(file);
      for (const match of readFileSync(file, "utf8").matchAll(importPattern)) {
        const specifier = match[1]!;
        if (specifier.startsWith(".")) {
          queue.push(resolve(dirname(file), specifier));
        } else {
          external.add(specifier);
        }
      }
    }

    expect(external.has("marked")).toBe(false);
    expect([...visited].some((file) => file.endsWith("/style/extraction.ts"))).toBe(false);
    expect([...visited].some((file) => file.endsWith("/style/engine.ts"))).toBe(false);
  });
});
