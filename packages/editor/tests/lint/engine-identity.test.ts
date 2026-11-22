/**
 * 引擎同一性：按**函数身份**比较，而不是引擎对象。
 *
 * README 推荐的 `markdownlint={{ lint }}` 每次宿主渲染都产生新对象。若按对象身份判断，
 * 宿主每次重渲染都会 reconfigure 一次 compartment；开关开着时还会重跑整份 lint。
 * 这两个测试分别锁住 React 层与控制器层的兜底。
 */
import { describe, expect, it, vi } from "vitest";
import { createDocumentState } from "@md-editor/core";
import { lint as markdownlintLint } from "markdownlint/sync";

import type { MarkdownLintResult } from "../../src/lint/engine.ts";
import { createRendererTestHarness } from "../../src/testing.ts";

const lintFn = (request: Parameters<typeof markdownlintLint>[0]) =>
  markdownlintLint(request) as unknown as MarkdownLintResult;

function createHarness() {
  const document = createDocumentState({ markdown: "# A\ntext\n- item\n" });
  return createRendererTestHarness({
    initialSnapshot: document.getSnapshot(),
    onEditorChange(change) {
      document.applyEditorChange(change.markdown, change.origin);
    },
    onQueuedExternalEditReady() {},
    onQueuedExternalEditCancelled() {},
  });
}

describe("setMarkdownLintEngine 按函数身份判等", () => {
  it("新的引擎对象但函数相同 → noop（内联字面量不会重复重配）", () => {
    const harness = createHarness();
    expect(harness.renderer.setMarkdownLintEngine({ lint: lintFn })).toEqual({ status: "applied" });
    // 模拟宿主每次渲染都写 `markdownlint={{ lint }}`：对象是新的，lint 是同一个。
    expect(harness.renderer.setMarkdownLintEngine({ lint: lintFn })).toEqual({ status: "noop" });
    harness.renderer.destroy();
  });

  it("函数变了 → applied（真的换了引擎）", () => {
    const harness = createHarness();
    harness.renderer.setMarkdownLintEngine({ lint: lintFn });
    const otherLint = vi.fn(() => ({}) as unknown as MarkdownLintResult);
    expect(harness.renderer.setMarkdownLintEngine({ lint: otherLint })).toEqual({
      status: "applied",
    });
    harness.renderer.destroy();
  });

  it("undefined → 引擎、引擎 → undefined 都算变更", () => {
    const harness = createHarness();
    expect(harness.renderer.setMarkdownLintEngine(undefined)).toEqual({ status: "noop" });
    expect(harness.renderer.setMarkdownLintEngine({ lint: lintFn })).toEqual({ status: "applied" });
    expect(harness.renderer.setMarkdownLintEngine(undefined)).toEqual({ status: "applied" });
    harness.renderer.destroy();
  });
});

describe("setMarkdownLint 先校验后落状态", () => {
  it("没有引擎时开启抛错，且状态不变成『已开启』（再次尝试仍会抛）", () => {
    const harness = createHarness();
    expect(() => harness.renderer.setMarkdownLint(true)).toThrow(/engine/iu);
    // 关键：不能因为上次抛错就停在"已开启"，否则下次直接 noop、lint 永不生效。
    expect(() => harness.renderer.setMarkdownLint(true)).toThrow(/engine/iu);
    harness.renderer.destroy();
  });

  it("注入引擎后能正常开启", () => {
    const harness = createHarness();
    harness.renderer.setMarkdownLintEngine({ lint: lintFn });
    expect(harness.renderer.setMarkdownLint(true)).toEqual({ status: "applied" });
    expect(harness.renderer.setMarkdownLint(true)).toEqual({ status: "noop" });
    harness.renderer.destroy();
  });
});
