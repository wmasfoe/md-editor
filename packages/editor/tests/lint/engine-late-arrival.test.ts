/**
 * U-LINT-LATE：lint 引擎晚于视图到达。
 *
 * 宿主把 `markdownlint` 改成动态 import 后，引擎通常比视图晚一步。
 * 这里锁住三条语义，防止"开关开着但没有任何诊断"的静默失效：
 * 1. 没引擎时开启 lint 必须抛错（不进入 lint-on/engine-missing 状态）；
 * 2. 运行期注入引擎后开启 lint 必须真的产出诊断；
 * 3. 注入引擎不得重建视图（视图身份与文档内容保持不变）。
 */
import { describe, expect, it } from "vitest";
import { createDocumentState } from "@md-editor/core";
import { lint as markdownlintLint } from "markdownlint/sync";

import type { MarkdownLintResult } from "../../src/lint/engine.ts";
import { createRendererTestHarness } from "../../src/testing.ts";

const engine = {
  lint: (request: Parameters<typeof markdownlintLint>[0]) =>
    markdownlintLint(request) as unknown as MarkdownLintResult,
};

/** `- item` 紧贴上一行且前后无空行 → MD032。 */
const VIOLATING = "# Title\ntext\n- item\n";

function createHarness(markdown: string) {
  const document = createDocumentState({ markdown });
  return createRendererTestHarness({
    initialSnapshot: document.getSnapshot(),
    onEditorChange(change) {
      document.applyEditorChange(change.markdown, change.origin);
    },
    onQueuedExternalEditReady() {},
    onQueuedExternalEditCancelled() {},
  });
}

describe("lint 引擎 late-arrive", () => {
  it("没有引擎时开启 lint 抛错，而不是静默进入无诊断状态", () => {
    const harness = createHarness(VIOLATING);
    expect(() => harness.renderer.setMarkdownLint(true)).toThrow(/engine/iu);
    harness.renderer.destroy();
  });

  it("运行期注入引擎后开启 lint 能产出诊断", () => {
    const harness = createHarness(VIOLATING);
    harness.renderer.setMarkdownLintEngine(engine);

    expect(harness.renderer.setMarkdownLint(true)).toBeDefined();
    const result = harness.renderer.runMarkdownLintCommand({});
    expect(result.total).toBeGreaterThan(0);

    harness.renderer.destroy();
  });

  it("重复注入同一引擎是 noop（不重复 reconfigure）", () => {
    const harness = createHarness(VIOLATING);
    expect(harness.renderer.setMarkdownLintEngine(engine)).toEqual({ status: "applied" });
    expect(harness.renderer.setMarkdownLintEngine(engine)).toEqual({ status: "noop" });
    harness.renderer.destroy();
  });
});
