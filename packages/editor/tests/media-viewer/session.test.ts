/**
 * AC5 / AC6 / AC16 / AC18 的会话层契约测试（**测试先行**）。
 *
 * 契约来源：`.omx/plans/prd-mermaid-diagram-viewer.md` §0.1/§4.4.4 与
 * `.omx/plans/test-spec-mermaid-diagram-viewer.md`：
 * - AC5 三通道关闭（ESC / 遮罩 / 关闭按钮）后焦点回编辑器；
 * - AC6 默认适应宽度、滚轮缩放（光标为中心）、拖拽平移、双击复位；
 * - AC16 监听注册/注销成对、重复 open 无幽灵浮层（由调用方在 open 前关闭旧句柄）；
 * - AC18 dialog 语义 + 焦点接管 + `Mod+K` 互斥 + Escape 只关浮层。
 */
import { describe, expect, it } from "vitest";
import {
  createMediaViewerSession,
  type MediaViewerSessionOptions,
} from "../../src/media-viewer/session.ts";
import {
  createRecordingKeyboard,
  createRecordingOverlay,
  keyEvent,
} from "./support/recording-overlay.ts";

function createHarness(overrides?: Partial<MediaViewerSessionOptions>): {
  readonly session: ReturnType<typeof createMediaViewerSession>;
  readonly overlay: ReturnType<typeof createRecordingOverlay>;
  readonly keyboard: ReturnType<typeof createRecordingKeyboard>;
  readonly events: { restoreFocus: number; closed: number; edit: number };
} {
  const overlay = createRecordingOverlay();
  const keyboard = createRecordingKeyboard();
  const events = { restoreFocus: 0, closed: 0, edit: 0 };
  const session = createMediaViewerSession(overlay, keyboard, {
    fit: "width",
    zoomPan: {},
    takeFocus: true,
    restoreFocus: () => {
      events.restoreFocus += 1;
    },
    onClose: () => {
      events.closed += 1;
    },
    onRequestEdit: () => {
      events.edit += 1;
    },
    ...overrides,
  });
  return { session, overlay, keyboard, events };
}

describe("会话建立", () => {
  it("注入内容、应用初始变换、按 takeFocus 接管焦点、注册键盘监听一次", () => {
    const { overlay, keyboard } = createHarness();
    expect(overlay.transforms).toHaveLength(1);
    // fit=width：内容宽 400、视口宽 1000 ⇒ scale 2.5，水平铺满、垂直居中
    expect(overlay.transforms[0]?.scale).toBe(2.5);
    expect(overlay.focusCalls).toBe(1);
    expect(keyboard.listeners).toHaveLength(1);
  });

  it("takeFocus=false 时不接管焦点", () => {
    const { overlay } = createHarness({ takeFocus: false });
    expect(overlay.focusCalls).toBe(0);
  });
});

describe("键盘归属（AC18）", () => {
  it("Escape：preventDefault + 关闭浮层 + 焦点归还，且被消费", () => {
    const { session, overlay, keyboard, events } = createHarness();
    const event = keyEvent("Escape");
    expect(session.handleKeyDown(event)).toBe(true);
    expect(event.prevented.value).toBe(true);
    expect(overlay.destroyed).toBe(1);
    expect(events.restoreFocus).toBe(1);
    expect(keyboard.listeners).toHaveLength(0);
  });

  it("Mod+K：互斥——关闭浮层但**不**消费事件、不 preventDefault（留给命令面板）", () => {
    const { session, overlay, events } = createHarness();
    const event = keyEvent("k", { metaKey: true });
    expect(session.handleKeyDown(event)).toBe(false);
    expect(event.prevented.value).toBe(false);
    expect(overlay.destroyed).toBe(1);
    expect(events.restoreFocus).toBe(1);
  });

  it("其他按键不被消费", () => {
    const { session, overlay } = createHarness();
    expect(session.handleKeyDown(keyEvent("ArrowDown"))).toBe(false);
    expect(overlay.destroyed).toBe(0);
  });
});

describe("关闭语义（AC5 / AC16）", () => {
  it("close 幂等：重复调用只销毁一次、只注销一次监听、只归还一次焦点", () => {
    const { session, overlay, keyboard, events } = createHarness();
    session.handle.close();
    session.handle.close();
    session.handle.close();
    expect(overlay.destroyed).toBe(1);
    expect(keyboard.listeners).toHaveLength(0);
    expect(events.restoreFocus).toBe(1);
    expect(events.closed).toBe(1);
    expect(session.closed).toBe(true);
  });

  it("restoreFocus=false 时关闭不归还焦点（宿主销毁路径）", () => {
    const { session, events } = createHarness();
    session.handle.close({ restoreFocus: false });
    expect(events.restoreFocus).toBe(0);
    expect(session.closed).toBe(true);
  });

  it("关闭后所有交互均为无操作（不产生二次副作用）", () => {
    const { session, overlay } = createHarness();
    session.handle.close();
    const transformCount = overlay.transforms.length;
    session.handleWheel({
      deltaY: -100,
      clientX: 10,
      clientY: 10,
      preventDefault: () => undefined,
    });
    session.handlePointerDown({ clientX: 0, clientY: 0 });
    session.handleDoubleClick();
    session.handleResize();
    session.requestEdit();
    expect(overlay.transforms).toHaveLength(transformCount);
    expect(overlay.destroyed).toBe(1);
  });
});

describe("编辑入口（AC4）", () => {
  it("requestEdit 先关闭浮层再请求编辑（保证光标落点）", () => {
    const { session, overlay, events } = createHarness();
    session.requestEdit();
    expect(overlay.destroyed).toBe(1);
    expect(events.edit).toBe(1);
    expect(events.closed).toBe(1);
    expect(events.restoreFocus).toBe(1);
  });
});

describe("缩放与平移（AC6 / AC7）", () => {
  it("滚轮向上缩放：scale 增大且 preventDefault（防页面级缩放）", () => {
    const { session, overlay } = createHarness();
    const prevented = { value: false };
    session.handleWheel({
      deltaY: -120,
      clientX: 500,
      clientY: 250,
      preventDefault: () => (prevented.value = true),
    });
    const last = overlay.transforms.at(-1);
    expect(prevented.value).toBe(true);
    expect(last && last.scale).toBeGreaterThan(2.5);
  });

  it("滚轮缩放受上限约束（800%）", () => {
    const { session, overlay } = createHarness();
    for (let index = 0; index < 40; index += 1) {
      session.handleWheel({
        deltaY: -200,
        clientX: 500,
        clientY: 250,
        preventDefault: () => undefined,
      });
    }
    expect(overlay.transforms.at(-1)?.scale).toBe(8);
  });

  it("zoomPan:false（图片路径）：忽略滚轮且不 preventDefault", () => {
    const { session, overlay } = createHarness({ zoomPan: false });
    const prevented = { value: false };
    const before = overlay.transforms.length;
    session.handleWheel({
      deltaY: -120,
      clientX: 5,
      clientY: 5,
      preventDefault: () => (prevented.value = true),
    });
    expect(prevented.value).toBe(false);
    expect(overlay.transforms).toHaveLength(before);
  });

  it("拖拽：pointerdown 设置 dragging、move 平移、up 清除", () => {
    const { session, overlay } = createHarness();
    session.handlePointerDown({ clientX: 100, clientY: 100 });
    session.handlePointerMove({ clientX: 130, clientY: 80 });
    session.handlePointerUp();
    expect(overlay.draggingFlags).toEqual([true, false]);
    const before = overlay.transforms.at(-2);
    const after = overlay.transforms.at(-1);
    expect(after && before && after.x - before.x).toBeCloseTo(30, 5);
    expect(after && before && after.y - before.y).toBeCloseTo(-20, 5);
  });

  it("zoomPan:false 时不进入拖拽", () => {
    const { session, overlay } = createHarness({ zoomPan: false });
    session.handlePointerDown({ clientX: 0, clientY: 0 });
    session.handlePointerMove({ clientX: 50, clientY: 50 });
    expect(overlay.draggingFlags).toEqual([]);
  });

  it("双击复位到初始视图（适应宽度）", () => {
    const { session, overlay } = createHarness();
    session.handleWheel({
      deltaY: -200,
      clientX: 100,
      clientY: 100,
      preventDefault: () => undefined,
    });
    session.handleDoubleClick();
    expect(overlay.transforms.at(-1)?.scale).toBe(2.5);
  });

  it("视口变化（resize）重新适应宽度", () => {
    const { session, overlay } = createHarness();
    overlay.viewport = { width: 500, height: 500 };
    session.handleResize();
    // 500 / 400 = 1.25，且不低于 contain（min(1.25, 1.25) = 1.25）
    expect(overlay.transforms.at(-1)?.scale).toBe(1.25);
  });
});
