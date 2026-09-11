/**
 * @fileoverview 编辑器核心数据模型与 AST 节点协议 (Editor Content & Nodes)
 *
 * 定义切片类型 (RawFragmentKind)、源范围 (SourceRange) 以及 EditorContent 基础数据结构。
 */

/**
 * 需保真保留的原始语法切片分类
 */
export type RawFragmentKind =
  | "frontmatter"
  | "htmlBlock"
  | "unknownMdxFlow"
  | "unknownMdxText"
  | "mdxEsm"
  | "mdxExpression"
  | "codeFence"
  | "registeredMdxComponent";

/**
 * 文本源范围区间 (左闭右开区间 [start, end))
 */
export interface SourceRange {
  /** 起始字符绝对偏移量 */
  readonly start: number;
  /** 结束字符绝对偏移量 */
  readonly end: number;
}

/**
 * 原始保真语法切片
 */
export interface RawFragment {
  /** 唯一切片标识 */
  readonly id: string;
  /** 切片语法类型 */
  readonly kind: RawFragmentKind;
  /** 提取时的原始文本字面量 */
  readonly rawSource: string;
  /** 源范围区间，若为动态插入的新节点可缺省 */
  readonly sourceRange?: SourceRange;
  /** 脏标记：节点是否已被用户编辑变更 */
  readonly dirty: boolean;
  /** 已变更时的最新序列化 Markdown 文本 */
  readonly serializedMarkdown?: string;
}

/**
 * MDX Callout 提示框组件节点
 */
export interface CalloutNode {
  readonly type: "callout";
  readonly name: "Callout";
  readonly props: Readonly<Record<string, string>>;
  readonly childrenMarkdown: string;
  readonly rawFragmentId?: string;
  readonly dirty: boolean;
}

/**
 * 编辑器结构化节点联合类型
 */
export type EditorNode = CalloutNode | RawFragment;

/**
 * 编辑器内容状态聚合对象
 */
export interface EditorContent {
  /** 当前编辑态的纯文本 */
  readonly rawMarkdown: string;
  /** 上次保存落盘时的纯文本 */
  readonly savedRawMarkdown: string;
  /** 当前捕获的保真切片列表 */
  readonly rawFragments: readonly RawFragment[];
  /** 结构化抽象语法树节点列表 */
  readonly nodes: readonly EditorNode[];
  /** 脏标记 */
  readonly dirty: boolean;
}

/**
 * 编辑器内容序列化产物
 */
export interface EditorSerializeResult {
  readonly rawMarkdown: string;
  readonly rawFragments: readonly RawFragment[];
  readonly dirty: boolean;
  readonly saveAuthority: "rawMarkdown";
}

/**
 * 创建 EditorContent 输入参数
 */
export interface CreateEditorContentInput {
  readonly rawMarkdown: string;
  readonly savedRawMarkdown?: string;
  readonly rawFragments?: readonly RawFragment[];
  readonly nodes?: readonly EditorNode[];
}

/**
 * 计算文档是否处于脏（已修改未保存）状态
 */
export function computeDirtyState(
  content: Pick<EditorContent, "rawMarkdown" | "savedRawMarkdown">,
): boolean {
  return content.rawMarkdown !== content.savedRawMarkdown;
}

/**
 * 创建初始 EditorContent 实例
 */
export function createEditorContent(input: CreateEditorContentInput): EditorContent {
  const savedRawMarkdown = input.savedRawMarkdown ?? input.rawMarkdown;

  return {
    rawMarkdown: input.rawMarkdown,
    savedRawMarkdown,
    rawFragments: input.rawFragments ?? [],
    nodes: input.nodes ?? [],
    dirty: computeDirtyState({ rawMarkdown: input.rawMarkdown, savedRawMarkdown }),
  };
}

/**
 * 更新文本内容并自动派生新脏标记
 */
export function updateRawMarkdown(content: EditorContent, rawMarkdown: string): EditorContent {
  return createEditorContent({
    rawMarkdown,
    savedRawMarkdown: content.savedRawMarkdown,
    rawFragments: content.rawFragments,
    nodes: content.nodes,
  });
}

/**
 * 标记当前内容已成功保存落盘
 */
export function markSaved(content: EditorContent): EditorContent {
  return createEditorContent({
    rawMarkdown: content.rawMarkdown,
    savedRawMarkdown: content.rawMarkdown,
    rawFragments: content.rawFragments,
    nodes: content.nodes,
  });
}

/**
 * 序列化当前内容
 */
export function serializeEditorContent(content: EditorContent): EditorSerializeResult {
  return {
    rawMarkdown: content.rawMarkdown,
    rawFragments: content.rawFragments,
    dirty: computeDirtyState(content),
    saveAuthority: "rawMarkdown",
  };
}

/**
 * 获取用于保存的语法切片文本内容
 *
 * 核心保真原则：
 * 未修改的切片 (dirty === false) 必须严格保留原始字符序列；
 * 仅有被编辑变动的切片允许使用新序列化的 Markdown 文本。
 */
export function getRawFragmentSaveSource(fragment: RawFragment): string {
  if (!fragment.dirty) {
    return fragment.rawSource;
  }

  return fragment.serializedMarkdown ?? fragment.rawSource;
}
