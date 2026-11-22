/**
 * 注册句柄必须只释放**当次**注册。
 *
 * 历史缺陷：`dispose(id, expected)` 只比对插件对象身份。同一个对象 p 注册 →
 * 释放 → 再注册后，**旧句柄**再释放一次，`#plugins.get(id) === p` 依然成立，
 * 于是把新注册摘掉了。用户侧表现为"插件莫名消失"，且完全无法从 API 上察觉。
 *
 * 修法：每次注册分配一个单调递增的代号（token），句柄持有自己那次的代号；
 * 释放时同时比对代号，旧句柄自然失效。句柄本身可重复释放（幂等）。
 */
import { describe, expect, it } from "vitest";

import { SyntaxPluginRegistry } from "../src/syntax-registry.ts";
import type { MarkdownSyntaxPlugin } from "../src/syntax.ts";

const plugin = (id: string): MarkdownSyntaxPlugin =>
  ({
    id,
    name: id,
    nodePolicy: { nodeName: `${id}Node`, kind: "inline", isBlock: false },
  }) as MarkdownSyntaxPlugin;

describe("同一插件对象的两次注册必须可区分", () => {
  it("旧句柄二次释放不得摘掉新注册", () => {
    const registry = new SyntaxPluginRegistry();
    const p = plugin("p");

    const first = registry.registerImperative(p);
    expect(registry.plugins.map((x) => x.id)).toEqual(["p"]);

    first.dispose();
    expect(registry.plugins).toEqual([]);

    const second = registry.registerImperative(p);
    expect(registry.plugins.map((x) => x.id)).toEqual(["p"]);

    // 关键：旧句柄已经用过了，再释放一次不能影响第二次注册。
    expect(first.dispose()).toBe(false);
    expect(registry.plugins.map((x) => x.id)).toEqual(["p"]);

    second.dispose();
    expect(registry.plugins).toEqual([]);
  });

  it("句柄可重复释放（幂等，不抛错）", () => {
    const registry = new SyntaxPluginRegistry();
    const handle = registry.registerImperative(plugin("q"));
    expect(handle.dispose()).toBe(true);
    expect(handle.dispose()).toBe(false);
    expect(handle.dispose()).toBe(false);
    expect(registry.plugins).toEqual([]);
  });

  it("同 ID 换实例：旧句柄不得摘掉新实例", () => {
    const registry = new SyntaxPluginRegistry();
    const first = registry.registerImperative(plugin("same"));
    first.dispose();
    registry.registerImperative(plugin("same"));
    // 旧句柄已释放过，再调不应影响新实例。
    expect(first.dispose()).toBe(false);
    expect(registry.plugins.map((x) => x.id)).toEqual(["same"]);
  });

  it("节点策略随注册代号一起失效（旧句柄不清新注册的节点）", () => {
    const registry = new SyntaxPluginRegistry();
    const p = plugin("n");
    const first = registry.registerImperative(p);
    first.dispose();
    registry.registerImperative(p);
    first.dispose();
    expect(registry.getNodePolicy("nNode")).not.toBeNull();
  });
});

/**
 * 代号真正的判别力场景：句柄**尚未释放**时，它注册的条目已经被别的路径
 * 摘掉并重新注册（新代号）。此时旧句柄释放必须失效 —— 只比对对象身份会
 * 把**新注册**当成自己的摘掉。
 *
 * 注意：`registerImperative` 自带 `released` 幂等标志，会挡住"同一个句柄
 * 释放两次"这条路径，所以那类用例其实测不到代号。必须让旧句柄**首次**释放
 * 撞上新代号，才真正依赖代号守卫。
 */
describe("代号守卫：未释放的旧句柄撞上新注册", () => {
  it("条目被换掉再注册后，旧句柄首次释放不得摘掉新注册", () => {
    const registry = new SyntaxPluginRegistry();
    const p = plugin("swap");

    // 旧句柄持有 token=1，但先不释放。
    const stale = registry.registerImperative(p);
    const staleToken = registry.tokenOf("swap");

    // 模拟另一条路径把条目摘掉再注册（新 token）。
    registry.clear();
    registry.registerImperative(p);
    expect(registry.tokenOf("swap")).not.toBe(staleToken);

    // 旧句柄**首次**释放：token 不匹配 → 必须失效。
    expect(stale.dispose()).toBe(false);
    expect(registry.plugins.map((x) => x.id)).toEqual(["swap"]);
  });

  it("registry.dispose 的 token 参数是唯一的判别依据", () => {
    const registry = new SyntaxPluginRegistry();
    const p = plugin("direct");
    const firstToken = (registry.register(p, "imperative"), registry.tokenOf("direct"));
    registry.clear();
    registry.register(p, "imperative");

    // 对象身份相同、id 相同 —— 只有 token 能区分。
    expect(registry.dispose("direct", p, firstToken)).toBe(false);
    expect(registry.plugins.map((x) => x.id)).toEqual(["direct"]);
    // 用当前 token 才能真的删掉。
    expect(registry.dispose("direct", p, registry.tokenOf("direct"))).toBe(true);
    expect(registry.plugins).toEqual([]);
  });
});

/**
 * 代号必须**全局单调**，不能因为 `replaceDeclarative` 的临时实例而从 1 重新开始。
 *
 * 若临时实例从 1 开始分配，声明式条目拿到的代号可能等于历史上已发出的代号。
 * 一旦某个 id 先被不带 token 的 `dispose(id)` 摘掉、再经 `replaceDeclarative`
 * 以同一对象重新注册，旧句柄的代号就可能"碰巧对上"，从而误删新注册。
 */
describe("replaceDeclarative 之后代号仍全局单调", () => {
  it("临时实例不得复用历史代号", () => {
    const registry = new SyntaxPluginRegistry();
    const p = plugin("p");
    const stale = registry.registerImperative(p);
    const staleToken = registry.tokenOf("p");
    expect(staleToken).toBeDefined();

    // 不经 token 摘掉（模拟外部/旧路径），再用同对象走全量替换注册。
    registry.dispose("p", p);
    registry.replaceDeclarative([p]);

    // 新代号必须严格大于历史值，旧句柄的 token 不该对上。
    expect(registry.tokenOf("p")).toBeGreaterThan(staleToken as number);
    expect(stale.dispose()).toBe(false);
    expect(registry.plugins.map((x) => x.id)).toEqual(["p"]);
  });

  it("连续多次全量替换后代号持续递增", () => {
    const registry = new SyntaxPluginRegistry();
    const tokens: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      registry.replaceDeclarative([plugin(`p${i}`)]);
      tokens.push(registry.tokenOf(`p${i}`) as number);
    }
    expect(tokens[0]).toBeLessThan(tokens[1] as number);
    expect(tokens[1]).toBeLessThan(tokens[2] as number);
  });
});
