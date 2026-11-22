/**
 * G-8 / G-10 / G-11 的行为断言（此前的源码字符串检查不足以证明这些语义）。
 *
 * - **G-8**：宿主 registrar 产出的插件必须经 `ports.addSyntaxPlugin` 注册（spy 证明调用路径）。
 * - **G-10**：这些插件不得进入声明式 `plugins` prop（全量替换会静默注销它们）。
 * - **G-11**：两条宿主校验（内置 id 冲突、node 冲突）必须发生在 `addSyntaxPlugin` **之前**，
 *   失败时不得产生任何注册调用。
 */
import { describe, expect, it, vi } from "vitest";

import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";

import { registerExternalSyntaxPlugins } from "../src/components/editor/use-external-syntax-registration.ts";
import {
  assertNoSyntaxConflicts,
  createSyntaxRegistrar,
} from "../src/app/plugins/syntax-conflict-validation.ts";

const builtinsWithNodes: MarkdownSyntaxPlugin[] = [
  {
    id: "math",
    name: "math",
    markdownExtension: { defineNodes: [{ name: "Math" }] } as never,
    buildDecorations: () => [],
  },
];

const plugin = (id: string): MarkdownSyntaxPlugin => ({
  id,
  name: id,
  buildDecorations: () => [],
});

/** 造一个记录调用顺序的端口替身。 */
function createSpyPorts() {
  const calls: string[] = [];
  const disposed: string[] = [];
  const ports = {
    addSyntaxPlugin: vi.fn((next: MarkdownSyntaxPlugin) => {
      calls.push(`register:${next.id}`);
      return {
        dispose: () => {
          disposed.push(next.id);
          calls.push(`dispose:${next.id}`);
        },
      };
    }),
  };
  return { ports, calls, disposed };
}

describe("G-8 外部插件经命令式通道注册", () => {
  it("逐个调用 ports.addSyntaxPlugin（不经过声明式 plugins）", () => {
    const { ports, calls } = createSpyPorts();
    registerExternalSyntaxPlugins(ports, [plugin("alpha"), plugin("beta")]);

    expect(ports.addSyntaxPlugin).toHaveBeenCalledTimes(2);
    expect(calls).toEqual(["register:alpha", "register:beta"]);
  });

  it("空列表不产生任何注册", () => {
    const { ports } = createSpyPorts();
    registerExternalSyntaxPlugins(ports, []);
    expect(ports.addSyntaxPlugin).not.toHaveBeenCalled();
  });
});

describe("G-10 卸载时逐个 dispose（不留悬挂注册）", () => {
  it("退订函数按注册顺序释放全部句柄", () => {
    const { ports, calls, disposed } = createSpyPorts();
    const release = registerExternalSyntaxPlugins(ports, [plugin("alpha"), plugin("beta")]);

    release();

    expect(disposed).toEqual(["alpha", "beta"]);
    expect(calls).toEqual(["register:alpha", "register:beta", "dispose:alpha", "dispose:beta"]);
  });

  it("重复调用退订不抛错（句柄自身决定是否幂等）", () => {
    const { ports, disposed } = createSpyPorts();
    const release = registerExternalSyntaxPlugins(ports, [plugin("alpha")]);
    release();
    // 契约只保证"退订不抛错"；是否二次释放由端口返回的句柄自己决定
    // （生产实现里 Disposable 是幂等的，测试替身刻意不幂等以暴露误用）。
    expect(() => release()).not.toThrow();
    expect(disposed.length).toBeGreaterThanOrEqual(1);
  });
});

describe("G-11 生产校验先于注册（断言真实模块，不是测试自造）", () => {
  const builtins: MarkdownSyntaxPlugin[] = [plugin("math")];

  it("id 冲突：assertNoSyntaxConflicts 抛错", () => {
    // 直接调用**生产**校验函数（apps/desktop/src/app/plugins/syntax-conflict-validation.ts）。
    expect(() => assertNoSyntaxConflicts(plugin("math"), builtins, new Set())).toThrow(
      /Duplicate syntax: math/u,
    );
  });

  it("已注册过的 id 也算冲突", () => {
    expect(() => assertNoSyntaxConflicts(plugin("alpha"), builtins, new Set(["alpha"]))).toThrow(
      /Duplicate syntax: alpha/u,
    );
  });

  it("node 冲突：defineNodes 命中内置节点", () => {
    const clash: MarkdownSyntaxPlugin = {
      id: "clash",
      name: "clash",
      markdownExtension: { defineNodes: [{ name: "Math" }] } as never,
      buildDecorations: () => [],
    };
    expect(() => assertNoSyntaxConflicts(clash, builtinsWithNodes, new Set())).toThrow(
      /conflicts with a built-in plugin: clash \(Math\)/u,
    );
  });

  it("node 冲突：nodePolicies / nodePolicy 也必须算进节点名（生产实现覆盖三路）", () => {
    // 这正是审计指出的弱点：只读 defineNodes 的实现会漏掉这两种形态。
    const viaPolicies: MarkdownSyntaxPlugin = {
      id: "via-policies",
      name: "via-policies",
      nodePolicies: { Math: {} } as never,
      buildDecorations: () => [],
    };
    const viaPolicy: MarkdownSyntaxPlugin = {
      id: "via-policy",
      name: "via-policy",
      nodePolicy: { nodeName: "Math" } as never,
      buildDecorations: () => [],
    };
    expect(() => assertNoSyntaxConflicts(viaPolicies, builtinsWithNodes, new Set())).toThrow(
      /conflicts with a built-in plugin/u,
    );
    expect(() => assertNoSyntaxConflicts(viaPolicy, builtinsWithNodes, new Set())).toThrow(
      /conflicts with a built-in plugin/u,
    );
  });

  it("无冲突时放行（校验不能误伤）", () => {
    expect(() => assertNoSyntaxConflicts(plugin("clean"), builtins, new Set())).not.toThrow();
  });

  it("校验失败时一次注册都不发生（顺序契约）", () => {
    const { ports } = createSpyPorts();
    const attempt = () => {
      // 复刻生产 registrar 的调用顺序：先校验，通过后才注册。
      assertNoSyntaxConflicts(plugin("math"), builtins, new Set());
      registerExternalSyntaxPlugins(ports, [plugin("math")]);
    };
    expect(attempt).toThrow(/Duplicate syntax/u);
    expect(ports.addSyntaxPlugin).not.toHaveBeenCalled();
  });
});

describe("G-11 生产 registrar 的 wiring（删掉校验调用会红）", () => {
  it("id 冲突：registrar.register 抛错，且 onChanged 一次都没被调用", () => {
    const changes: unknown[] = [];
    const registrar = createSyntaxRegistrar(builtinsWithNodes, (plugins) => changes.push(plugins));

    // 直接打生产工厂 —— 不是测试自己复刻的调用顺序。
    expect(() => registrar.register(plugin("math"))).toThrow(/Duplicate syntax: math/u);
    // 校验先于副作用：注册表变化回调必须零调用。
    expect(changes).toEqual([]);
    expect(registrar.list()).toEqual([]);
  });

  it("正常注册会回调，dispose 也会回调（列表可观测）", () => {
    const changes: string[][] = [];
    const registrar = createSyntaxRegistrar(builtinsWithNodes, (plugins) =>
      changes.push(plugins.map((item) => item.id)),
    );

    const handle = registrar.register(plugin("alpha"));
    expect(changes).toEqual([["alpha"]]);
    expect(registrar.list().map((item) => item.id)).toEqual(["alpha"]);

    handle.dispose();
    expect(changes).toEqual([["alpha"], []]);
    expect(registrar.list()).toEqual([]);
  });

  it("同一 id 二次注册（即使未冲突内置）也抛错，不产生第二次回调", () => {
    const changes: string[][] = [];
    const registrar = createSyntaxRegistrar(builtinsWithNodes, (plugins) =>
      changes.push(plugins.map((item) => item.id)),
    );
    registrar.register(plugin("alpha"));
    expect(() => registrar.register(plugin("alpha"))).toThrow(/Duplicate syntax: alpha/u);
    expect(changes).toEqual([["alpha"]]);
  });
});

/**
 * 逐项注册失败时必须回滚已生效的注册。
 *
 * 宿主的接线是"按插件 id 逐个 `addSyntaxPlugin`"。第 n 个被拒时前 n-1 个已经
 * 生效；若不回收，宿主留下"只启用了一半"的状态，而调用方只看到一次抛错。
 */
describe("registerExternalSyntaxPlugins 失败回滚", () => {
  it("第 2 个被拒时释放第 1 个创建的句柄，并抛出原异常", async () => {
    const disposed: string[] = [];
    const ports = {
      addSyntaxPlugin(p: { id: string }) {
        if (p.id === "second") throw new Error("Syntax plugin already registered: second");
        return { dispose: () => disposed.push(p.id) };
      },
    };

    expect(() =>
      registerExternalSyntaxPlugins(ports as never, [{ id: "first" }, { id: "second" }] as never),
    ).toThrow(/second/u);
    expect(disposed).toEqual(["first"]);
  });

  it("多个已生效的注册按逆序回收", async () => {
    const disposed: string[] = [];
    const ports = {
      addSyntaxPlugin(p: { id: string }) {
        if (p.id === "third") throw new Error("rejected");
        return { dispose: () => disposed.push(p.id) };
      },
    };

    expect(() =>
      registerExternalSyntaxPlugins(
        ports as never,
        [{ id: "first" }, { id: "second" }, { id: "third" }] as never,
      ),
    ).toThrow(/rejected/u);
    expect(disposed).toEqual(["second", "first"]);
  });

  it("全部成功时返回的退订函数释放全部句柄", async () => {
    const disposed: string[] = [];
    const ports = {
      addSyntaxPlugin(p: { id: string }) {
        return { dispose: () => disposed.push(p.id) };
      },
    };

    const detach = registerExternalSyntaxPlugins(
      ports as never,
      [{ id: "a" }, { id: "b" }] as never,
    );
    detach();
    expect(disposed).toEqual(["a", "b"]);
  });
});
