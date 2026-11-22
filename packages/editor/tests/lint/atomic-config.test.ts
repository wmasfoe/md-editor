/**
 * lint 引擎与开关必须**原子提交**。
 *
 * 历史缺陷：React 侧 `setMarkdownLintEngine` 与 `setMarkdownLint` 是两个 effect。
 * 从「有引擎 + 已开启」切到「无引擎 + 已关闭」时，引擎 effect 先跑（撤出引擎、
 * 控制器落新值），开关 effect 随后仍带着旧值 `true` 进来，此时 state 上已经没有
 * 引擎 → 抛错。单纯调换两个 effect 的顺序只是把问题挪到"开启"路径。
 *
 * 正确做法：一次提交 `{ engine, enabled }` 目标组合，先校验，再单事务应用。
 */
import { describe, expect, it } from "vitest";
import { createDocumentState } from "@md-editor/core";
import { lint as markdownlintLint } from "markdownlint/sync";

import type { MarkdownLintResult } from "../../src/lint/engine.ts";
import { createRendererTestHarness } from "../../src/testing.ts";

const lintFn = (request: Parameters<typeof markdownlintLint>[0]) =>
  markdownlintLint(request) as unknown as MarkdownLintResult;

function createHarness() {
  const document = createDocumentState({ markdown: "# A\ntext\n" });
  return createRendererTestHarness({
    initialSnapshot: document.getSnapshot(),
    onEditorChange(change) {
      document.applyEditorChange(change.markdown, change.origin);
    },
    onQueuedExternalEditReady() {},
    onQueuedExternalEditCancelled() {},
  });
}

describe("configureMarkdownLint：一次提交目标组合", () => {
  it("同一轮同时注入引擎并启用", () => {
    const harness = createHarness();
    const result = harness.renderer.configureMarkdownLint({
      engine: { lint: lintFn },
      enabled: true,
    });
    expect(result).toEqual({ status: "applied" });
    expect(harness.renderer.getMarkdownLintState()).toEqual({
      enabled: true,
      hasEngine: true,
    });
    harness.renderer.destroy();
  });

  it("同一轮同时撤出引擎并关闭（这是旧实现会抛错的路径）", () => {
    const harness = createHarness();
    harness.renderer.configureMarkdownLint({ engine: { lint: lintFn }, enabled: true });

    // 关键断言：不能抛错。
    expect(() =>
      harness.renderer.configureMarkdownLint({ engine: undefined, enabled: false }),
    ).not.toThrow();
    expect(harness.renderer.getMarkdownLintState()).toEqual({
      enabled: false,
      hasEngine: false,
    });
    harness.renderer.destroy();
  });

  it("开启但无引擎立即抛错（保留既有契约，不静默无诊断）", () => {
    const harness = createHarness();
    expect(() =>
      harness.renderer.configureMarkdownLint({ engine: undefined, enabled: true }),
    ).toThrow(/engine/iu);
    // 失败后状态不变。
    expect(harness.renderer.getMarkdownLintState()).toEqual({
      enabled: false,
      hasEngine: false,
    });
    harness.renderer.destroy();
  });

  it("非法组合失败后旧配置仍可用（不是半提交状态）", () => {
    const harness = createHarness();
    harness.renderer.configureMarkdownLint({ engine: { lint: lintFn }, enabled: true });

    expect(() =>
      harness.renderer.configureMarkdownLint({ engine: undefined, enabled: true }),
    ).toThrow(/engine/iu);

    // 旧配置完好：仍启用、仍有引擎。
    expect(harness.renderer.getMarkdownLintState()).toEqual({
      enabled: true,
      hasEngine: true,
    });
    // 且仍能正常工作。
    expect(harness.renderer.recomputeMarkdownLint()).toEqual({ status: "applied" });
    harness.renderer.destroy();
  });

  it("引擎对象换了但函数身份相同 → noop（内联字面量不重复重配）", () => {
    const harness = createHarness();
    harness.renderer.configureMarkdownLint({ engine: { lint: lintFn }, enabled: true });
    expect(
      harness.renderer.configureMarkdownLint({ engine: { lint: lintFn }, enabled: true }),
    ).toEqual({ status: "noop" });
    harness.renderer.destroy();
  });

  it("只改开关（引擎不变）也算变更", () => {
    const harness = createHarness();
    const engine = { lint: lintFn };
    harness.renderer.configureMarkdownLint({ engine, enabled: false });
    expect(harness.renderer.configureMarkdownLint({ engine, enabled: true })).toEqual({
      status: "applied",
    });
    harness.renderer.destroy();
  });
});

describe("命令式端口委托给同一实现", () => {
  it("setMarkdownLintEngine + setMarkdownLint 组合仍可用", () => {
    const harness = createHarness();
    expect(harness.renderer.setMarkdownLintEngine({ lint: lintFn })).toEqual({
      status: "applied",
    });
    expect(harness.renderer.setMarkdownLint(true)).toEqual({ status: "applied" });
    expect(harness.renderer.getMarkdownLintState()).toEqual({
      enabled: true,
      hasEngine: true,
    });
    harness.renderer.destroy();
  });
});
