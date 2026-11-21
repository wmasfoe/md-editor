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
function createWrapper(
  metrics: Metrics,
  options: { withObserver?: boolean; withFonts?: boolean } = {},
) {
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

  // document.fonts 桩：ready 是一次性 Promise，loadingdone 是可持续触发的事件。
  const fontListeners = new Set<EventListener>();
  let resolveReady: (() => void) | null = null;
  const fontSet = {
    ready: new Promise<void>((resolve) => {
      resolveReady = resolve;
    }),
    addEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === "loadingdone") fontListeners.add(listener);
    }),
    removeEventListener: vi.fn((type: string, listener: EventListener) => {
      if (type === "loadingdone") fontListeners.delete(listener);
    }),
  };

  const wrapper = {
    isConnected: true,
    ownerDocument: {
      fonts: options.withFonts === false ? undefined : fontSet,
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
    fontSet,
    triggerResize: () => observerCallback?.(),
    /** 模拟字体就绪（首次加载完成）。 */
    resolveFontsReady: () => resolveReady?.(),
    /** 模拟后续动态字体加载完成（主题切换 / @font-face 懒加载）。 */
    dispatchFontsLoadingDone: () => {
      for (const listener of fontListeners) listener(new Event("loadingdone"));
    },
    fontListenerCount: () => fontListeners.size,
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

  it("字体首次就绪后重测（ready 解析完成时字宽已变）", async () => {
    const metrics: Metrics = { grid: 844, viewport: 844, scroll: 853 };
    const { wrapper, attributes, resolveFontsReady } = createWrapper(metrics);
    const stop = observeTableOverflow(wrapper);
    expect(attributes.get(TABLE_OVERFLOW_ATTRIBUTE)).toBe("false");

    // 字体就绪后字宽变大，表格撑破容器。
    metrics.grid = 934;
    resolveFontsReady();
    await Promise.resolve();
    await Promise.resolve();
    expect(attributes.get(TABLE_OVERFLOW_ATTRIBUTE)).toBe("true");
    stop();
  });

  it("后续动态字体加载（loadingdone）也会重测，不只依赖一次性的 ready", () => {
    // 回归锁：历史实现只挂 `document.fonts.ready`，而它只解析**一次**。
    // 用户切换主题字体 / 懒加载 @font-face 后溢出状态会永久陈旧，
    // 手柄停在外侧却被滚动框裁掉（点不到）。
    const metrics: Metrics = { grid: 844, viewport: 844, scroll: 853 };
    const { wrapper, attributes, dispatchFontsLoadingDone } = createWrapper(metrics);
    const stop = observeTableOverflow(wrapper);
    expect(attributes.get(TABLE_OVERFLOW_ATTRIBUTE)).toBe("false");

    metrics.grid = 1200;
    dispatchFontsLoadingDone();
    expect(attributes.get(TABLE_OVERFLOW_ATTRIBUTE)).toBe("true");

    // 反向：字体变化让表格重新装得下。
    metrics.grid = 800;
    dispatchFontsLoadingDone();
    expect(attributes.get(TABLE_OVERFLOW_ATTRIBUTE)).toBe("false");
    stop();
  });

  it("停止函数同时断开 ResizeObserver 与字体监听（不得泄漏）", () => {
    const { wrapper, disconnect, fontListenerCount } = createWrapper({
      grid: 844,
      viewport: 844,
      scroll: 853,
    });
    const stop = observeTableOverflow(wrapper);
    expect(fontListenerCount()).toBe(1);
    stop();
    expect(disconnect).toHaveBeenCalledTimes(1);
    expect(fontListenerCount()).toBe(0);
  });

  it("无 document.fonts 的环境不报错（旧 WebView / Node 桩）", () => {
    const { wrapper, attributes } = createWrapper(
      { grid: 1557, viewport: 844, scroll: 1559 },
      { withFonts: false },
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
