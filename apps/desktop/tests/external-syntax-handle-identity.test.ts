/**
 * 桌面 registrar 的句柄必须只释放**自己注册的那个实例**。
 *
 * 历史缺陷：`registered.delete(plugin.id)` 只按 id 删。同一个 id 换成新实例后，
 * 旧句柄一释放就把新实例摘掉了（用户侧表现为"插件莫名消失"）。
 */
import { describe, expect, it } from "vitest";

import { createSyntaxRegistrar } from "../src/app/plugins/syntax-conflict-validation.ts";
import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";

const plugin = (id: string, nodeName = `${id}Node`): MarkdownSyntaxPlugin =>
  ({
    id,
    name: id,
    nodePolicy: { nodeName, kind: "inline", isBlock: false },
  }) as MarkdownSyntaxPlugin;

describe("createSyntaxRegistrar 句柄身份", () => {
  it("同 ID 换实例后，旧句柄不得误删新实例", () => {
    const changes: string[][] = [];
    const registrar = createSyntaxRegistrar([], (plugins) => {
      changes.push(plugins.map((p) => p.id));
    });

    const first = registrar.register(plugin("same"));
    first.dispose();
    expect(registrar.list().map((p) => p.id)).toEqual([]);

    registrar.register(plugin("same"));
    expect(registrar.list().map((p) => p.id)).toEqual(["same"]);

    // 关键：旧句柄已经释放过，再调不能摘掉新实例。
    first.dispose();
    expect(registrar.list().map((p) => p.id)).toEqual(["same"]);
  });

  it("句柄可重复释放（幂等）", () => {
    const registrar = createSyntaxRegistrar([], () => undefined);
    const handle = registrar.register(plugin("x"));
    handle.dispose();
    handle.dispose();
    handle.dispose();
    expect(registrar.list()).toEqual([]);
  });

  it("释放后再注册同一实例，新句柄正常工作", () => {
    const registrar = createSyntaxRegistrar([], () => undefined);
    const p = plugin("again");
    registrar.register(p).dispose();
    const second = registrar.register(p);
    expect(registrar.list().map((x) => x.id)).toEqual(["again"]);
    second.dispose();
    expect(registrar.list()).toEqual([]);
  });
});

/**
 * 批量注册必须"要么全成、要么全不成"。
 *
 * 历史缺陷：`registerAll` 逐项调用 `register`，第 2 个被拒时第 1 个已经落表，
 * 宿主留下半批状态（外部插件"只启用了一半"）。另外冲突校验此前只比对
 * **已注册外部插件的 id**，两个不同 id 声明同一节点策略时宿主会接受两者。
 */
describe("createSyntaxRegistrar 批量注册的原子性", () => {
  it("批内两个插件撞节点策略 → 整批拒绝，注册表不变", () => {
    const changes: string[][] = [];
    const registrar = createSyntaxRegistrar([], (plugins) => {
      changes.push(plugins.map((p) => p.id));
    });

    expect(() =>
      registrar.registerAll([plugin("first", "SharedNode"), plugin("second", "SharedNode")]),
    ).toThrow(/SharedNode/u);

    // 关键：第一个也不能留下。
    expect(registrar.list()).toEqual([]);
    expect(changes).toEqual([]);
  });

  it("批量注册成功时逐个回调，顺序与传入一致", () => {
    const registrar = createSyntaxRegistrar([], () => undefined);
    const handles = registrar.registerAll([plugin("a", "NodeA"), plugin("b", "NodeB")]);
    expect(registrar.list().map((p) => p.id)).toEqual(["a", "b"]);
    expect(handles).toHaveLength(2);
  });

  it("批量注册与内置插件撞节点 → 整批拒绝", () => {
    const registrar = createSyntaxRegistrar([plugin("builtin", "BuiltinNode")], () => undefined);
    expect(() =>
      registrar.registerAll([plugin("ok", "OtherNode"), plugin("bad", "BuiltinNode")]),
    ).toThrow(/BuiltinNode/u);
    expect(registrar.list()).toEqual([]);
  });

  it("批内重复 id → 整批拒绝", () => {
    const registrar = createSyntaxRegistrar([], () => undefined);
    expect(() =>
      registrar.registerAll([plugin("same", "NodeOne"), plugin("same", "NodeTwo")]),
    ).toThrow(/Duplicate syntax/u);
    expect(registrar.list()).toEqual([]);
  });

  it("批量注册的句柄可独立释放，且不影响其它条目", () => {
    const registrar = createSyntaxRegistrar([], () => undefined);
    const [a, b] = registrar.registerAll([plugin("a", "NodeA"), plugin("b", "NodeB")]);
    a?.dispose();
    expect(registrar.list().map((p) => p.id)).toEqual(["b"]);
    b?.dispose();
    expect(registrar.list()).toEqual([]);
  });
});
