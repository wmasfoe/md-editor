/**
 * 冲突校验必须覆盖**全部三路节点来源**，并且整批生效。
 *
 * 缺口（评审 A6）：SDK 的预检只算 `nodePolicies` 的键与 `nodePolicy.nodeName`，
 * **漏了 Lezer `defineNodes`**。两个不同 id 的外部插件各自 `defineNodes` 同名节点时
 * 预检放行，真正装配语言时才出问题。桌面侧同样只按 id 检查已注册的外部插件。
 *
 * 另一条：桌面 registrar 逐项 `register` 时，若第 2 个被拒，第 1 个已经落表 ——
 * 宿主留下半批状态。整批 `registerAll` 必须"要么全成、要么全不成"。
 */
import { describe, expect, it } from "vitest";

import { SyntaxPluginRegistry } from "../src/syntax-registry.ts";
import type { MarkdownSyntaxPlugin } from "../src/syntax.ts";

/** 只通过 Lezer `defineNodes` 声明节点（不写 nodePolicy）。 */
const defineNodesPlugin = (id: string, nodeName: string): MarkdownSyntaxPlugin =>
  ({
    id,
    name: id,
    markdownExtension: { defineNodes: [nodeName] },
  }) as unknown as MarkdownSyntaxPlugin;

const policyPlugin = (id: string, nodeName: string): MarkdownSyntaxPlugin =>
  ({
    id,
    name: id,
    nodePolicy: { nodeName, kind: "inline", isBlock: false },
  }) as unknown as MarkdownSyntaxPlugin;

describe("SDK 预检覆盖 defineNodes", () => {
  it("两个插件仅通过 defineNodes 声明同名节点 → 抛冲突", () => {
    const registry = new SyntaxPluginRegistry();
    registry.register(defineNodesPlugin("a", "SharedNode"));
    expect(() => registry.register(defineNodesPlugin("b", "SharedNode"))).toThrow(/SharedNode/u);
  });

  it("defineNodes 与 nodePolicy 声明同名节点 → 抛冲突（跨来源）", () => {
    const registry = new SyntaxPluginRegistry();
    registry.register(defineNodesPlugin("a", "CrossNode"));
    expect(() => registry.register(policyPlugin("b", "CrossNode"))).toThrow(/CrossNode/u);
  });

  it("registerAll 整批预检：批内两个插件撞节点 → 整批拒绝，注册表不变", () => {
    const registry = new SyntaxPluginRegistry();
    registry.register(defineNodesPlugin("existing", "ExistingNode"));
    const before = registry.plugins.map((p) => p.id);

    expect(() =>
      registry.registerAll([defineNodesPlugin("x", "DupNode"), defineNodesPlugin("y", "DupNode")]),
    ).toThrow(/DupNode/u);

    expect(registry.plugins.map((p) => p.id)).toEqual(before);
  });

  it("registerAll 失败后不留下半批（第一个也不得落表）", () => {
    const registry = new SyntaxPluginRegistry();
    expect(() =>
      registry.registerAll([defineNodesPlugin("ok", "OkNode"), policyPlugin("bad", "OkNode")]),
    ).toThrow(/already registered/u);
    expect(registry.plugins).toEqual([]);
  });

  it("节点名不冲突时 defineNodes 插件正常注册", () => {
    const registry = new SyntaxPluginRegistry();
    registry.register(defineNodesPlugin("a", "NodeA"));
    registry.register(defineNodesPlugin("b", "NodeB"));
    expect(registry.plugins.map((p) => p.id)).toEqual(["a", "b"]);
  });
});
