/**
 * @file typewriter-mode.ts
 * @description 打字机模式（Typewriter Mode）—— D-2，纯视图状态，**零文档变更**。
 *
 * ## 行为（S6 规格变更后的模型）
 * 光标行**常驻**视口垂直中心，视线固定不动，文档在眼前流过。
 *
 * ## 关键取舍
 * - **常驻居中（S6）**：光标行偏离中心超过 `CENTER_EPSILON_PX` 即校正回 50%。
 *   ⚠️ 本条**取代**了历史规格 W1/W2 的「偏离 ≤0.35×视口高不校正」——
 *   属主确认真实预期是「一直保持 50%」，0.35 阈值会让光标明显偏离中心
 *   （该阈值原本是为规避竞品 VMark 的「轻微移动引起抖动」而设，故此处改用**像素级**
 *   容差 + 短缓动来防抖，而不是放宽到 35% 视口高）。
 * - **防自激**：`CENTER_EPSILON_PX` 容差 + 本插件只写 `scrollDOM.scrollTop`
 *   且**不改 selection/doc** ⇒ 不会自触发（W5：不与大纲滚动同步形成死循环）。
 * - **输入过程即时**：打字时用即时滚动（`immediate=true`），禁用缓动 —— smooth 会造成
 *   跟随延迟、打字发飘（AC W3 保留）。
 * - **光标移动用短缓动**（`CENTER_ANIMATION_MS`）：属主要求“不要太突兀”；
 *   仅 140ms ease-out，且**若期间被外部滚动打断则立刻放弃**（不跟用户抢）。
 * - **手动滚动不抢、不自动归位（A1）**：本模块**不监听 scroll 事件** ——
 *   用户滚轮/拖条后光标可以在视野里偏离中心，直到下次移动光标或输入才重新居中。
 *   ⚠️ **边界（已登记，不夸大）**：`geometryChanged`（异步渲染改高）仍会触发一次重校正，
 *   因此在「几何变化恰好发生在用户手动滚动之后」这一窄场景下仍可能抢一次；
 *   随之一起在历史 test-spec §4 的 W4 延期项中解决（本批曾尝试「几何漂移预算」但实测回归 5 条 E2E ⇒ 回退）。
 * - **单滚动所有权**：只写 CM 自己的 `scrollDOM`，不引入第二个滚动容器。
 * - **异步渲染后重校正**：图表/公式渲染会改变块高度，故 `geometryChanged` 也触发重算。
 */

import { Facet, StateEffect, StateField, type Extension } from "@codemirror/state";
import { ViewPlugin, type EditorView, type ViewUpdate } from "@codemirror/view";

/** 开关打字机模式 */
export const setTypewriterModeEffect = StateEffect.define<boolean>();

/**
 * 居中抖动的**像素级**容差：偏离小于此值不动作。
 *
 * 作用有二：① 避免「滚动 → 几何重算 → 再滚动」的微抖自激；② 避免每帧写 scrollTop。
 * 与历史 W1 的「0.35 × 视口高」不同：这是**抖动量级**的容差，不是「允许偏离多少」的策略。
 */
export const CENTER_EPSILON_PX = 1.5;

/** 光标移动时的居中缓动时长（ms）。输入路径不使用缓动（AC W3）。 */
export const CENTER_ANIMATION_MS = 140;

/** 打字机模式状态（纯视图状态） */

/**
 * 打字机模式**初始值**通道（S1(b)/MED-4 根因修复，与 `focusModeInitialFacet` 同源）
 *
 * 打字机同样属于**视图轴**状态（与文档正交）：文档边界重建 `EditorState` 时必须继承，
 * 否则视图偏好被静默关掉，且宿主菜单镜像与真实状态发散。
 * 用 facet 给初值（而非建成默认值后再 dispatch）也避开了
 * 「切换瞬间触发一次居中滚动」这种副作用。
 */
export const typewriterModeInitialFacet = Facet.define<boolean, boolean>({
  combine: (values) => values.some(Boolean),
});

export const typewriterModeField = StateField.define<boolean>({
  create: (state) => state.facet(typewriterModeInitialFacet),
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
 * 光标行中心相对视口中心的**有符号**偏移（px）：正值 = 光标在中心**下方**。
 * 无法测量时返回 null（fail closed：不滚动）。
 */
export function measureCenterOffset(view: EditorView): number | null {
  const head = view.state.selection.main.head;
  const coords = view.coordsAtPos(head);
  const rect = view.dom.getBoundingClientRect();
  if (coords === null || rect.height === 0) {
    return null;
  }
  const lineCenter = (coords.top + coords.bottom) / 2;
  const viewCenter = rect.top + rect.height / 2;
  return lineCenter - viewCenter;
}

/** 光标行中心与视口中心的**绝对**偏离（px）。无法测量时返回 null。 */
export function measureCenterDeviation(view: EditorView): number | null {
  const offset = measureCenterOffset(view);
  return offset === null ? null : Math.abs(offset);
}

/** 把光标行居中所需的 scrollTop 目标值（浏览器会自行夹到合法区间） */
function centerScrollTarget(view: EditorView, offset: number): number {
  return view.scrollDOM.scrollTop + offset;
}

/** 缓动曲线：ease-out（先快后慢，收尾不突兀） */
function easeOut(progress: number): number {
  return 1 - (1 - progress) ** 3;
}

/** 打字机滚动器：光标行常驻视口 50%（移动光标时短缓动、输入时即时） */
const typewriterPlugin = ViewPlugin.fromClass(
  class {
    private frame = 0;
    /** 缓动动画帧 id（与调度帧分开：动画可被新调度取消） */
    private animationFrame = 0;
    /** 上一次由本插件写入的 scrollTop：若被外部改写则说明用户/他人滚动，动画立即放弃 */
    private lastWrittenScrollTop: number | null = null;

    constructor(view: EditorView) {
      this.schedule(view, /* immediate */ true);
    }

    update(update: ViewUpdate): void {
      const enabled = update.state.field(typewriterModeField, false) === true;
      if (!enabled) {
        this.cancelAnimation();
        return;
      }
      // 刚刚开启（字段翻转）→ 立即排一次居中（否则光标会一直偏离中心直到第一次输入）
      if (update.startState.field(typewriterModeField, false) !== true) {
        this.schedule(update.view, /* immediate */ false);
        return;
      }
      // geometryChanged 覆盖「异步渲染改变块高度后重新校正」（AC W4 的可测部分）。
      // **只有输入（docChanged）走即时**（AC W3：避免打字发飘）；
      // 光标移动与几何变化都走短缓动 —— 否则异步改高会在用户滚动时把视口硬拽一下（A1「不抢」）。
      if (update.selectionSet || update.docChanged || update.geometryChanged) {
        this.schedule(update.view, /* immediate */ update.docChanged);
      }
    }

    destroy(): void {
      if (this.frame !== 0) {
        cancelFrame(this.frame);
        this.frame = 0;
      }
      this.cancelAnimation();
    }

    private cancelAnimation(): void {
      if (this.animationFrame !== 0) {
        cancelFrame(this.animationFrame);
        this.animationFrame = 0;
      }
    }

    /**
     * @param immediate 输入/几何变化时为 true：**禁用缓动**（避免打字发飘，AC W3）
     */
    private schedule(view: EditorView, immediate: boolean): void {
      if (this.frame !== 0) {
        cancelFrame(this.frame);
      }
      this.cancelAnimation();
      const run = (): void => {
        this.frame = 0;
        this.recenter(view, immediate);
      };
      // 最小环境守卫：非浏览器环境（jsdom/SSR/纯 node）无 rAF → 返回 0 = 不排程，不抛错。
      this.frame = scheduleFrame(run);
    }

    private recenter(view: EditorView, immediate: boolean): void {
      if (view.state.field(typewriterModeField, false) !== true) {
        return;
      }
      const offset = measureCenterOffset(view);
      if (offset === null) {
        return;
      }
      // 已在中心（含抖动量级）→ 不动作：防微抖自激、避免每帧写 scrollTop
      if (Math.abs(offset) <= CENTER_EPSILON_PX) {
        return;
      }
      const target = centerScrollTarget(view, offset);
      if (immediate) {
        this.writeScrollTop(view, target);
        return;
      }
      this.animateTo(view, target);
    }

    private writeScrollTop(view: EditorView, value: number): void {
      view.scrollDOM.scrollTop = value;
      this.lastWrittenScrollTop = value;
    }

    /** 短缓动居中；若期间 scrollTop 被外部改写（用户滚动）则立即放弃，不跟用户抢 */
    private animateTo(view: EditorView, target: number): void {
      const start = view.scrollDOM.scrollTop;
      const distance = target - start;
      const startedAt = now();
      // 基线必须刷新为**本帧起点**：否则上一次外部滚动留下的旧基线会让此后**每一帧**
      // 都判定“被外部改写”而直接放弃 ⇒ 手动滚动后动画居中**永久失效**
      //（评审 H-1 静态推导；已修复）。
      this.lastWrittenScrollTop = start;
      this.cancelAnimation();
      // 首帧**不做**外部滚动判定：CM 可能因为本次光标移动而自行做过一次 nearest 滚动，
      // 那不是“用户在滚动”。只在第 2 帧起、且位置相对**我们上次写入值**发生变化时才放弃。
      let frameIndex = 0;
      const step = (): void => {
        this.animationFrame = 0;
        if (
          frameIndex > 0 &&
          this.lastWrittenScrollTop !== null &&
          Math.abs(view.scrollDOM.scrollTop - this.lastWrittenScrollTop) > 2
        ) {
          return;
        }
        frameIndex += 1;
        const elapsed = now() - startedAt;
        const progress = CENTER_ANIMATION_MS <= 0 ? 1 : Math.min(1, elapsed / CENTER_ANIMATION_MS);
        this.writeScrollTop(view, progress >= 1 ? target : start + distance * easeOut(progress));
        if (progress < 1) {
          this.animationFrame = scheduleFrame(step);
        }
      };
      this.animationFrame = scheduleFrame(step);
    }
  },
);

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

/** 单调时钟（测试环境可能有 performance 缺失） */
function now(): number {
  return typeof performance !== "undefined" && typeof performance.now === "function"
    ? performance.now()
    : Date.now();
}

export const typewriterModeExtension: Extension = [typewriterModeField, typewriterPlugin];
