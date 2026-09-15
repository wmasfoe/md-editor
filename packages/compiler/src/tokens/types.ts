/**
 * @md-editor/compiler 结构化 Token 定义体系
 * 提供类 AST 的不可变结构化数据流，供自定义渲染器、静态 HTML 发射器或第三方消费
 */

export type TokenType =
  | "heading"
  | "paragraph"
  | "code_block"
  | "blockquote"
  | "callout"
  | "math_block"
  | "table"
  | "list"
  | "list_item"
  | "thematic_break"
  | "html_block"
  | "text"
  | "bold"
  | "italic"
  | "strikethrough"
  | "highlight"
  | "inline_code"
  | "math_inline"
  | "link"
  | "image";

export interface BaseToken {
  type: TokenType;
  raw: string;
}

export interface HeadingToken extends BaseToken {
  type: "heading";
  level: 1 | 2 | 3 | 4 | 5 | 6;
  text: string;
  id: string;
  tokens?: InlineToken[];
}

export interface ParagraphToken extends BaseToken {
  type: "paragraph";
  text: string;
  tokens?: InlineToken[];
}

export interface CodeBlockToken extends BaseToken {
  type: "code_block";
  code: string;
  lang?: string;
  highlighted?: string;
}

export interface BlockquoteToken extends BaseToken {
  type: "blockquote";
  text: string;
  tokens?: StaticToken[];
}

export type CalloutType =
  "note" | "tip" | "important" | "warning" | "danger" | "caution" | "info" | string;

export interface CalloutToken extends BaseToken {
  type: "callout";
  calloutType: CalloutType;
  title: string;
  bodyText: string;
  tokens?: StaticToken[];
}

export interface MathBlockToken extends BaseToken {
  type: "math_block";
  math: string;
  renderedHtml?: string;
}

export interface TableCellToken {
  text: string;
  tokens?: InlineToken[];
  align?: "left" | "center" | "right" | null;
}

export interface TableToken extends BaseToken {
  type: "table";
  header: TableCellToken[];
  rows: TableCellToken[][];
}

export interface ListToken extends BaseToken {
  type: "list";
  ordered: boolean;
  start?: number;
  items: ListItemToken[];
}

export interface ListItemToken extends BaseToken {
  type: "list_item";
  task?: boolean;
  checked?: boolean;
  text: string;
  tokens?: StaticToken[];
}

export interface ThematicBreakToken extends BaseToken {
  type: "thematic_break";
}

export interface HtmlBlockToken extends BaseToken {
  type: "html_block";
  text: string;
}

/* Inline Tokens */

export interface TextToken extends BaseToken {
  type: "text";
  text: string;
}

export interface BoldToken extends BaseToken {
  type: "bold";
  text: string;
  tokens?: InlineToken[];
}

export interface ItalicToken extends BaseToken {
  type: "italic";
  text: string;
  tokens?: InlineToken[];
}

export interface StrikethroughToken extends BaseToken {
  type: "strikethrough";
  text: string;
  tokens?: InlineToken[];
}

export interface HighlightToken extends BaseToken {
  type: "highlight";
  text: string;
  tokens?: InlineToken[];
}

export interface InlineCodeToken extends BaseToken {
  type: "inline_code";
  code: string;
}

export interface MathInlineToken extends BaseToken {
  type: "math_inline";
  math: string;
  renderedHtml?: string;
}

export interface LinkToken extends BaseToken {
  type: "link";
  href: string;
  title?: string;
  text: string;
  tokens?: InlineToken[];
}

export interface ImageToken extends BaseToken {
  type: "image";
  href: string;
  title?: string;
  alt?: string;
}

export type InlineToken =
  | TextToken
  | BoldToken
  | ItalicToken
  | StrikethroughToken
  | HighlightToken
  | InlineCodeToken
  | MathInlineToken
  | LinkToken
  | ImageToken;

export type BlockToken =
  | HeadingToken
  | ParagraphToken
  | CodeBlockToken
  | BlockquoteToken
  | CalloutToken
  | MathBlockToken
  | TableToken
  | ListToken
  | ListItemToken
  | ThematicBreakToken
  | HtmlBlockToken;

export type StaticToken = BlockToken | InlineToken;

export interface CompileResult {
  readonly tokens: StaticToken[];
  readonly title: string;
  readonly frontmatterRaw?: string;
}
