import type { MarkdownConfig } from "@lezer/markdown";
import type { EditorState, Range } from "@codemirror/state";
import type { Decoration } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import type {
  MarkdownRangeRecord,
  MarkdownSyntaxKind,
  SourceRange,
} from "../markdown/range-types.ts";
import type { MarkdownNodePolicy } from "../markdown/node-policy.ts";

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
