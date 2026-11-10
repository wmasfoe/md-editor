import type { MarkdownConfig } from "@lezer/markdown";
import { Facet, type EditorState, type Range } from "@codemirror/state";
import type { Decoration, WidgetType } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";

/**
 * 通用 Markdown 语法扩展插件契约。
 * 遵循“纯增量与优雅降级”原则：
 * - 只有插件被显式传入渲染器时，其语法规则与投影逻辑才会被加载；
 * - 若未传入该插件，编辑器安全保持标准 CommonMark/GFM 行为，文档零报错。
 */
export interface MarkdownSyntaxPlugin {
  /** 插件唯一标识符，例如 "markdown.directive" */
  readonly id: string;

  /** 插件展示名称 */
  readonly name: string;

  /**
   * Lezer Markdown 语法配置（defineNodes, parseBlock, parseInline）。
   * 仅在启用插件时追加至 Lezer extensions。
   */
  readonly markdownExtension?: MarkdownConfig;

  /**
   * 单节点简写策略映射（兼容基础配置）。
   */
  readonly nodePolicy?: {
    readonly nodeName: string;
    readonly kind: MarkdownSyntaxKind;
    readonly isBlock: boolean;
  };

  /**
   * 节点策略映射（精准控制 renderPolicy、editPolicy、markerNodeNames 等）。
   */
  readonly nodePolicies?: Readonly<Record<string, MarkdownNodePolicy>>;

  /**
   * 自定义 AST 节点元数据提取器（在 Range Indexing 阶段执行）。
   */
  readonly extractMetadata?: (
    node: SyntaxNode,
    source: string,
    children: readonly SyntaxNode[],
  ) => Record<string, unknown> | undefined;

  /**
   * 自定义内容区间解析器（在 Range Indexing 阶段执行）。
   */
  readonly resolveContentRange?: (
    node: SyntaxNode,
    source: string,
    children: readonly SyntaxNode[],
    markerRanges: readonly SourceRange[],
  ) => SourceRange | null;

  /**
   * WYSIWYG 投影层装饰器构建器。
   */
  readonly buildDecorations?: (
    record: MarkdownRangeRecord,
    state: EditorState,
    context?: { active: boolean; selected: boolean },
  ) => readonly Range<Decoration>[];

  /**
   * 兼容投影配置对象。
   */
  readonly projection?: {
    readonly feature: string;
    readonly buildDecorations?: (
      record: MarkdownRangeRecord,
      state: EditorState,
      context?: { active: boolean; selected: boolean },
    ) => readonly Range<Decoration>[];
  };
}

/**
 * @file range-types.ts
 * @description Markdown 语法范围索引核心类型定义与常用区间操作工具。
 * 定义了源文本范围、语法种类、渲染/编辑/交互策略枚举、结构化代码块/表格/警示块元数据、
 * 以及单条语法范围记录 MarkdownRangeRecord 数据契约。
 */

/**
 * 源码字符起止闭区间（0-indexed, [from, to]）。
 */
export interface SourceRange {
  readonly from: number;
  readonly to: number;
}

/**
 * Markdown 语法节点分类。
 */
export type MarkdownSyntaxKind =
  | "bold"
  | "italic"
  | "strikethrough"
  | "inline-code"
  | "highlight"
  | "heading-atx"
  | "heading-setext"
  | "quote"
  | "list-item-unordered"
  | "list-item-ordered"
  | "task"
  | "link"
  | "image"
  | "thematic-break"
  | "autolink"
  | "reference-link"
  | "reference-image"
  | "reference-definition"
  | "footnote"
  | "frontmatter"
  | "table"
  | "html"
  | "mdx-jsx"
  | "directive"
  | "inline-math"
  | "block-math"
  | "deferred-code"
  | "deferred-table"
  | "deferred-html"
  | "raw-fallback";

/**
 * 投影渲染策略，决定视觉层如何装饰或替换语法节点。
 */
export type MarkdownRenderPolicy =
  | "inline-visible-markers"
  | "heading-active-marker"
  | "marker-hidden"
  | "link-segmented"
  | "image-widget"
  | "thematic-break-widget"
  | "source-only-atom"
  | "frontmatter-panel"
  | "table-widget"
  | "html-widget"
  | "mdx-widget"
  | "mdx-placeholder"
  | "directive-panel"
  | "deferred-raw"
  | "raw-fallback";

/**
 * 编辑保护策略，决定直接键盘输入、删除或粘贴如何处理。
 */
export type MarkdownEditPolicy = "native" | "structured" | "atom-delete" | "source-mode-only";

/**
 * 交互语义策略，决定光标移动、点击展开、块选择等行为。
 */
export type MarkdownInteractionPolicy =
  | "text"
  | "active-line"
  | "structured-block"
  | "toggle"
  | "reveal-source"
  | "select-atom"
  | "source-mode-required"
  | "none";

export type MarkdownRangeSegmentRole =
  "marker" | "content" | "destination" | "title" | "label" | "body" | "delimiter";

export interface MarkdownRangeSegment extends SourceRange {
  readonly role: MarkdownRangeSegmentRole;
}

export type MarkdownCodeBlockKind = "fenced" | "indented";

export type MarkdownCodeBlockFenceStyle = "backtick" | "tilde" | "none";

export type MarkdownCodeBlockStatus = "closed" | "unclosed" | "malformed" | "partial";

export interface MarkdownCodeBlockLineFingerprint extends SourceRange {
  readonly fingerprint: string;
}

export interface MarkdownCodeBlockLanguageInfo {
  readonly raw: string;
  readonly token: string;
  readonly resolvedName: string | null;
}

export interface MarkdownCodeBlockMetadata {
  readonly blockKind: MarkdownCodeBlockKind;
  readonly fenceStyle: MarkdownCodeBlockFenceStyle;
  readonly blockStatus: MarkdownCodeBlockStatus;
  readonly sourceBlockRange: SourceRange;
  readonly sourceFingerprint: string;
  readonly openingFenceRange: SourceRange | null;
  readonly rawInfoRange: SourceRange | null;
  readonly languageTokenRange: SourceRange | null;
  readonly infoSuffixRange: SourceRange | null;
  readonly bodySegments: readonly SourceRange[];
  readonly syntaxIndentRanges: readonly SourceRange[];
  readonly bodyEnvelopeRange: SourceRange | null;
  readonly closingFenceRange: SourceRange | null;
  readonly sourceLineFingerprints: readonly MarkdownCodeBlockLineFingerprint[];
  readonly languageInfo: MarkdownCodeBlockLanguageInfo;
}

export type MarkdownTableCellAlignment = "left" | "center" | "right" | "none";

export interface MarkdownTableCellRange extends SourceRange {
  readonly alignment: MarkdownTableCellAlignment;
}

export interface MarkdownTableBlockMetadata {
  readonly sourceBlockRange: SourceRange;
  readonly sourceFingerprint: string;
  readonly headerRowRange: SourceRange | null;
  readonly delimiterRowRange: SourceRange | null;
  readonly bodyRowRanges: readonly SourceRange[];
  readonly alignments: readonly MarkdownTableCellAlignment[];
  readonly columnCount: number;
  readonly bodyRowCount: number;
  readonly hasLeadingPipes: boolean;
  readonly sourceLineFingerprints: readonly MarkdownCodeBlockLineFingerprint[];
}

export interface MarkdownMdxBlockMetadata {
  readonly componentName: string;
  readonly attributes: readonly { readonly name: string; readonly value: string }[];
}

export interface MarkdownDirectiveMetadata {
  readonly directiveType: string;
  readonly title: string;
  readonly openingMarkerRange: SourceRange;
  readonly closingMarkerRange: SourceRange | null;
  readonly headerRange: SourceRange;
}

export type MarkdownAlertType = "note" | "tip" | "important" | "warning" | "caution";

export interface MarkdownAlertMetadata {
  readonly alertType: MarkdownAlertType;
  readonly title: string;
  readonly markerRange: SourceRange;
  readonly headerLineRange: SourceRange;
}

export interface MarkdownRangeRecord {
  readonly id: string;
  readonly kind: MarkdownSyntaxKind;
  readonly nodeName: string;
  readonly fullRange: SourceRange;
  readonly lineRange: SourceRange;
  readonly blockRange: SourceRange;
  readonly contentRange: SourceRange | null;
  readonly markerRanges: readonly SourceRange[];
  readonly segments: readonly MarkdownRangeSegment[];
  readonly renderPolicy: MarkdownRenderPolicy;
  readonly editPolicy: MarkdownEditPolicy;
  readonly interactionPolicy: MarkdownInteractionPolicy;
  readonly priority: number;
  readonly sourceFingerprint: string;
  readonly parserCoverage: "complete" | "partial";
  readonly codeBlock?: MarkdownCodeBlockMetadata;
  readonly tableBlock?: MarkdownTableBlockMetadata;
  readonly mdxBlock?: MarkdownMdxBlockMetadata;
  readonly directive?: MarkdownDirectiveMetadata;
  readonly alert?: MarkdownAlertMetadata;
  readonly metadata?: Readonly<Record<string, unknown>>;
}

export interface MarkdownParseCoverage {
  readonly to: number;
  readonly complete: boolean;
}

export type MarkdownContentStrategy =
  | "between-markers"
  | "after-first-marker"
  | "before-last-marker"
  | "link-label"
  | "url"
  | "full"
  | "none";

export interface MarkdownNodePolicy {
  readonly kind: MarkdownSyntaxKind;
  readonly renderPolicy: MarkdownRenderPolicy;
  readonly editPolicy: MarkdownEditPolicy;
  readonly interactionPolicy: MarkdownInteractionPolicy;
  readonly priority: number;
  readonly markerNodeNames: readonly string[];
  readonly contentStrategy: MarkdownContentStrategy;
}

// ─────────────────────────────────────────────────────────────────────────────
// 纯数据契约再导出
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Callout（GFM Alert / Container Directive）图标与默认标题。
 * 纯数据层，无 CodeMirror/DOM 依赖。
 *
 * compiler 请从 `@md-editor/plugin-sdk/callout` 导入：本入口顶层会执行
 * `Facet.define`，导入它会把 `@codemirror/state` 拉进导出器。
 */
export { CALLOUT_SVG_ICONS, defaultCalloutTitle, getCalloutSvg } from "./callout-data.ts";

/**
 * CJK 友好的强调定界符 flanking 判定与 Lezer 行内解析器扩展。
 *
 * 放在契约层的原因：语法插件在 Lezer **解析期** 运行，`InlineContext` 不暴露
 * `EditorState`，无法通过 facet 端口注入，只能直接调用这些纯函数。
 */
export {
  CJK_FRIENDLY_MARKDOWN_EXTENSIONS,
  cjkFriendlyEmphasisMarkdownExtension,
  cjkFriendlyStrikethroughMarkdownExtension,
  readDelimiterNeighbors,
  resolveCjkFriendlyDelimiterSides,
  type DelimiterMarker,
  type DelimiterNeighbors,
  type DelimiterSides,
} from "./cjk-flanking.ts";

// ─────────────────────────────────────────────────────────────────────────────
// 宿主端口（Host Ports）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 媒体查看器浮层的打开选项。
 *
 * 契约层只描述"插件想打开什么"，不描述"怎么实现"：浮层 DOM、层级、缩放手势、
 * 焦点恢复等全部由宿主渲染器负责。这样插件无需 import 任何宿主实现。
 */
export type MediaViewerContent =
  | { readonly kind: "image"; readonly src: string; readonly alt: string }
  /**
   * `svg` 必须是**生产者已消毒过**的标记（本项目为 mermaid 在 `securityLevel: "strict"`
   * 下的产出，且已过 id 隔离）。宿主会把它当 DOM 节点注入而非 `<img>`，
   * 因此**不接受**来自不可信输入的原始 SVG 字符串。
   */
  | { readonly kind: "svg"; readonly svg: string; readonly label: string };

/** 缩放/平移限制。 */
export interface MediaViewerZoomPan {
  /** 上限（以内容 1:1 为 100%）；下限恒为 contain 比例。 */
  readonly maxScale?: number;
  /** 平移限位余量。 */
  readonly panMargin?: number;
}

export interface MediaViewerOpenOptions {
  /** 目标文档（插件通常传 widget 所属的 `view.dom.ownerDocument`）。 */
  readonly document: Document;
  /** 归属宿主元素：同一 host 重复 open 时复用，`closeMediaViewerFor(host)` 按它关闭。 */
  readonly host: HTMLElement;
  readonly content: MediaViewerContent;
  /** 初始视图：图表默认 `"width"`（适应宽度），图片沿用 `"contain"`。 */
  readonly fit: "contain" | "width";
  /** 缩放/平移配置；`false` 关闭手势。 */
  readonly zoomPan: false | MediaViewerZoomPan;
  /** 打开时是否接管焦点（浮层是模态，不接管会让键入改到背后文档）。 */
  readonly takeFocus: boolean;
  /** 模态期间需要置 `inert` 的背景根；非 `#root` 约定的宿主应显式传入。 */
  readonly backgroundRoot?: HTMLElement | undefined;
  /** 浮层内「编辑源码」入口；仅 svg 内容传入。 */
  readonly onRequestEdit?: (() => void) | undefined;
  /** 关闭后焦点归还。 */
  readonly restoreFocus?: (() => void) | undefined;
}

/** 媒体查看器浮层句柄。 */
export interface MediaViewerHandle {
  close(options?: { readonly restoreFocus?: boolean }): void;
}

/**
 * 语法插件可用的宿主端口集合。
 *
 * ## 为什么需要这一层
 *
 * 插件契约（本包）必须能被任何宿主实现消费，因此**不得** import 具体渲染器。
 * 但有些插件能力（如"点击 Mermaid 图放大"）本质上需要宿主 UI 才能完成。
 * 解决办法与 ProseMirror 的 `PluginSpec.view(view)`、Tiptap 的 `props.editor`
 * 一致：宿主把自己的能力作为**值**注入，插件通过参数接收，而不是通过模块依赖获取。
 *
 * ## 当前注入路径
 *
 * 宿主通过 `syntaxPluginHostPortsFacet`（由渲染器定义、插件从 `state.facet` 读取）
 * 提供实现。所有成员均为可选：未提供时插件必须优雅降级（例如不显示放大按钮）。
 */
export interface SyntaxPluginHostPorts {
  /** 打开媒体查看器浮层；未提供时插件不应渲染"放大"入口。 */
  readonly openMediaViewer?: (options: MediaViewerOpenOptions) => MediaViewerHandle;
  /** 按宿主元素关闭媒体查看器；未提供时由宿主自行在 destroy 时清理。 */
  readonly closeMediaViewerFor?: (host: HTMLElement) => void;
  /**
   * 创建 Callout 头部 widget。
   *
   * 之所以是端口而非插件自建：widget 的 DOM 结构、图标、无障碍属性属于**渲染规则**，
   * 由渲染器统一拥有才能保证所有插件渲染出的 Callout 外观一致。插件只决定"这里要一个
   * Callout 头部"，具体长什么样由宿主提供。
   */
  readonly createCalloutHeaderWidget?: (input: {
    readonly type: string;
    readonly title: string;
    readonly recordId: string;
  }) => WidgetType;
  /** 创建 Callout 尾部 widget（隐藏闭合标记的占位）。 */
  readonly createCalloutFooterWidget?: () => WidgetType;
}

/**
 * 宿主端口 facet。
 *
 * **定义在契约层的原因**：facet 实例必须被宿主与插件**共享同一个对象引用**才能命中。
 * 若 facet 定义在渲染器里，插件就得 import 渲染器才能读到它——正是本契约要消除的反向依赖。
 * 把 facet 放进 SDK 后：宿主 `syntaxPluginHostPortsFacet.of(ports)` 提供值，
 * 插件 `state.facet(syntaxPluginHostPortsFacet)` 读取值，双方只依赖契约。
 *
 * `@codemirror/state` 在本包是**可选** peer 依赖：只写命令/模板类插件不需要它。
 */
export const syntaxPluginHostPortsFacet: Facet<SyntaxPluginHostPorts, SyntaxPluginHostPorts> =
  Facet.define<SyntaxPluginHostPorts, SyntaxPluginHostPorts>({
    combine: (values) => values[0] ?? {},
  });
