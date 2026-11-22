/**
 * 多实例 + 按用途刷新：可选模块就绪后的重算范围。
 *
 * 两条历史 bug 都在这里锁住：
 * 1. 曾用模块级布尔量记账"降级过"，第一个监听器消费后清零 → 多实例宿主里
 *    其余编辑器的 HTML 块永久停在占位、MDX 块永久停在 partial。
 * 2. 就绪通知不带模块名 → Turndown 就绪（只服务下一次粘贴）也会触发整份
 *    range index 重建，纯烧 CPU。
 *
 * 现在的实现不做跨层记账，而是就绪时读**本视图**的索引判断要不要刷新，
 * 并按模块名决定刷新范围。因此测试直接断言"刷新范围"与"多实例互不影响"。
 */
import { afterEach, describe, expect, it } from "vitest";
import { refreshOptionalModuleProjection } from "../src/renderer/controller/optional-modules.ts";
import {
  onOptionalModuleReady,
  preloadOptionalModule,
  resetOptionalModuleCache,
} from "../src/module-loader";

afterEach(() => {
  resetOptionalModuleCache();
});

describe("就绪通知按模块名派发", () => {
  it("监听器能收到是哪个模块就绪", async () => {
    const received: string[] = [];
    const detach = onOptionalModuleReady((key) => {
      received.push(key);
    });

    await preloadOptionalModule("turndown", async () => ({ ok: true }));

    expect(received).toEqual(["turndown"]);
    detach();
  });

  it("同一模块重复预加载只通知一次", async () => {
    const received: string[] = [];
    const detach = onOptionalModuleReady((key) => {
      received.push(key);
    });

    await preloadOptionalModule("turndown", async () => ({ ok: true }));
    await preloadOptionalModule("turndown", async () => ({ ok: true }));

    expect(received).toEqual(["turndown"]);
    detach();
  });

  it("一个监听器抛错不影响其余订阅者（多实例宿主不能因一视图失败全体失联）", async () => {
    const received: string[] = [];
    const detachBad = onOptionalModuleReady(() => {
      throw new Error("view A refresh failed");
    });
    const detachGood = onOptionalModuleReady((key) => {
      received.push(key);
    });

    await preloadOptionalModule("turndown", async () => ({ ok: true }));

    // 关键：坏监听器排在前面，好监听器仍必须收到通知。
    expect(received).toEqual(["turndown"]);
    detachBad();
    detachGood();
  });

  it("监听器抛错不会被当成导入失败（pending 不应被清掉导致重复导入）", async () => {
    let imports = 0;
    const detach = onOptionalModuleReady(() => {
      throw new Error("boom");
    });

    await preloadOptionalModule("turndown", async () => {
      imports += 1;
      return { ok: true };
    });
    // 再调一次：已就绪，不应重新导入。
    await preloadOptionalModule("turndown", async () => {
      imports += 1;
      return { ok: true };
    });

    expect(imports).toBe(1);
    detach();
  });
});

/**
 * 用一个只记录 `dispatch` 的桩视图，直接验证"哪个模块就绪 → 派发几次事务"。
 *
 * 不用真实 harness 是因为真实视图里还有别的守卫（MDX 的 coverage 检查）会把
 * 多余事务挡掉，导致"Turndown 也派发"这个缺陷测不出来 —— 断言就失去判别力。
 */
function createStubView(records: readonly { kind: string; parserCoverage: string }[]) {
  const dispatched: number[] = [];
  const view = {
    state: {
      field: () => ({ records }),
    },
    dispatch: (spec: { effects: unknown }) => {
      dispatched.push(Array.isArray(spec.effects) ? spec.effects.length : 1);
    },
  };
  return { view, dispatched };
}

describe("按用途刷新：不同模块只刷新各自影响的投影", () => {
  it("Turndown 就绪不派发任何事务（它只服务下一次粘贴）", () => {
    const { view, dispatched } = createStubView([{ kind: "html", parserCoverage: "complete" }]);
    refreshOptionalModuleProjection(view as never, "turndown");
    expect(dispatched).toEqual([]);
  });

  it("消毒器就绪只刷新投影（1 个 effect），不重建解析索引", () => {
    const { view, dispatched } = createStubView([{ kind: "html", parserCoverage: "complete" }]);
    refreshOptionalModuleProjection(view as never, "sanitize-html");
    // 关键：1 个 effect（仅投影），不是 2 个（投影 + 解析索引）。
    expect(dispatched).toEqual([1]);
  });

  it("MDX 解析器就绪重建解析索引（2 个 effect）", () => {
    const { view, dispatched } = createStubView([{ kind: "mdx", parserCoverage: "partial" }]);
    refreshOptionalModuleProjection(view as never, "mdx-parser");
    expect(dispatched).toEqual([2]);
  });

  it("没有待刷新的记录时不派发（避免凭空打断编辑）", () => {
    const { view, dispatched } = createStubView([
      { kind: "paragraph", parserCoverage: "complete" },
    ]);
    refreshOptionalModuleProjection(view as never, "sanitize-html");
    expect(dispatched).toEqual([]);
  });
});
