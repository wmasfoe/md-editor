/**
 * 注册失败必须回滚注册表，否则失败的插件永久占用 ID。
 *
 * 实测缺陷（PR #295 复审指出）：注册一个引用不存在 Lezer parser 的插件，
 * 第一次抛 `Position specified relative to unknown parser MissingParser`；
 * 修正配置后用**同一个 ID** 重试，得到 `Syntax plugin already registered: custom`。
 *
 * 根因是顺序：`registerSyntaxPlugins` 先写注册表，再构建语言扩展并 dispatch。
 * 而这类错误是**惰性**的——发生在 dispatch 期间的视图解析里，
 * 调用方拿不到句柄，桌面侧的逐项回滚也就无从下手（它只回滚已拿到的句柄）。
 *
 * 因此两条注册路径都必须：取快照 → 变更 + 构建 + dispatch → 失败则还原。
 * 快照必须连注册代号一起还原，否则已发出的句柄在回滚后失效。
 */
import { describe, expect, it } from "vitest";
import { createDocumentState } from "@md-editor/core";
import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";

import { createRendererTestHarness, type RendererTestHarness } from "../../src/testing.ts";

function createHarness(markdown = "# A\n\n:::\n"): RendererTestHarness {
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

/** 引用不存在的 Lezer parser：视图解析到 `:::` 时抛错。 */
const brokenPlugin = {
  id: "custom",
  name: "custom",
  markdownExtension: {
    parseBlock: [
      {
        name: "MissingParser",
        parse() {
          throw new Error("Position specified relative to unknown parser MissingParser");
        },
      },
    ],
  },
} as unknown as MarkdownSyntaxPlugin;

/** 修正后的同 ID 插件。 */
const fixedPlugin = {
  id: "custom",
  name: "custom",
  markdownExtension: { defineNodes: ["CustomNode"] },
} as unknown as MarkdownSyntaxPlugin;

describe("命令式注册失败后必须能同 ID 重试", () => {
  it("抛错后同 ID 的修正插件能立即注册", () => {
    const harness = createHarness();
    expect(() => harness.renderer.addSyntaxPlugin(brokenPlugin)).toThrow(/MissingParser/u);

    // 关键断言：注册表已还原，同 ID 不再冲突。
    expect(() => harness.renderer.addSyntaxPlugin(fixedPlugin)).not.toThrow();
    harness.renderer.destroy();
  });

  it("失败的插件不得残留在注册表里", () => {
    const harness = createHarness();
    try {
      harness.renderer.addSyntaxPlugin(brokenPlugin);
    } catch {
      // 预期抛错
    }
    // 再次注册同 ID 若成功，说明第一次的条目已回滚。
    const handle = harness.renderer.addSyntaxPlugin(fixedPlugin);
    expect(() => handle.dispose()).not.toThrow();
    harness.renderer.destroy();
  });

  it("回滚不影响失败前已注册的其他插件", () => {
    const harness = createHarness();
    const keep = { id: "keep", name: "keep" } as unknown as MarkdownSyntaxPlugin;
    const keepHandle = harness.renderer.addSyntaxPlugin(keep);

    expect(() => harness.renderer.addSyntaxPlugin(brokenPlugin)).toThrow(/MissingParser/u);

    // keep 仍在：回滚只撤销本次失败的注册。
    expect(() => harness.renderer.addSyntaxPlugin({ id: "keep", name: "keep" } as never)).toThrow(
      /already registered/u,
    );
    expect(() => keepHandle.dispose()).not.toThrow();
    harness.renderer.destroy();
  });
});

describe("全量替换失败后同样回滚", () => {
  it("setSyntaxPlugins 抛错后同 ID 能立即用声明式注册", () => {
    const harness = createHarness();
    expect(() => harness.renderer.setSyntaxPlugins([brokenPlugin])).toThrow(/MissingParser/u);

    expect(() => harness.renderer.setSyntaxPlugins([fixedPlugin])).not.toThrow();
    harness.renderer.destroy();
  });

  it("替换失败后原有声明式插件仍在", () => {
    const harness = createHarness();
    const stable = { id: "stable", name: "stable" } as unknown as MarkdownSyntaxPlugin;
    harness.renderer.setSyntaxPlugins([stable]);

    expect(() => harness.renderer.setSyntaxPlugins([brokenPlugin])).toThrow(/MissingParser/u);

    // stable 未被替换掉：同 ID 再注册应当冲突。
    expect(() => harness.renderer.setSyntaxPlugins([stable])).not.toThrow();
    harness.renderer.destroy();
  });
});
