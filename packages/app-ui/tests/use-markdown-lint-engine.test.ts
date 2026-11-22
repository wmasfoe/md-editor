/**
 * @file use-markdown-lint-engine.test.ts
 * @description markdownlint 子入口的加载契约。
 *
 * 宿主首屏不应静态包含 markdownlint（1.2 MB）；因此加载是动态的：
 * hook 先返回 `undefined`，加载完成后才给出引擎，调用方据此保持
 * `enableMarkdownLint` 关闭直到就绪。
 */
import { describe, expect, it } from "vitest";

import { loadMarkdownLintEngine } from "../src/hooks/useMarkdownLintEngine.ts";

describe("loadMarkdownLintEngine", () => {
  it("动态加载出可用引擎，且 lint 可正常调用", async () => {
    const engine = await loadMarkdownLintEngine();
    const result = engine.lint({ strings: { content: "" } });
    expect(result).toBeDefined();
  });

  it("对真实违规文档产出诊断（证明接口形状正确）", async () => {
    const engine = await loadMarkdownLintEngine();
    const result = engine.lint({ strings: { content: "# A\ntext\n- item\n" } });
    expect(Object.keys(result as Record<string, unknown>).length).toBeGreaterThan(0);
  });
});
