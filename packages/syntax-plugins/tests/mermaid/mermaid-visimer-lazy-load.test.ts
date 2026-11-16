import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 体积护栏：Visimer 必须保持**按需动态导入**。
 *
 * 为什么需要它：`mermaidPlugin` 从包根再导出，`mermaid-graphical-editor.ts` 因此位于
 * 宿主**启动即加载**的 chunk 内。若把 `@visimer/core` / `@visimer/dom` 改回静态 import，
 * 每个从未渲染图表的宿主都要多付约 53 KB gzip，而现有单测与 e2e **全部照常通过**
 * （护栏会腐烂）。实测改动前 Web 启动 chunk 122 KB → 改动后 82 KB gzip。
 *
 * 判据只看源码：静态 import/export 说明符里不得出现 `@visimer/*`；动态 `import("...")` 允许。
 */
const MERMAID_SRC = fileURLToPath(new URL("../../src/mermaid", import.meta.url));

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    return statSync(path).isDirectory() ? sourceFiles(path) : [path];
  });
}

/** 提取**静态值导入**的模块说明符。
 *
 * 排除两类：
 * - 动态 `import("...")`：允许，正是本护栏要保留的懒加载方式；
 * - `import type ... from`：纯类型导入，构建时被完全擦除，不进入 bundle。
 */
export function staticSpecifiers(source: string): readonly string[] {
  const specifiers: string[] = [];
  const patterns = [
    // import x from "m" / import {a} from "m" / import "m"（
    // `import type` 由下方负向断言排除，因为它是纯类型导入）
    /^\s*import\s+(?!type\s[\s\S]*?\bfrom\b)(?:[\s\S]*?\s+from\s+)?["']([^"']+)["']/gmu,
    // export {a} from "m" / export * from "m"（`export type ... from` 同理）
    /^\s*export\s+(?!type\s[\s\S]*?\bfrom\b)[\s\S]*?\s+from\s+["']([^"']+)["']/gmu,
  ];
  for (const pattern of patterns) {
    for (const match of source.matchAll(pattern)) specifiers.push(match[1]!);
  }
  return specifiers;
}

describe("Visimer 按需加载护栏", () => {
  it("mermaid 源码里没有对 @visimer/* 的静态 import 或 re-export", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(MERMAID_SRC)) {
      if (!/\.tsx?$/u.test(file)) continue;
      const source = readFileSync(file, "utf-8");
      for (const specifier of staticSpecifiers(source)) {
        if (specifier.startsWith("@visimer/")) {
          offenders.push(`${file.slice(MERMAID_SRC.length + 1)} → ${specifier}`);
        }
      }
    }
    expect(
      offenders,
      "Visimer 必须用 import() 动态加载，否则未使用图表的宿主也要付约 53 KB gzip（见 status 文档体积记录）",
    ).toEqual([]);
  });

  it("判别力：静态 import 会被抓出，动态 import 与类型导入不会误报", () => {
    expect(staticSpecifiers('import { a } from "@visimer/core";\n')).toEqual(["@visimer/core"]);
    expect(staticSpecifiers('export { a } from "@visimer/dom";\n')).toEqual(["@visimer/dom"]);
    expect(staticSpecifiers('import "@visimer/dom";\n')).toEqual(["@visimer/dom"]);
    // 类型导入在构建时被完全擦除，不得误报。
    expect(staticSpecifiers('import type { A } from "@visimer/core";\n')).toEqual([]);
    expect(staticSpecifiers('export type { A } from "@visimer/dom";\n')).toEqual([]);
    expect(staticSpecifiers('const m = await import("@visimer/core");\n')).toEqual([]);
    expect(staticSpecifiers('import { x } from "./local.ts";\n')).toEqual(["./local.ts"]);
  });

  it("图形编辑器确实通过动态导入加载 Visimer", () => {
    const source = readFileSync(join(MERMAID_SRC, "mermaid-graphical-editor.ts"), "utf-8");
    expect(source).toContain('import("@visimer/core")');
    expect(source).toContain('import("@visimer/dom")');
  });

  it("能力检查通过后预取画布模块，否则离线时既有图表不可编辑", () => {
    const source = readFileSync(join(MERMAID_SRC, "mermaid-graphical-editor.ts"), "utf-8");
    // Regression: the canvas chunk is fetched on first edit. A host that is already
    // offline cannot resolve a chunk it never downloaded, so `inspect()` — which runs
    // while the document is still online — must warm it (test spec H3: offline
    // preview/create/edit must work with local resources only).
    // The behavioural contract itself is covered by the Web offline e2e; this guards
    // that the warm-up is not deleted as "unused" during a refactor.
    expect(source).toMatch(/function warmEditorModules\(\): void/u);
    expect(source).toContain("void loadVisimerDom()");
    const inspectStart = source.indexOf("async function inspectSource");
    const inspectEnd = source.indexOf("\n}\n", inspectStart);
    expect(source.slice(inspectStart, inspectEnd)).toContain("warmEditorModules();");
  });
});
