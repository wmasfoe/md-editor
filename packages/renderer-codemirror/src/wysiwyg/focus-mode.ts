/**
 * @file focus-mode.ts
 * @description D-2 专注模式（**F-C 机制**，brief 指定）。
 *
 * ## 机制（brief 原文落地）
 * - **普通块 dim**：独立 StateField 装饰集（`focusDimDecorationsField`，`Decoration.line`）
 *   负责非活动块 `cm-md-focus-dim`、活动块 `cm-md-focus-active`；
 * - **ATOMIC_WIDGET_KINDS**（thematic-break/table/html/mdx-jsx）：ViewPlugin 切换
 *   **widget 根 class**（`cm-md-focus-active-atomic` 等）——
 *   严禁在 replace widget 同范围叠加 `Decoration.line`（F5 回归重点：同范围线装饰
 *   被覆盖会让块消失，装饰集对原子块**一律跳过**，由构造避开该坑）；
 * - 严禁耦合进投影 builder（本模块零投影 builder 触点，G004 map-vs-rebuild 无关）。
 *
 * ## G006 视口过滤（F6，方案 (b)）
 * `visibleRanges` 注入（`setWysiwygVisibleRangesEffect`）非空时，装饰集只构建
 * 与可见区相交的块（可见区外不构建）。
 *
 * ⚠️ **生产当前是全文构建**（PRD R-6 明说，方案 (b) 约定）：`visibleRangesProbePlugin`
 * 有意 no-op（update 周期禁 dispatch 的 CM 规范约束），生产**不派发**
 * `setWysiwygVisibleRangesEffect`，G006 视口过滤处于休眠能力态；dispatcher 侧
 * 合法 feed（scroll/RAF 回调派发 + rangesEqual diff + scroll-jank 基准）= 方案 (a)，
 * 为后续 `$performance-goal` 的两个硬前置。**不得把专注模式性能故事押在休眠行为上**。
 */

import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
  type Range,
} from "@codemirror/state";
import {
  Decoration,
  EditorView,
  ViewPlugin,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { ATOMIC_WIDGET_KINDS, readBlockRanges, type BlockRange } from "./block-move.ts";
import { wysiwygProjectionField } from "./projection-state.ts";

/** 专注模式开关（零文档变更，纯视图态） */
export const setFocusModeEffect = StateEffect.define<boolean>();

export const focusModeField = StateField.define<boolean>({
  create() {
    return false;
  },
  update(value, transaction) {
    for (const effect of transaction.effects) {
      if (effect.is(setFocusModeEffect)) {
        return effect.value;
      }
    }
    return value;
  },
});

/** dim 强度（默认 0.38，可配区间 0.30–0.50） */
export const DEFAULT_DIM_OPACITY = 0.38;

/**
 * dim 强度的**可配通道**（code-review LOW：原为无配置路径的硬编码）。
 * 选 facet 而非 host option：dim 属编辑器层视图话语语义（AGENTS.md 架构边界），
 * 扩展/宿主经 `focusDimOpacityFacet.of(0.45)` 注入即可。读取时按 spec 区间 **[0.30, 0.50] 硬夹**。
 */
export const focusDimOpacityFacet = Facet.define<number>();

export function resolveDimOpacity(state: EditorState): number {
  const raw = state.facet(focusDimOpacityFacet)[0] ?? DEFAULT_DIM_OPACITY;
  return Math.min(0.5, Math.max(0.3, raw));
}

/**
 * 活动块 = **光标**所在块（不是选区端点、不是鼠标悬停）。
 * 无光标块命中时返回 null（例如光标落在块间空行）。
 */
export function resolveActiveBlock(blocks: readonly BlockRange[], head: number): BlockRange | null {
  for (const block of blocks) {
    if (block.from <= head && head <= block.to) {
      return block;
    }
  }
  return null;
}

function blockAtPos(blocks: readonly BlockRange[], pos: number): BlockRange | null {
  for (const block of blocks) {
    if (block.from <= pos && pos <= block.to) {
      return block;
    }
  }
  return null;
}

/** 原子 widget 块判定（F5 的 dim 走 widget 外层 class，不用线装饰） */
export function isAtomicWidgetBlock(block: BlockRange): boolean {
  return ATOMIC_WIDGET_KINDS.has(block.name);
}

/**
 * 普通块 dim 装饰集（brief 指定的「独立 StateField 装饰集」）。
 *
 * - 活动块 → `cm-md-focus-active`；其余普通块 → `cm-md-focus-dim`；
 * - **原子块跳过**（F5：widget 根 class 归 ViewPlugin，同范围叠加线装饰会让块消失）；
 * - **G006 视口过滤（F6）**：`visibleRanges` 非空时只构建与可见区相交的块。
 *   生产当前是全文构建（见文件头 ⚠️ 注）；测试经 `setWysiwygVisibleRangesEffect` 注入驱动。
 */
export const focusDimDecorationsField = StateField.define<DecorationSet>({
  create(state) {
    return buildFocusDecorations(state);
  },
  update(value, transaction) {
    if (
      transaction.docChanged ||
      transaction.selection ||
      // 任一 effect 即重建：避免 StateEffect.is 的跨模块身份判定（实测失配致
      // setWysiwygVisibleRangesEffect 触发不达）；重建本体廉价（M11 缓存 + 按可见区过滤）
      transaction.effects.length > 0
    ) {
      return buildFocusDecorations(transaction.state);
    }
    return value;
  },
  provide(field) {
    return EditorView.decorations.from(field);
  },
});

function buildFocusDecorations(state: EditorState): DecorationSet {
  const enabled = state.field(focusModeField, false) === true;
  if (!enabled) {
    return Decoration.none;
  }
  const head = state.selection.main.head;
  const blocks = readBlockRanges(state);
  const active = resolveActiveBlock(blocks, head);
  const projection = state.field(wysiwygProjectionField, false);
  const visibleRanges = projection?.visibleRanges ?? [];

  const decorations: { pos: number; deco: Range<Decoration> }[] = [];
  for (const block of blocks) {
    // F5：原子 widget 块（replace widget 同范围）一律跳过 —— 归 ViewPlugin 的 widget 根 class
    if (isAtomicWidgetBlock(block)) {
      continue;
    }
    const isActive = active !== null && block.from === active.from;
    const className = isActive ? "cm-md-focus-active" : "cm-md-focus-dim";
    const firstLine = state.doc.lineAt(block.from).number;
    const lastLine = state.doc.lineAt(block.to).number;
    for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
      const line = state.doc.line(lineNumber);
      // F6 / G006（**行级**过滤，贴「可见区外不构建」）：visibleRanges 非空时
      // 只构建与可见区相交的行（生产当前全空 → 全文构建，见文件头）。
      if (
        visibleRanges.length > 0 &&
        !visibleRanges.some((range) => line.from < range.to && range.from < line.to)
      ) {
        continue;
      }
      decorations.push({
        pos: line.from,
        deco: Decoration.line({ class: className }).range(line.from),
      });
    }
  }
  return Decoration.set(decorations.toSorted((a, b) => a.pos - b.pos).map((entry) => entry.deco));
}

/**
 * ViewPlugin：只负责 **ATOMIC widget 根 class**（F5）+ root 开关类 + dim 强度 CSS 变量。
 * 普通块的 dim/active **不在此处触碰**（装饰集负责）—— 防止与线装饰类互相覆盖。
 */
const focusWidgetClassPlugin = ViewPlugin.fromClass(
  class FocusWidgetClassPlugin {
    constructor(view: EditorView) {
      this.apply(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.geometryChanged ||
        update.startState.field(focusModeField, false) !== update.state.field(focusModeField, false)
      ) {
        this.apply(update.view);
      }
    }

    private apply(view: EditorView): void {
      const root = view.contentDOM as HTMLElement | null;
      if (root === null) {
        return;
      }
      const enabled = view.state.field(focusModeField, false) === true;
      root.classList.toggle("cm-md-focus-mode", enabled);
      if (enabled) {
        root.style.setProperty("--cm-md-focus-dim-opacity", String(resolveDimOpacity(view.state)));
      } else {
        root.style.removeProperty("--cm-md-focus-dim-opacity");
      }

      const head = view.state.selection.main.head;
      const blocks = readBlockRanges(view.state);
      const active = resolveActiveBlock(blocks, head);
      for (const child of Array.from(root.children)) {
        const element = child as HTMLElement;
        let pos: number;
        try {
          pos = view.posAtDOM(element);
        } catch {
          // 回收/非内容节点：grounded DOM 边界，跳过即可（评审已确认该 catch 有据）
          continue;
        }
        const block = blockAtPos(blocks, pos);
        // F5：只管原子 widget 根；普通块归装饰集，这里不得触碰（防覆盖线装饰类）
        if (!enabled || block === null || !isAtomicWidgetBlock(block)) {
          element.classList.remove(
            "cm-md-focus-active",
            "cm-md-focus-dim",
            "cm-md-focus-active-atomic",
          );
          continue;
        }
        const isActive = active !== null && block.from === active.from;
        element.classList.toggle("cm-md-focus-active", isActive);
        element.classList.toggle("cm-md-focus-dim", !isActive);
        element.classList.toggle("cm-md-focus-active-atomic", isActive);
      }
    }

    destroy(): void {
      // 类装饰随 DOM 一起销毁；无外部资源需要释放
    }
  },
);

/**
 * 专注模式主题。
 * 关键约束：**不加背景色/遮罩**（保持宣纸/炭焙材质），只降透明度 + 120ms 过渡。
 * 搜索命中（`.cm-searchMatch` 等）显式**不受 dim 影响**，保证 F3 的对比度要求
 *（F3 处置：合成装饰测试不可在 node 环境验证 CSS 计算 —— 见 test-spec §4 显式延期台账）。
 */
export const focusTheme = EditorView.baseTheme({
  ".cm-md-focus-mode > *": {
    transition: "opacity 120ms ease",
  },
  ".cm-md-focus-mode > .cm-md-focus-dim": {
    opacity: "var(--cm-md-focus-dim-opacity, 0.38)",
  },
  ".cm-md-focus-mode > .cm-md-focus-active": {
    opacity: "1",
  },
  // F3：搜索命中在 dim 块内仍保持对比度
  ".cm-md-focus-mode > .cm-md-focus-dim .cm-searchMatch, .cm-md-focus-mode > .cm-md-focus-dim .cm-searchMatch-selected":
    {
      opacity: "1",
    },
});

/** 专注模式扩展：开关字段 + 普通块装饰集 + 原子 widget class 插件 + 主题 */
export const focusModeExtension: Extension = [
  focusModeField,
  focusDimDecorationsField,
  focusWidgetClassPlugin,
  focusTheme,
];
