/**
 * @file focus-mode.ts
 * @description 专注模式（Focus Mode）—— D-2，纯视图状态，**零文档变更**。
 *
 * ## 行为
 * 只保留光标所在块全不透明，其余所有块降透明度；跟随**光标**（非鼠标悬停，避免闪烁）。
 * 折叠块整体不被 dim 穿透；搜索命中在 dim 块内对比度不降低（见 `focusTheme`）。
 *
 * ## 实现取向（F-C，且采用其**更安全变体**）
 * Architect 共识评审的 Synthesis 给出两条路：独立 StateField 装饰集 / ViewPlugin 切 class。
 * 本实现**完全不用 decoration**，只用一个 ViewPlugin 对 `view.contentDOM` 的块级子元素切 class：
 *
 * - **F5 由构造免疫**：`ATOMIC_WIDGET_KINDS`（thematic-break/table/html/mdx-jsx）是 replace widget，
 *   在同范围叠加 `Decoration.line` 会被静默丢弃或让块直接消失（`block-move.ts:33-37` 的在码注释
 *   与 2026-09-21 的围栏锚点教训）。**不写 decoration 就不存在这个坑。**
 * - **PM-1 由构造免疫**：G004 纯文本快速路径（`projection-state.ts:572-607`）只判定 transaction
 *   与 range-index 稳定性，且只映射 `wysiwygProjectionField` 自己的装饰集；本模块是**独立 ViewPlugin**，
 *   既不进 `layoutDecorations`，也不参与 map-vs-rebuild 判定 → 不可能把快速路径打回全量重建。
 * - 坐标只经 `view.posAtDOM`（DOM → 文档坐标），**不使用视觉坐标做语义判定**。
 */

import {
  Facet,
  StateEffect,
  StateField,
  type EditorState,
  type Extension,
} from "@codemirror/state";
import { EditorView, ViewPlugin, type ViewUpdate } from "@codemirror/view";
import { ATOMIC_WIDGET_KINDS, readBlockRanges, type BlockRange } from "./block-move.ts";

/** 开关专注模式 */
export const setFocusModeEffect = StateEffect.define<boolean>();

/** 专注模式状态（纯视图状态，不进文档） */
export const focusModeField = StateField.define<boolean>({
  create: () => false,
  update(previous, transaction) {
    let next = previous;
    for (const effect of transaction.effects) {
      if (effect.is(setFocusModeEffect)) {
        next = effect.value;
      }
    }
    return next;
  },
});

/** dim 强度（默认 0.38，可配区间 0.30–0.50） */
const DEFAULT_DIM_OPACITY = 0.38;

/**
 * dim 强度的**可配通道**（code-review LOW：原为无配置路径的硬编码）。
 * 选 facet 而非 host option：dim 属编辑器层视图话语语义（AGENTS.md 架构边界），
 * 扩展/宿主经 `focusDimOpacityFacet.of(0.45)` 注入即可；宿主后续可在 renderer
 * options 加透传字段而不需改本模块。读取时按 spec 区间 **[0.30, 0.50] 硬夹**。
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
function resolveActiveBlock(blocks: readonly BlockRange[], head: number): BlockRange | null {
  for (const block of blocks) {
    if (block.from <= head && head <= block.to) {
      return block;
    }
  }
  return null;
}

/** 原子 replace widget 块：其 DOM 由 widget 自己拥有，必须走 class 切换而非 decoration */
function isAtomicWidgetBlock(block: BlockRange): boolean {
  return ATOMIC_WIDGET_KINDS.has(block.name);
}

/**
 * 块级 DOM 元素 class 切换器。
 * 每次 update 重算活动块，并对 `contentDOM` 的块级子元素加/去
 * `cm-md-focus-active` / `cm-md-focus-dim`。
 *
 * 虚拟化安全：widget DOM 会被复用，故**每次 update 都重新应用**（含 viewportChanged）。
 */
const focusWidgetClassPlugin = ViewPlugin.fromClass(
  class {
    constructor(view: EditorView) {
      this.apply(view);
    }

    update(update: ViewUpdate): void {
      if (
        update.docChanged ||
        update.selectionSet ||
        update.viewportChanged ||
        update.geometryChanged ||
        update.focusChanged
      ) {
        this.apply(update.view);
      }
    }

    destroy(): void {
      /* 无需清理：class 随 DOM 复用/回收一并消失 */
    }

    private apply(view: EditorView): void {
      const root = view.contentDOM as HTMLElement | null;
      if (root === null) {
        return;
      }
      const enabled = view.state.field(focusModeField, false) === true;
      root.classList.toggle("cm-md-focus-mode", enabled);
      if (enabled) {
        // 可配 dim 强度 → CSS 变量（theme 侧读 var(--cm-md-focus-dim-opacity, 0.38)）
        root.style.setProperty("--cm-md-focus-dim-opacity", String(resolveDimOpacity(view.state)));
      } else {
        root.style.removeProperty("--cm-md-focus-dim-opacity");
      }
      if (!enabled) {
        for (const child of Array.from(root.children)) {
          (child as HTMLElement).classList.remove("cm-md-focus-active", "cm-md-focus-dim");
        }
        return;
      }

      const head = view.state.selection.main.head;
      const active = resolveActiveBlock(readBlockRanges(view.state), head);

      for (const child of Array.from(root.children)) {
        const element = child as HTMLElement;
        let pos: number;
        try {
          pos = view.posAtDOM(element);
        } catch {
          continue;
        }
        const isActive = active !== null && active.from <= pos && pos <= active.to;
        element.classList.toggle("cm-md-focus-active", isActive);
        element.classList.toggle("cm-md-focus-dim", !isActive);
        // 原子 widget 块额外打标（便于 CSS 针对性处理，且不与任何 decoration 冲突）
        if (active !== null && isAtomicWidgetBlock(active)) {
          element.classList.toggle(
            "cm-md-focus-active-atomic",
            isActive && isAtomicWidgetBlock(active),
          );
        } else {
          element.classList.remove("cm-md-focus-active-atomic");
        }
      }
    }
  },
);

/**
 * 专注模式主题。
 * 关键约束：**不加背景色/遮罩**（保持宣纸/炭焙材质），只降透明度 + 120ms 过渡。
 * 搜索命中（`.cm-searchMatch` 等）显式**不受 dim 影响**，保证 F3 的对比度要求。
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

/** 专注模式扩展（挂进 renderer 的扩展集） */
export const focusModeExtension: Extension = [focusModeField, focusWidgetClassPlugin, focusTheme];

export { DEFAULT_DIM_OPACITY, resolveActiveBlock, isAtomicWidgetBlock };
