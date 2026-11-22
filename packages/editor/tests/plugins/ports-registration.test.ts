import { describe, expect, it } from "vitest";
import { createDocumentState } from "@md-editor/core";
import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";
import { createRendererTestHarness, type RendererTestHarness } from "../../src/testing.ts";

const plugin = (id: string, withExtension = false): MarkdownSyntaxPlugin =>
  withExtension
    ? { id, name: id, markdownExtension: { defineNodes: [] } }
    : { id, name: id, buildDecorations: () => [] };

function createHarness(): RendererTestHarness {
  const document = createDocumentState({ markdown: "alpha\n" });
  return createRendererTestHarness({
    initialSnapshot: document.getSnapshot(),
    onEditorChange(change) {
      document.applyEditorChange(change.markdown, change.origin);
    },
    onQueuedExternalEditReady() {},
    onQueuedExternalEditCancelled() {},
  });
}

describe("G-5 destroyed 之后不得静默成功", () => {
  it("addSyntaxPlugin 抛错", () => {
    const harness = createHarness();
    harness.renderer.destroy();
    expect(() => harness.renderer.addSyntaxPlugin(plugin("late"))).toThrow(/destroyed/u);
  });

  it("setSyntaxPlugins 抛错", () => {
    const harness = createHarness();
    harness.renderer.destroy();
    expect(() => harness.renderer.setSyntaxPlugins([plugin("late")])).toThrow(/destroyed/u);
  });

  it("已发出的句柄在销毁后 dispose 是安全的 no-op", () => {
    const harness = createHarness();
    const handle = harness.renderer.addSyntaxPlugin(plugin("early"));
    harness.renderer.destroy();
    expect(() => handle.dispose()).not.toThrow();
  });
});

describe("G-3/G-7 增量注册与身份守卫", () => {
  it("句柄 dispose 后同一 id 可以重新注册", () => {
    const harness = createHarness();
    const first = harness.renderer.addSyntaxPlugin(plugin("demo"));
    first.dispose();
    expect(() => harness.renderer.addSyntaxPlugin(plugin("demo", true))).not.toThrow();
  });

  it("重复 id 在增量注册时抛错（与 plugin-sdk register 同语义）", () => {
    const harness = createHarness();
    harness.renderer.addSyntaxPlugin(plugin("dup"));
    expect(() => harness.renderer.addSyntaxPlugin(plugin("dup"))).toThrow(/already registered/u);
  });

  it("旧句柄不得摘掉后来注册的同名插件（身份守卫）", () => {
    const harness = createHarness();
    const stale = harness.renderer.addSyntaxPlugin(plugin("swap"));
    stale.dispose();
    const fresh = harness.renderer.addSyntaxPlugin(plugin("swap", true));
    // 再次 dispose 旧句柄：id 存在但实例已换，必须不生效。
    stale.dispose();
    expect(() => harness.renderer.addSyntaxPlugin(plugin("swap"))).toThrow(/already registered/u);
    fresh.dispose();
  });
});

describe("G-1 声明式与命令式共享同一 id 空间", () => {
  it("setSyntaxPlugins 注册过的 id，再 addSyntaxPlugin 会抛错", () => {
    const harness = createHarness();
    harness.renderer.setSyntaxPlugins([plugin("shared")]);
    expect(() => harness.renderer.addSyntaxPlugin(plugin("shared", true))).toThrow(
      /already registered/u,
    );
  });

  it("addSyntaxPlugin 注册过的 id，再 setSyntaxPlugins 也会抛错", () => {
    const harness = createHarness();
    harness.renderer.addSyntaxPlugin(plugin("shared", true));
    expect(() => harness.renderer.setSyntaxPlugins([plugin("shared")])).toThrow(
      /already registered/u,
    );
  });

  it("setSyntaxPlugins 不会清掉 addSyntaxPlugin 的注册（G-12 的端口层证据）", () => {
    const harness = createHarness();
    harness.renderer.addSyntaxPlugin(plugin("imperative"));
    harness.renderer.setSyntaxPlugins([plugin("declarative")]);
    // 命令式条目仍在：同 id 再注册仍然冲突。
    expect(() => harness.renderer.addSyntaxPlugin(plugin("imperative"))).toThrow(
      /already registered/u,
    );
  });
});
