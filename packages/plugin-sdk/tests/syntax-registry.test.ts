import { describe, expect, it } from "vitest";
import {
  SyntaxPluginRegistry,
  type MarkdownSyntaxPlugin,
  type PluginRegistrationOrigin,
} from "../src/syntax.ts";

const plugin = (id: string): MarkdownSyntaxPlugin => ({ id, name: id });

/**
 * G-12：声明式与命令式分命名空间。
 *
 * 回归场景：用户在设置里切换任一内置插件开关 → 走全量替换。若全量替换把
 * `addSyntaxPlugin` 注册的条目一起清空，外部插件会**静默消失**（无报错、无重放）。
 */
describe("声明式 / 命令式分命名空间", () => {
  it("replaceDeclarative 保留命令式注册", () => {
    const registry = new SyntaxPluginRegistry();
    registry.register(plugin("builtin.math"), "declarative");
    registry.register(plugin("external.mermaid"), "imperative");

    registry.replaceDeclarative([plugin("builtin.math"), plugin("builtin.directive")]);

    const ids = registry.plugins.map((item) => item.id).toSorted();
    expect(ids).toEqual(["builtin.directive", "builtin.math", "external.mermaid"]);
  });

  it("replaceDeclarative 会移除不再声明的内置插件", () => {
    const registry = new SyntaxPluginRegistry([plugin("a"), plugin("b")]);
    registry.replaceDeclarative([plugin("a")]);
    expect(registry.plugins.map((item) => item.id)).toEqual(["a"]);
  });

  it("同一 id 跨命名空间冲突仍然抛错（单一 id 空间）", () => {
    const registry = new SyntaxPluginRegistry();
    registry.register(plugin("same"), "imperative");
    expect(() => registry.replaceDeclarative([plugin("same")])).toThrow(/already registered/u);
  });

  it("替换失败时保留原注册表（原子性）", () => {
    const registry = new SyntaxPluginRegistry([plugin("kept")]);
    expect(() => registry.replaceDeclarative([plugin("kept"), plugin("kept")])).toThrow(
      /already registered/u,
    );
    expect(registry.plugins.map((item) => item.id)).toEqual(["kept"]);
  });
});

describe("dispose", () => {
  it("注销单个插件并释放其节点策略", () => {
    const registry = new SyntaxPluginRegistry();
    registry.register(
      { id: "with-node", name: "with-node", nodePolicy: { nodeName: "Custom", kind: "decorated" } },
      "imperative",
    );
    expect(registry.getNodePolicy("Custom")).not.toBeNull();
    expect(registry.dispose("with-node")).toBe(true);
    expect(registry.getNodePolicy("Custom")).toBeNull();
    expect(registry.plugins).toEqual([]);
  });

  it("幂等：重复 dispose 返回 false", () => {
    const registry = new SyntaxPluginRegistry([plugin("once")]);
    expect(registry.dispose("once")).toBe(true);
    expect(registry.dispose("once")).toBe(false);
  });

  it("dispose 之后同名插件可以重新注册（身份守卫的前提）", () => {
    const registry = new SyntaxPluginRegistry();
    registry.register(plugin("temp"), "imperative");
    registry.dispose("temp");
    registry.register({ id: "temp", name: "renewed" });
    expect(registry.plugins[0]?.name).toBe("renewed");
  });
});

describe("registerAll 的来源透传", () => {
  it("批量注册可标记为命令式，从而在全量替换中存活", () => {
    const origin: PluginRegistrationOrigin = "imperative";
    const registry = new SyntaxPluginRegistry();
    registry.registerAll([plugin("x"), plugin("y")], origin);
    registry.replaceDeclarative([]);
    expect(registry.plugins.map((item) => item.id).toSorted()).toEqual(["x", "y"]);
  });
});
