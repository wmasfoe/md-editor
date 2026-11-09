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
    // 同时覆盖静态导入、`export ... from`、副作用导入与动态 `import("...")`。
    const importPattern =
      /(?:\b(?:import|export)\b[^"';]*?\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/gu;

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

describe("light style entry import graph", () => {
  it("U-ENT-2: @md-editor/ai/style never reaches marked or the engine", async () => {
    const { readFileSync } = await import("node:fs");
    const { dirname, resolve } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    const entry = fileURLToPath(new URL("../src/style/index.ts", import.meta.url));
    const visited = new Set<string>();
    const external = new Set<string>();
    const queue = [entry];
    // 同时覆盖静态导入、`export ... from`、副作用导入与动态 `import("...")`。
    const importPattern =
      /(?:\b(?:import|export)\b[^"';]*?\bfrom\s*|\bimport\s*\(?\s*)["']([^"']+)["']/gu;

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

    expect([...external]).toEqual([]);
    // classify.ts 只依赖 domain 类型，不含 Markdown 解析器，可以出现在轻量入口；
    // extraction.ts（marked）与 engine.ts（学习轮次）不允许。
    for (const forbidden of ["extraction.ts", "engine.ts"]) {
      expect([...visited].some((file) => file.endsWith(`/style/${forbidden}`))).toBe(false);
    }
  });
});
