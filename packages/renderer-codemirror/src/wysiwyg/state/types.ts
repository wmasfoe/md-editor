/** Projection contracts and singleton feature/effect identities. */
import { Facet, StateEffect } from "@codemirror/state";
import { type DecorationSet } from "@codemirror/view";
import type { EditorMode } from "@md-editor/editor-core";
import type { SourceRange } from "../../markdown/range-types.ts";

export type WysiwygProjectionFeature =
  | "inline-styles"
  | "headings"
  | "blocks"
  | "links"
  | "images"
  | "thematic-breaks"
  | "default-atoms"
  | "frontmatter"
  | "tables"
  | "html"
  | "mdx"
  | "directives";

export interface SelectWysiwygAtomEffect {
  readonly recordId: string;
  readonly extend: boolean;
}

/**
 * protected range 的 provenance 来源类型。
 *
 * 宽选区放行语义按 kind 区分：table/html 允许"恰好相等选区"（整块原子选中后
 * 直接打字/粘贴等价于替换整块）；其余来源必须严格更宽（G012 语义：
 * 恰好拒绝、跨块更宽才放行）。携带 kind 保证判定不依赖几何形状，
 * 未来新增来源只增加一个 kind 值。
 */
export type ProtectedRangeKind =
  "default-atom" | "frontmatter" | "block-marker" | "code" | "table" | "html" | "mdx";

export interface ProtectedSourceRange extends SourceRange {
  readonly kind: ProtectedRangeKind;
}

export interface WysiwygProjectionSnapshot {
  readonly mode: EditorMode;
  readonly rangeIndexVersion: number;
  readonly activeSyntaxIds: readonly string[];
  readonly selectedAtomIds: readonly string[];
  readonly compositionGuardRanges: readonly SourceRange[];
  readonly protectedRanges: readonly ProtectedSourceRange[];
  readonly layoutDecorationCount: number;
  readonly atomicRangeCount: number;
  readonly lastSelectionDeltaIds: readonly string[];
  readonly inlineMarkerRevealIds: readonly string[];
}

export interface WysiwygProjectionState {
  readonly mode: EditorMode;
  readonly rangeIndexVersion: number;
  readonly activeSyntaxIds: readonly string[];
  readonly selectedAtomIds: readonly string[];
  readonly compositionGuardRanges: readonly SourceRange[];
  readonly protectedRanges: readonly ProtectedSourceRange[];
  readonly layoutDecorations: DecorationSet;
  readonly atomicRanges: DecorationSet;
  readonly lastSelectionDeltaIds: readonly string[];
  /**
   * 四类内置行内标记的**源码显形点集**（仅这些 kind，且仅 OFF 时非空）。
   * 由 `resolveInlineMarkerRevealIds` 在投影层单点派生；`touching()` 闭区间语义，
   * 含“范围选区贴边”这一 `activeSyntaxIds` 不覆盖的情形。
   */
  readonly inlineMarkerRevealIds: readonly string[];
  /** 刚由输入事务产生的光标位置;用于 reveal-source 记录闭合符右缘的 reveal 宽松判定 */
  readonly typedBoundary: number | null;
  /** 最近一次可见区(EditorView 几何采集,effect 注入);空 = 未初始化,全量构建 */
  readonly visibleRanges: readonly SourceRange[];
}

export const configuredProjectionFeatures = Facet.define<
  readonly WysiwygProjectionFeature[],
  readonly WysiwygProjectionFeature[]
>({
  combine(values) {
    return Object.freeze([...new Set(values.flat())]);
  },
});

export const selectWysiwygAtomEffect = StateEffect.define<SelectWysiwygAtomEffect>();

export const clearWysiwygAtomSelectionEffect = StateEffect.define<null>();

export const startWysiwygCompositionGuardEffect = StateEffect.define<readonly SourceRange[]>();

export const endWysiwygCompositionGuardEffect = StateEffect.define<null>();

/**
 * G006 P1-4:EditorView 几何采集(visibleRanges)经此 effect 注入投影层。
 * 由 visibleRangesProbePlugin 在 viewportChanged 时派发;StateField 缓存并在
 *
 * ⚠️ **生产当前是全文构建**（PRD R-6 明说，方案 (b) 约定）：probe 有意 no-op（update
 * 周期禁 dispatch 的 CM 规范约束），生产不派发本 effect，G006 视口过滤处于休眠能力态；
 * dispatcher 侧 feed（scroll/RAF 回调派发 + rangesEqual diff + scroll-jank 基准）
 * = 方案 (a)，留给后续 $performance-goal 硬前置。F6/OB2 测试改写到 effect 注入路径。
 * 全量重建时过滤 layoutDecorations(原子/保护范围保持全文)。
 */
export const setWysiwygVisibleRangesEffect = StateEffect.define<readonly SourceRange[]>();

/**
 * compositionend 后由 renderer 派发:强制投影全量重建一次。
 * composition 期间的输入事务只 map 不重建(见 isCompositionInputTransaction),
 * 该 effect 保证 IME 提交完成后装饰与最终文档一致。
 */
export const refreshWysiwygProjectionEffect = StateEffect.define<null>();

export const clearWysiwygTypedBoundaryEffect = StateEffect.define<null>();
