/**
 * @file typewriter-mode.ts
 * @description 打字机模式（Typewriter Mode）—— D-2，纯视图状态，**零文档变更**。
 *
 * ## 行为
 * 当前行始终垂直居中于视口，视线固定不动，文档在眼前流过。
 *
 * ## 关键取舍
 * - **防抖阈值**（`DEVIATION_THRESHOLD_RATIO = 0.35`）：光标行偏离视口中心不超过
 *   `0.35 × 视口高度`时**不校正**。竞品 VMark 明确踩过「轻微光标移动引起抖动」的坑，
 *   此阈值就是那次教训的落地。
 * - **输入过程中禁用 smooth 滚动**：smooth 会造成跟随延迟、打字发飘；改为即时滚动
 *   并用 `requestAnimationFrame` 节流。
 * - **异步渲染后重校正**：图表/公式渲染会改变块高度，故 `geometryChanged` 也触发重算。
 * - **不得与大纲滚动同步形成死循环**：本模块只在「偏离超阈值」时滚动，且滚动本身不改
 *   selection，故不会自触发。
 */

import { StateEffect, StateField, type Extension } from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";

/** 开关打字机模式 */
export const setTypewriterModeEffect = StateEffect.define<boolean>();

/** 防抖阈值：光标行偏离视口中心的比例超过此值才校正 */
export const DEVIATION_THRESHOLD_RATIO = 0.35;

/** 打字机模式状态（纯视图状态） */
export const typewriterModeField = StateField.define<boolean>({
  create: () => false,
  update(previous, transaction) {
    let next = previous;
    for (const effect of transaction.effects) {
      if (effect.is(setTypewriterModeEffect)) {
        next = effect.value;
      }
    }
    return next;
  },
});

/**
 * 计算光标行中心与视口中心的偏离（单位 px）。
 * 无法测量时返回 null（fail closed：不滚动）。
 */
export function measureCenterDeviation(view: EditorView): number | null {
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head);
  const rect = view.dom.getBoundingClientRect();
  if (coords === null || rect.height === 0) {
    return null;
  }
  const lineCenter = (coords.top + coords.bottom) / 2;
  const viewCenter = rect.top + rect.height / 2;
  return Math.abs(lineCenter - viewCenter);
}

/** 打字机滚动器：仅在偏离超阈值时把光标行校正回视口 50% 高度 */
const typewriterPlugin = ViewPlugin.fromClass(
  class {
    private frame = 0;

    constructor(view: EditorView) {
      this.schedule(view, /* immediate */ true);
    }

    update(update: ViewUpdate): void {
      const enabled = update.state.field(typewriterModeField, false) === true;
      if (!enabled) {
        return;
      }
      // geometryChanged 覆盖「异步渲染改变块高度后重新校正」（AC W4 的可测部分）
      if (update.selectionSet || update.docChanged || update.geometryChanged) {
        this.schedule(update.view, /* immediate */ update.docChanged);
      }
    }

    destroy(): void {
      if (this.frame !== 0) {
        cancelFrame(this.frame);
        this.frame = 0;
      }
    }

    /**
     * @param immediate 输入过程中为 true：**禁用 smooth**，避免打字发飘（AC W3）
     */
    private schedule(view: EditorView, immediate: boolean): void {
      if (this.frame !== 0) {
        cancelAnimationFrame(this.frame);
      }
      const run = (): void => {
        this.frame = 0;
        this.recenter(view, immediate);
      };
      // ViewPlugin 只在真实 DOM 环境实例化（node 单测只用 typewriterModeField，
      // 不构造本插件），故走原生 `requestAnimationFrame` —— 但保留**最小环境守卫**：
      // 非浏览器环境（jsdom/SSR/纯 node）无 rAF，直接返回 0 = 不排程。
      // 注：先前删掉的是「`typeof` + `setTimeout` 充降」分支 —— 投机的是 **setTimeout 语义**
      //（凭空发明定时重校行为），而非守卫本身；守卫只避免崩溃、不改变任何浏览器语义，
      // 并与 `destroy()` 的 `cancelFrame` 对称（后者同样带守卫）。
      this.frame = scheduleFrame(run);
    }

    private recenter(view: EditorView, immediate: boolean): void {
      const enabled = view.state.field(typewriterModeField, false) === true;
      if (!enabled) {
        return;
      }
      const rect = view.dom.getBoundingClientRect();
      const deviation = measureCenterDeviation(view);
      if (deviation === null) {
        return;
      }
      // 防抖：偏离不超过阈值 → 不滚动（AC W1）
      if (deviation <= rect.height * DEVIATION_THRESHOLD_RATIO) {
        return;
      }
      view.dispatch({
        effects: EditorView.scrollIntoView(view.state.selection.main.head, {
          y: "center",
        }),
        // 纯滚动事务：不改 selection、不改 doc → 不触发 undo、不触发投影重建
        scrollIntoView: !immediate,
      });
    }
  },
);

/** 打字机模式扩展 */
/** 环境守卫：非浏览器（jsdom/SSR/纯 node）无 rAF → 返回 0 表示「不排程」，不抛错 */
function scheduleFrame(run: () => void): number {
  if (typeof requestAnimationFrame !== "function") {
    return 0;
  }
  return requestAnimationFrame(run);
}

/** 与 `scheduleFrame` 对称的取消（同样带守卫，避免无 rAF 环境下 destroy 抛错） */
function cancelFrame(frame: number): void {
  if (frame !== 0 && typeof cancelAnimationFrame === "function") {
    cancelAnimationFrame(frame);
  }
}

export const typewriterModeExtension: Extension = [typewriterModeField, typewriterPlugin];
