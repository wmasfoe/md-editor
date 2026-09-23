/**
 * @file focus-mode.ts
 * @description D-2 专注模式（**F-C 机制**，brief 指定）。
 *
 * ## 机制
 * - **普通块 dim**：独立 StateField 装饰集（`focusDimDecorationsField`，`Decoration.line`）
 *   负责非活动块 `cm-md-focus-dim`、活动块 `cm-md-focus-active`；
 * - **块 widget dim**：`focusWidgetClassPlugin` 切换**块根元素**（整块 replace widget 根，
 *   如表格 / HTML / MDX / 分割线 / setext 标题 / 引用定义 / 脚注定义 / 代码块）上的同名根类。
 *
 * ## 所有权契约（两者**不得互相写对方的 DOM**）
 * 1. `.cm-line` 元素上的 focus 类**只**由 StateField 装饰集写；
 * 2. 非 `.cm-line` 的块根元素上的 focus 类**只**由 ViewPlugin 写；
 * 3. 装饰集对**块 widget 覆盖的行**一律跳过。
 *
 * 契约 1 是硬约束：CodeMirror 的 ViewPlugin 在 docView 之前更新
 *（`@codemirror/view` 的 `updatePlugins` 先于 `docView.update`），且行元素的 attrs
 * 仅在 tile 标记 `AttrsDirty` 时才重放、`observeOptions` 不观察 `attributes` 变化 ——
 * 因此插件若 `remove()` 装饰集写下的行类，该类在后续更新中会被静默抹掉且难以自愈。
 *
 * ## 契约 3 的判据来自**投影层的渲染契约**，而非块工具栏的 kind 名单
 * 判据 = `wysiwygProjectionField.layoutDecorations` 中 `spec.block === true` 的 replace
 * 装饰所覆盖的行。理由：`ATOMIC_WIDGET_KINDS`（`block-move.ts`）是**块工具栏**关心的
 * 4 个 kind（thematic-break/table/html/mdx-jsx），而 setext 标题、引用定义、脚注定义、
 * 代码块同样以整块 replace widget 渲染（见 `default-visualization.ts`、
 * `code-block-projection.ts`、`link-projection.ts`）。在块 widget 同位置挂
 * `Decoration.line` 会触发 CM 的 `addLineStartIfNotCovered` → 幻影行 / 块消失（F5）。
 * 用渲染契约做判据可让**将来新增的块 widget kind 自动被覆盖**，不再依赖「记得登记名单」。
 *
 * ## G006 视口过滤（F6，方案 (b)）
 * `visibleRanges` 注入（`setWysiwygVisibleRangesEffect`）非空时，装饰集只构建
 * 与可见区相交的**行**（可见区外不构建）。
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
import { readBlockRanges, type BlockRange } from "./block-move.ts";
import {
  setWysiwygVisibleRangesEffect,
  wysiwygProjectionField,
  type WysiwygProjectionState,
} from "./projection-state.ts";
import type { SourceRange } from "../markdown/range-types.ts";

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

/** 解析并**硬夹** dim 强度到 spec 区间 [0.30, 0.50]；非有限值回落到默认值 */
export function resolveDimOpacity(state: EditorState): number {
  const raw = state.facet(focusDimOpacityFacet)[0] ?? DEFAULT_DIM_OPACITY;
  if (!Number.isFinite(raw)) {
    return DEFAULT_DIM_OPACITY;
  }
  return Math.min(0.5, Math.max(0.3, raw));
}

const ACTIVE_CLASS = "cm-md-focus-active";
const DIM_CLASS = "cm-md-focus-dim";
/** CodeMirror 行元素类：装饰集的所有权标志 */
const LINE_ELEMENT_CLASS = "cm-line";

/**
 * 命中 pos 所在块（端点 `from`/`to` 均含）。
 *
 * 二分查找：`readBlockRanges` 的输出**保证按 from 升序且互不嵌套**（`computeBlockRanges`
 * 每个分支都把 `lineNumber` 推进到所推范围的末行之后），故可安全二分。
 * 无光标块命中时返回 null（例如光标落在块间空行）。
 */
export function resolveActiveBlock(blocks: readonly BlockRange[], pos: number): BlockRange | null {
  let low = 0;
  let high = blocks.length - 1;
  while (low <= high) {
    const middle = (low + high) >>> 1;
    const block = blocks[middle] as BlockRange;
    if (pos < block.from) {
      high = middle - 1;
    } else if (pos > block.to) {
      low = middle + 1;
    } else {
      return block;
    }
  }
  return null;
}

/**
 * 块 widget 覆盖范围缓存（按 `layoutDecorations` 的**对象身份**记忆）。
 *
 * 与 `readBlockRanges` 的 M11 缓存同理由：该推导处在每键热路径上，且
 * `layoutDecorations` 在同一投影状态下恒等 —— 身份未变 ⇒ 渲染契约未变。
 * 键取 `layoutDecorations` 而非投影状态对象：后者在 `visibleRanges` 变化时也会换新，
 * 但块 widget 范围与可见区无关，无需重扫。
 */
let cachedLayoutDecorations: unknown = null;
let cachedWidgetRanges: readonly SourceRange[] = [];

const NO_RANGES: readonly SourceRange[] = [];

function blockWidgetRanges(
  projection: WysiwygProjectionState,
  docLength: number,
): readonly SourceRange[] {
  if (projection.layoutDecorations === cachedLayoutDecorations) {
    return cachedWidgetRanges;
  }
  const ranges: SourceRange[] = [];
  projection.layoutDecorations.between(0, docLength, (from, to, value) => {
    // 块 widget 的唯一可靠标志：投影层自己写的 block replace 装饰
    if (value.spec?.block === true) {
      ranges.push({ from, to });
    }
  });
  cachedLayoutDecorations = projection.layoutDecorations;
  cachedWidgetRanges = ranges;
  return ranges;
}

/**
 * 普通块 dim 装饰集（brief 指定的「独立 StateField 装饰集」）。
 *
 * - 活动块 → `cm-md-focus-active`；其余普通块 → `cm-md-focus-dim`；
 * - **块 widget 覆盖的行一律跳过**（F5：同位置线装饰会造幻影行 / 让块消失），
 *   这些块的 dim 由 `focusWidgetClassPlugin` 在块根元素上切换类；
 * - **G006 视口过滤（F6）**：`visibleRanges` 非空时只构建与可见区相交的**行**。
 *   生产当前是全文构建（见文件头 ⚠️ 注）；测试经 `setWysiwygVisibleRangesEffect` 注入驱动。
 */
export const focusDimDecorationsField = StateField.define<DecorationSet>({
  create(state) {
    return buildFocusDecorations(state);
  },
  update(value, transaction) {
    if (
      transaction.docChanged ||
      // 光标移动 → 活动块变化 → 类必须迁移
      transaction.selection !== undefined ||
      // 只对本装饰集**真正相关**的两条 effect 重建：
      //  - `setWysiwygVisibleRangesEffect`：可见区注入（G006/F6）；
      //  - `setFocusModeEffect`：开关切换 —— 否则字段会保留 create() 时（关闭态）
      //    算出的空集，正是「窄触发看似失效」的真实原因（早前误记为 effect 身份失配）。
      // 其余 effect（原子选区、组合门控、解析进度等）与本装饰集无关，不得触发全量重建。
      transaction.effects.some(
        (effect) => effect.is(setWysiwygVisibleRangesEffect) || effect.is(setFocusModeEffect),
      )
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
  if (state.field(focusModeField, false) !== true) {
    return Decoration.none;
  }
  const head = state.selection.main.head;
  const blocks = readBlockRanges(state);
  const active = resolveActiveBlock(blocks, head);
  const projection = state.field(wysiwygProjectionField, false);
  const visibleRanges = projection?.visibleRanges ?? NO_RANGES;
  const widgetRanges =
    projection === undefined ? NO_RANGES : blockWidgetRanges(projection, state.doc.length);

  const decorations: Range<Decoration>[] = [];
  let widgetIndex = 0;
  for (const block of blocks) {
    const className = active !== null && block.from === active.from ? ACTIVE_CLASS : DIM_CLASS;
    const firstLine = state.doc.lineAt(block.from).number;
    const lastLine = state.doc.lineAt(block.to).number;
    for (let lineNumber = firstLine; lineNumber <= lastLine; lineNumber += 1) {
      const line = state.doc.line(lineNumber);
      // 契约 3：块 widget 覆盖的行交回 widget 根 class 机制。
      // 行与 widget 范围都按位置升序，故用单调游标（O(lines + widgets)）。
      while (widgetIndex < widgetRanges.length && widgetRanges[widgetIndex].to <= line.from) {
        widgetIndex += 1;
      }
      if (widgetIndex < widgetRanges.length && widgetRanges[widgetIndex].from < line.to) {
        continue;
      }
      // F6 / G006（**行级**过滤，贴「可见区外不构建」）：visibleRanges 非空时
      // 只构建与可见区相交的行（生产当前全空 → 全文构建，见文件头）。
      if (
        visibleRanges.length > 0 &&
        !visibleRanges.some((range) => line.from < range.to && range.from < line.to)
      ) {
        continue;
      }
      decorations.push(Decoration.line({ class: className }).range(line.from));
    }
  }
  // blocks 与其中的行均按 from 升序 ⇒ 结果已有序（`Decoration.set` 要求有序输入，
  // 若上游破坏了升序/不嵌套前提会在此**显式抛错**而非静默错位）
  return Decoration.set(decorations);
}

/**
 * 块 widget 根元素的类切换器。
 *
 * **只**处理非 `.cm-line` 的块根元素（契约 1/2）；普通行的类归装饰集，此处绝不触碰。
 * 关闭态若已完成清理则零工作（不遍历 contentDOM.children）。
 */
const focusWidgetClassPlugin = ViewPlugin.fromClass(
  class FocusWidgetClassPlugin {
    /** 上一次是否处于「已施加」状态（开启态，或关闭态但已完成清理） */
    private applied = false;

    update(update: ViewUpdate): void {
      const enabled = update.state.field(focusModeField, false) === true;
      if (
        !enabled &&
        !this.applied &&
        !update.docChanged &&
        !update.viewportChanged &&
        !update.geometryChanged
      ) {
        // 关闭且已清理且无 DOM 变动 → 无需工作（typewriter-mode 同款早退）。
        // 注：无需额外看 reconfigure/effects —— 开启态**每次都**重算并重新施加，
        // 故 widget DOM 重建（reconfigure、effect-only 更新等）已被覆盖；
        // 关闭态则本就不存在插件写入的类需要回收。
        return;
      }
      this.apply(update.view, enabled);
      this.applied = enabled;
    }

    private apply(view: EditorView, enabled: boolean): void {
      const root = view.contentDOM as HTMLElement | null;
      if (root === null) {
        return;
      }
      root.classList.toggle("cm-md-focus-mode", enabled);
      if (enabled) {
        root.style.setProperty("--cm-md-focus-dim-opacity", String(resolveDimOpacity(view.state)));
      } else {
        root.style.removeProperty("--cm-md-focus-dim-opacity");
      }

      // 开启态每次都重算并重新施加：widget DOM 会被复用/重建（viewport、reconfigure、
      // effect-only 更新），一次性施加不足以保证正确；这也是插件不依赖自身缓存的理由。
      const blocks = enabled ? readBlockRanges(view.state) : NO_BLOCKS;
      const active = enabled ? resolveActiveBlock(blocks, view.state.selection.main.head) : null;
      for (const child of Array.from(root.children)) {
        const element = child as HTMLElement;
        // 契约 1：行元素的 focus 类归装饰集所有，插件绝不 remove/toggle
        if (element.classList.contains(LINE_ELEMENT_CLASS)) {
          continue;
        }
        if (!enabled) {
          element.classList.remove(ACTIVE_CLASS, DIM_CLASS);
          continue;
        }
        let pos: number;
        try {
          pos = view.posAtDOM(element);
        } catch {
          // 回收/非内容节点：grounded DOM 边界，跳过即可（评审已确认该 catch 有据）
          continue;
        }
        const block = resolveActiveBlock(blocks, pos);
        if (block === null) {
          // 无法归属任何块的块根：保守清理（不误 dim 非块节点）
          element.classList.remove(ACTIVE_CLASS, DIM_CLASS);
          continue;
        }
        const isActive = active !== null && block.from === active.from;
        element.classList.toggle(ACTIVE_CLASS, isActive);
        element.classList.toggle(DIM_CLASS, !isActive);
      }
    }
  },
);

const NO_BLOCKS: readonly BlockRange[] = [];

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

/** 专注模式扩展：开关字段 + 普通块装饰集 + 块 widget 根类插件 + 主题 */
export const focusModeExtension: Extension = [
  focusModeField,
  focusDimDecorationsField,
  focusWidgetClassPlugin,
  focusTheme,
];
