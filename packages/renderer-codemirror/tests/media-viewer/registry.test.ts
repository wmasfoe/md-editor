/**
 * AC16 生命周期契约测试（**测试先行**）：宿主键控登记表。
 *
 * 契约来源：`.omx/plans/prd-mermaid-diagram-viewer.md` §0.1/§4.4.4 与
 * `.omx/plans/test-spec-mermaid-diagram-viewer.md` AC16：
 * - 同 host 重复 `open` ⇒ **先关旧句柄**（防幽灵浮层 + `document` 级监听泄漏）；
 * - `closeMediaViewerFor(hostA)` **不影响** hostB；
 * - 未登记的 host 调用为**幂等 no-op**；
 * - 句柄自身已关闭后再 `closeFor` 不得产生二次副作用。
 *
 * 为什么能脱离 DOM 测：登记表只依赖"可关闭的句柄"这一形状，浏览器侧只是把
 * `close()` 接到"移除 root + 注销 document 监听"上（由 e2e 断言）。
 */
import { describe, expect, it } from "vitest";
import {
  createMediaViewerRegistry,
  type ViewerHandleLike,
} from "../../src/media-viewer/registry.ts";

interface FakeHandle extends ViewerHandleLike {
  readonly id: string;
  readonly closeCalls: { count: number; restoreFocus: boolean | undefined };
}

function createFakeHandle(id: string): FakeHandle {
  const closeCalls = { count: 0, restoreFocus: undefined as boolean | undefined };
  return {
    id,
    closeCalls,
    close: (options) => {
      closeCalls.count += 1;
      closeCalls.restoreFocus = options?.restoreFocus;
    },
  };
}

describe("宿主键控登记表", () => {
  it("生产开启序列（先 closeFor 旧句柄、再 set 新句柄）：旧句柄被关且只保留最新", () => {
    const registry = createMediaViewerRegistry<FakeHandle>();
    const host = { name: "host" };
    const first = createFakeHandle("first");
    registry.set(host, first);
    // openMediaViewer 的实际顺序：先关旧（避免两个浮层并存）
    registry.closeFor(host, { restoreFocus: false });
    const second = createFakeHandle("second");
    registry.set(host, second);

    expect(first.closeCalls.count).toBe(1);
    expect(second.closeCalls.count).toBe(0);
    expect(registry.has(host)).toBe(true);
    // 关掉 host 时应命中**最新**句柄
    registry.closeFor(host);
    expect(second.closeCalls.count).toBe(1);
    expect(first.closeCalls.count).toBe(1);
  });

  it("closeFor(hostA) 不影响 hostB", () => {
    const registry = createMediaViewerRegistry<FakeHandle>();
    const hostA = { name: "A" };
    const hostB = { name: "B" };
    registry.set(hostA, createFakeHandle("a"));
    const handleB = createFakeHandle("b");
    registry.set(hostB, handleB);

    expect(registry.closeFor(hostA)).toBe(true);
    expect(registry.has(hostA)).toBe(false);
    expect(registry.has(hostB)).toBe(true);
    expect(handleB.closeCalls.count).toBe(0);
    expect(handleB.closeCalls.restoreFocus).toBeUndefined();
  });

  it("未登记的 host：closeFor 为幂等 no-op（返回 false 且不抛）", () => {
    const registry = createMediaViewerRegistry<FakeHandle>();
    const host = { name: "unknown" };
    expect(registry.closeFor(host)).toBe(false);
    expect(registry.closeFor(host)).toBe(false);
    expect(registry.has(host)).toBe(false);
  });

  it("restoreFocus 选项透传到句柄", () => {
    const registry = createMediaViewerRegistry<FakeHandle>();
    const host = { name: "host" };
    const handle = createFakeHandle("h");
    registry.set(host, handle);
    registry.closeFor(host, { restoreFocus: true });
    expect(handle.closeCalls.restoreFocus).toBe(true);
  });

  it("先 forget 再 closeFor：不会二次关闭（宿主销毁路径）", () => {
    const registry = createMediaViewerRegistry<FakeHandle>();
    const host = { name: "host" };
    const handle = createFakeHandle("h");
    registry.set(host, handle);
    registry.forget(host);
    expect(registry.closeFor(host)).toBe(false);
    expect(handle.closeCalls.count).toBe(0);
  });
});
