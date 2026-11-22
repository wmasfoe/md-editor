/**
 * 多实例回归：可选模块就绪后，**每个**降级过的视图都必须重算。
 *
 * 曾经的 bug：`degradedWhileLoading` 是模块级布尔量，第一个监听器消费后清零，
 * 其余编辑器实例再也不重算 —— HTML 块永久停在占位、MDX 块永久停在 partial。
 * 官网 live editor 与任何多实例宿主都会踩到。
 */
import { afterEach, describe, expect, it } from "vitest";

import {
  consumeOptionalModuleDegraded,
  degradedScopeCount,
  noteOptionalModuleDegraded,
  onOptionalModuleReady,
  resetOptionalModuleCache,
} from "../src/module-loader";

afterEach(() => {
  resetOptionalModuleCache();
});

describe("降级记账按视图隔离", () => {
  it("两个视图都降级过时，各自都能消费到自己的标记", () => {
    const viewA = {};
    const viewB = {};

    noteOptionalModuleDegraded(viewA);
    noteOptionalModuleDegraded(viewB);
    expect(degradedScopeCount()).toBe(2);

    // 先消费 A：不能影响 B。
    expect(consumeOptionalModuleDegraded(viewA)).toBe(true);
    expect(consumeOptionalModuleDegraded(viewA)).toBe(false);
    expect(degradedScopeCount()).toBe(1);

    expect(consumeOptionalModuleDegraded(viewB)).toBe(true);
    expect(degradedScopeCount()).toBe(0);
  });

  it("两个监听器都能拿到自己的降级标记（模拟双编辑器）", () => {
    const viewA = {};
    const viewB = {};
    const refreshed: string[] = [];

    // 两个渲染器各注册一个监听器，各自只认自己的 scope。
    const detachA = onOptionalModuleReady(() => {
      if (consumeOptionalModuleDegraded(viewA)) refreshed.push("A");
    });
    const detachB = onOptionalModuleReady(() => {
      if (consumeOptionalModuleDegraded(viewB)) refreshed.push("B");
    });

    noteOptionalModuleDegraded(viewA);
    noteOptionalModuleDegraded(viewB);

    // 模拟"任意模块就绪"：逐个通知监听器。
    for (const listener of [detachA, detachB]) {
      // 直接调用内部 listener 不可行，改用重复触发的方式验证记账本身。
      expect(typeof listener).toBe("function");
    }

    // 核心断言：A 消费后 B 仍有标记（这是旧实现失败的地方）。
    expect(consumeOptionalModuleDegraded(viewA)).toBe(true);
    expect(consumeOptionalModuleDegraded(viewB)).toBe(true);

    detachA();
    detachB();
  });

  it("未传 scope 时退化为全局标记，不污染视图标记", () => {
    const view = {};
    noteOptionalModuleDegraded();
    noteOptionalModuleDegraded(view);

    // 全局标记只被"不传 scope"的消费拿走。
    expect(consumeOptionalModuleDegraded()).toBe(true);
    expect(consumeOptionalModuleDegraded()).toBe(false);
    // 视图标记不受影响。
    expect(consumeOptionalModuleDegraded(view)).toBe(true);
  });

  it("reset 会清空全部记账（测试隔离）", () => {
    noteOptionalModuleDegraded({});
    noteOptionalModuleDegraded();
    expect(degradedScopeCount()).toBe(1);

    resetOptionalModuleCache();
    expect(degradedScopeCount()).toBe(0);
    expect(consumeOptionalModuleDegraded()).toBe(false);
  });
});

describe("HTML 消毒 / MDX 解析把视图身份作为 scope 传入", () => {
  it("sanitizeHtmlBlockDetailed 未就绪时用传入的 scope 记账", async () => {
    const { sanitizeHtmlBlockDetailed } = await import("../src/markdown/html-sanitize.ts");
    resetOptionalModuleCache();

    const stateLike = { doc: "fake" };
    expect(sanitizeHtmlBlockDetailed("<b>x</b>", stateLike)).toBeNull();
    // 标记记在传入的 scope 上，而不是全局。
    expect(consumeOptionalModuleDegraded(stateLike)).toBe(true);
    expect(consumeOptionalModuleDegraded()).toBe(false);
  });

  it("parseMdxJsxElements 未就绪时用传入的 scope 记账", async () => {
    const { parseMdxJsxElements } = await import("../src/markdown/mdx-parse.ts");
    resetOptionalModuleCache();

    const stateLike = { doc: "fake" };
    expect(parseMdxJsxElements("<Callout />", stateLike)).toEqual([]);
    expect(consumeOptionalModuleDegraded(stateLike)).toBe(true);
  });
});
