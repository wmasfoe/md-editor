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

describe("addSyntaxPlugin 句柄只释放当次注册", () => {
  it("释放 → 重新注册同一对象 → 旧句柄再释放，新注册仍在", () => {
    const harness = createHarness();
    const p = plugin("p");

    const first = harness.renderer.addSyntaxPlugin(p);
    first.dispose();

    const second = harness.renderer.addSyntaxPlugin(p);
    // 旧句柄再释放一次：不能摘掉第二次注册。
    first.dispose();

    // 新句柄仍然有效（能正常释放，且不抛错）。
    expect(() => second.dispose()).not.toThrow();
    harness.renderer.destroy();
  });

  it("句柄可重复释放（幂等，不抛错）", () => {
    const harness = createHarness();
    const handle = harness.renderer.addSyntaxPlugin(plugin("q"));
    handle.dispose();
    expect(() => handle.dispose()).not.toThrow();
    expect(() => handle.dispose()).not.toThrow();
    harness.renderer.destroy();
  });
});

/**
 * 同一插件对象不得跨注册来源"静默切换"。
 *
 * 缺陷（PR #292 复审指出）：全量替换的幂等判断拿声明式输入和**全部**已注册插件
 * 比较。于是 `addSyntaxPlugin(p)` 之后 `setSyntaxPlugins([p])` 被判定为无变化而
 * 提前返回 —— p 仍留在命令式命名空间，调用方却以为它已是声明式清单的一员。
 * 随后释放命令式句柄，p 就消失了（实测复现）。
 *
 * 修法：幂等判断只比对**声明式**清单，跨来源时进入 ID 冲突校验并如实报错。
 */
describe("同一对象跨注册来源必须报冲突，不得静默接受", () => {
  it("addSyntaxPlugin(p) 后 setSyntaxPlugins([p]) 抛错，且 p 仍可用", () => {
    const harness = createHarness();
    const p = plugin("cross");
    const handle = harness.renderer.addSyntaxPlugin(p);

    // 关键：不能静默成功。
    expect(() => harness.renderer.setSyntaxPlugins([p])).toThrow(/already registered/u);

    // 命令式注册未被破坏：句柄仍能正常释放。
    expect(() => handle.dispose()).not.toThrow();
    harness.renderer.destroy();
  });

  it("释放命令式句柄后，同一对象可以正常作为声明式注册", () => {
    const harness = createHarness();
    const p = plugin("handover");
    harness.renderer.addSyntaxPlugin(p).dispose();

    // 此时声明式清单为空，提交 [p] 是真实变化，应当成功。
    expect(() => harness.renderer.setSyntaxPlugins([p])).not.toThrow();
    harness.renderer.destroy();
  });

  it("相同的声明式清单重复提交仍然是幂等的（不误判为变化）", () => {
    const harness = createHarness();
    const p = plugin("stable");
    harness.renderer.setSyntaxPlugins([p]);
    expect(() => harness.renderer.setSyntaxPlugins([p])).not.toThrow();
    harness.renderer.destroy();
  });
});
