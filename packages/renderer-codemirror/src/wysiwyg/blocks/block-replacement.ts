/**
 * @file block-replacement.ts
 * @description 整行块级替换装饰（`Decoration.replace({ block: true })`）的统一契约，以及"符号型块"间距规则。
 *
 * ## 为什么需要这个模块
 *
 * CodeMirror 6 的块级替换装饰对**起点/终点 inclusivity** 有严格语义：
 *
 * 1. **起点未覆盖 ⇒ 合成幽灵空行**：`inclusive: false` 时 `startSide > 0`，view builder 判定
 *    装饰起点没有被块级范围覆盖，于是调用 `b.addLineStartIfNotCovered()`，在 widget **上方**
 *    强行合成一个幽灵 `.cm-line`。源码里本来就有的空行 + 幽灵行 = 视觉上多出一个空行，
 *    而且光标还能落进这个不存在的行（视觉与底层 offset 割裂）。
 * 2. **终点覆盖 ⇒ 吞并下方换行**：`inclusiveEnd: true` 时 widget 获得 `TileFlag.IncEnd`，
 *    构建器认为紧随其后的换行已被 widget 覆盖，直接吞掉，导致下方空行少一行。
 *
 * 因此凡覆盖整行（行首 → 行尾，可含尾换行）的块级替换，**必须**使用不对称 Inclusivity 契约：
 *
 * ```typescript
 * inclusiveStart: true,  // 阻止上方合成幽灵空行
 * inclusiveEnd: false,   // 阻止吞并紧随其后的换行
 * ```
 *
 * 契约原文见 `docs/agent/specs/thematic_break_and_block_inclusivity_spec.md`。
 * 本模块是该契约的**唯一实现来源**：新增整行块级 widget 必须走
 * {@link buildWholeLineBlockReplacement}，不得再手写 `Decoration.replace` 的边界参数。
 *
 * ## 符号型块（symbol block）
 *
 * 定义：整行块级 widget，其渲染物**不含用户可读文本**，仅为结构符号/装饰，且用户无法用源码
 * 空行以外的粒度微调其视觉厚度（当前成员：分割线）。
 *
 * 这类块的"呼吸感"由展示层统一提供（见 {@link blockReplacementTheme}），而**不是**伪造空行：
 * 空行数量始终与源码 1:1，间距只加垂直方向，不影响源码与光标步数。
 *
 * ⚠️ 间距必须用 **padding** 交付，**禁止 margin**：CM6 的高度图（`HeightMap`）对每一行/块只量
 * border-box 高度（`getBoundingClientRect().height`），**不包含 margin**；而 `posAtCoords` 的
 * y→行号映射完全建立在高度图上（`view.elementAtHeight(yOffset)`）。每漏算一次 margin，
 * 该块之后所有内容的"点击位置 vs 光标落点"就整体偏移同样的量；累计超过一个行高即偏一行。
 * 实测：文档含 2 个分割线时漏算 2×16px=32px > 行高 28px，点击段落会落到下一行
 * （见 `thematic_break_and_block_inclusivity_spec.md` 的"高度图契约"一节）。
 */

import type { EditorState, Extension, Range } from "@codemirror/state";
import { Decoration, EditorView, type WidgetType } from "@codemirror/view";
import type { MarkdownRangeRecord } from "../../markdown/range-types.ts";

/** 整行块级 widget 的视觉类别：`symbol` 由展示层统一提供默认垂直间距。 */
export type WysiwygBlockCategory = "symbol" | "content";

/** 类别以 DOM 属性对外暴露，供 CSS 与 E2E 断言共同使用。 */
export const WYSIWYG_BLOCK_CATEGORY_ATTRIBUTE = "data-md-block-category";

/** 符号型块默认垂直间距的展示层 token；值由主题/宿主可覆盖。 */
export const BLOCK_SYMBOL_GAP_VARIABLE = "--theme-block-symbol-gap";

/**
 * 在 widget 根节点上声明视觉类别。符号型块（{@link WysiwygBlockCategory}）由此获得
 * {@link blockReplacementTheme} 的统一间距，无需自己写 padding。
 */
export function applyBlockCategory(dom: HTMLElement, category: WysiwygBlockCategory): void {
  dom.setAttribute(WYSIWYG_BLOCK_CATEGORY_ATTRIBUTE, category);
}

/** 整行块级替换的构造参数。 */
export interface WholeLineBlockReplacement {
  /** 需要整行替换的语法记录。 */
  readonly record: MarkdownRangeRecord;
  readonly state: EditorState;
  readonly widget: WidgetType;
  /** `wysiwygRole`，用于投影诊断与测试断言。 */
  readonly role: string;
  /**
   * 是否把记录末尾的换行一并纳入替换范围（默认 `true`）。
   * 块级投影（表格 / HTML / MDX / setext 标题）需要在**不吞并**换行的前提下覆盖到行尾；
   * 行内不连续的范围（如引用式定义、脚注定义）保持到 `record.fullRange.to`。
   */
  readonly includeTrailingLineBreak?: boolean;
}

/**
 * 构造整行块级替换装饰（不对称 Inclusivity 契约的唯一实现）。
 */
export function buildWholeLineBlockReplacement(
  spec: WholeLineBlockReplacement,
): readonly Range<Decoration>[] {
  const replacementTo =
    spec.includeTrailingLineBreak === false
      ? spec.record.fullRange.to
      : trailingLineBreakEnd(spec.record, spec.state);
  return [
    Decoration.replace({
      widget: spec.widget,
      block: true,
      inclusiveStart: true,
      inclusiveEnd: false,
      wysiwygRecordId: spec.record.id,
      wysiwygRole: spec.role,
    }).range(spec.record.fullRange.from, replacementTo),
  ];
}

/**
 * 记录末尾换行的结束位置：若记录紧邻换行则覆盖到换行之后，否则原地返回。
 * （整行块级替换的终点统一口径，替代历史上散落在各 projection 文件里的同名拷贝。）
 */
export function trailingLineBreakEnd(record: MarkdownRangeRecord, state: EditorState): number {
  return record.fullRange.to < state.doc.length &&
    state.sliceDoc(record.fullRange.to, record.fullRange.to + 1) === "\n"
    ? record.fullRange.to + 1
    : record.fullRange.to;
}

/**
 * 符号型块的展示层间距规则。规则本体收敛在 renderer 核心层，宿主只通过
 * {@link BLOCK_SYMBOL_GAP_VARIABLE} 提供设计值；未定义时回落到 8px（DESIGN.md 4px 基线网格）。
 *
 * 为什么是 padding 而不是 margin（**不要在符号块上改回 margin**）：
 * CM6 的高度图只量 border-box，margin 不计入 ⇒ 每个符号块的间距都会成为高度图的
 * 累计误差，使鼠标点击的 y 被映射到错误的行（详见模块头注释与 spec 的"高度图契约"）。
 * `boxSizing: content-box` 使 padding 对声明了固定高度的 widget 也是**额外**空间，
 * 因此视觉足迹与旧的 `height + 2×margin` 完全一致（分割线行 29.6px + 16px = 45.6px 不变）。
 */
export const blockReplacementTheme: Extension = EditorView.baseTheme({
  [`[${WYSIWYG_BLOCK_CATEGORY_ATTRIBUTE}="symbol"]`]: {
    boxSizing: "content-box",
    paddingTop: `var(${BLOCK_SYMBOL_GAP_VARIABLE}, 0.5rem)`,
    paddingBottom: `var(${BLOCK_SYMBOL_GAP_VARIABLE}, 0.5rem)`,
  },
});
