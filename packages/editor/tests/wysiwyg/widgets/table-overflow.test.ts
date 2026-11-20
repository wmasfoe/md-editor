/**
 * @file table-overflow.test.ts
 * @description 表格横向溢出状态判定的单元测试（驱动 `data-table-overflow`）。
 *
 * 为什么这个判定值得单测：
 * 1. 判据必须用 **表格自身布局宽度 vs 视口内容宽度**，不能用 `viewport.scrollWidth` ——
 *    列宽拖动手柄（`right: -3px`）永远溢出表格 2px，会让每一张表（含 2 列小表）
 *    都被误判为溢出，进而错误地建立滚动盒、裁掉表格外侧的行/列手柄。
 * 2. 判定必须在容器宽度、内容、字体三类变化后重算，否则状态会陈旧。
 *
 * 样式契约见 `src/styles/table-css.ts`，行为回归见
 * `apps/desktop/e2e/codemirror-m3-table-overflow.spec.ts`。
 */
import { describe, expect, it, vi } from "vitest";
import {
  observeTableOverflow,
  refreshTableOverflow,
  TABLE_OVERFLOW_ATTRIBUTE,
} from "../../../src/wysiwyg/widgets/table/overflow.ts";

interface Metrics {
  /** 表格布局宽度（`offsetWidth`）。 */
  grid: number;
  /** 视口内容宽度（`clientWidth`）。 */
  viewport: number;
  /** 视口 scrollWidth，包含溢出到表格外的列宽拖动手柄。 */
  scroll: number;
}

/** 最小 DOM 桩：只实现 overflow.ts 用到的 querySelector / setAttribute / isConnected。 */
function createWrapper(metrics: Metrics, options: { withObserver?: boolean } = {}) {
  const attributes = new Map<string, string>();
  // 用 getter 读实时 metrics：测试需要模拟“容器变窄”后同一批节点上数值变化。
  const viewport = {
    get clientWidth() {
      return metrics.viewport;
    },
    get scrollWidth() {
      return metrics.scroll;
    },
  };
  const grid = {
    get offsetWidth() {
      return metrics.grid;
    },
  };
  let observerCallback: (() => void) | null = null;
  const disconnect = vi.fn();

  class FakeResizeObserver {
    constructor(callback: () => void) {
      observerCallback = callback;
    }
    observe = vi.fn();
    disconnect = disconnect;
  }

  const wrapper = {
    isConnected: true,
    ownerDocument: {
      defaultView: options.withObserver === false ? {} : { ResizeObserver: FakeResizeObserver },
    },
    querySelector(selector: string) {
      if (selector === ".cm-md-table-widget__viewport") return viewport;
      if (selector === ".cm-md-table-widget__grid") return grid;
      return null;
    },
    setAttribute(name: string, value: string) {
      attributes.set(name, value);
    },
    getAttribute(name: string) {
      return attributes.get(name) ?? null;
    },
  };

  return {
    wrapper: wrapper as unknown as HTMLElement,
    attributes,
    disconnect,
    triggerResize: () => observerCallback?.(),
  };
}

describe("表格横向溢出判定", () => {
  it("表格宽度不超过视口内容宽度时不判溢出", () => {
    const { wrapper, attributes } = createWrapper({ grid: 844, viewport: 844, scroll: 853 });
    refreshTableOverflow(wrapper);
    expect(attributes.get(TABLE_OVERFLOW_ATTRIBUTE)).toBe("false");
  });

  it("列宽拖动手柄造成的 scrollWidth 溢出不得触发溢出态", () => {
    // 真实场景：2 列小表 grid/offset 与视口等宽，但 scrollWidth 因 right:-3px 的手柄多出 9px。
    // 若用 scrollWidth 判定，会误判为溢出 ⇒ 建立滚动盒 ⇒ 裁掉表格外侧的行/列手柄。
    const { wrapper, attributes } = createWrapper({ grid: 844, viewport: 844, scroll: 853 });
    refreshTableOverflow(wrapper);
    expect(attributes.get(TABLE_OVERFLOW_ATTRIBUTE)).toBe("false");
  });

  it("表格宽度超出视口内容宽度时判为溢出（转为块内横向滚动）", () => {
    const { wrapper, attributes } = createWrapper({ grid: 1557, viewport: 844, scroll: 1559 });
    refreshTableOverflow(wrapper);
    expect(attributes.get(TABLE_OVERFLOW_ATTRIBUTE)).toBe("true");
  });

  it("亚像素舍入不触发状态抖动", () => {
    // 1px 以内的差异来自亚像素布局舍入，不应在临界宽度反复切换。
    const { wrapper, attributes } = createWrapper({ grid: 845, viewport: 844, scroll: 853 });
    refreshTableOverflow(wrapper);
    expect(attributes.get(TABLE_OVERFLOW_ATTRIBUTE)).toBe("false");
  });

  it("ResizeObserver 回调会重算状态（容器宽度变化后同步）", () => {
    const metrics: Metrics = { grid: 844, viewport: 844, scroll: 853 };
    const { wrapper, attributes, triggerResize } = createWrapper(metrics);
    observeTableOverflow(wrapper);
    expect(attributes.get(TABLE_OVERFLOW_ATTRIBUTE)).toBe("false");

    // 模拟窗口变窄：视口内容宽度缩小，表格因列宽下限撑破容器。
    metrics.viewport = 590;
    metrics.grid = 934;
    triggerResize();
    expect(attributes.get(TABLE_OVERFLOW_ATTRIBUTE)).toBe("true");
  });

  it("返回的停止函数会断开 ResizeObserver（destroy 必须解绑，避免随 widget 复用累积）", () => {
    const { wrapper, disconnect } = createWrapper({ grid: 844, viewport: 844, scroll: 853 });
    const stop = observeTableOverflow(wrapper);
    stop();
    expect(disconnect).toHaveBeenCalledTimes(1);
  });

  it("无 ResizeObserver 的环境只做静态测量，且返回可安全调用的停止函数", () => {
    const { wrapper, attributes } = createWrapper(
      { grid: 1557, viewport: 844, scroll: 1559 },
      { withObserver: false },
    );
    const stop = observeTableOverflow(wrapper);
    expect(attributes.get(TABLE_OVERFLOW_ATTRIBUTE)).toBe("true");
    expect(() => stop()).not.toThrow();
  });

  it("缺少表格或视口节点时不写属性（widget DOM 未就绪）", () => {
    const attributes = new Map<string, string>();
    const wrapper = {
      isConnected: true,
      ownerDocument: { defaultView: {} },
      querySelector: () => null,
      setAttribute: (name: string, value: string) => attributes.set(name, value),
    } as unknown as HTMLElement;
    refreshTableOverflow(wrapper);
    expect(attributes.has(TABLE_OVERFLOW_ATTRIBUTE)).toBe(false);
  });
});
