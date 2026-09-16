import type {
  HeadingToken,
  ParagraphToken,
  CodeBlockToken,
  BlockquoteToken,
  CalloutToken,
  MathBlockToken,
  TableToken,
  ListToken,
  ListItemToken,
  ThematicBreakToken,
  HtmlBlockToken,
  TextToken,
  BoldToken,
  ItalicToken,
  StrikethroughToken,
  HighlightToken,
  InlineCodeToken,
  MathInlineToken,
  LinkToken,
  ImageToken,
} from "../tokens/types.ts";

/**
 * 开放的自定义渲染接口 (StaticCustomRenderer)
 * 允许调用方拦截或重写任何 Token 节点的 HTML 发射逻辑，实现深度样式和交互定制
 */
export interface StaticCustomRenderer {
  heading?: (token: HeadingToken, next: () => string) => string;
  paragraph?: (token: ParagraphToken, next: () => string) => string;
  codeBlock?: (token: CodeBlockToken, next: () => string) => string;
  blockquote?: (token: BlockquoteToken, next: () => string) => string;
  callout?: (token: CalloutToken, next: () => string) => string;
  mathBlock?: (token: MathBlockToken, next: () => string) => string;
  table?: (token: TableToken, next: () => string) => string;
  list?: (token: ListToken, next: () => string) => string;
  listItem?: (token: ListItemToken, next: () => string) => string;
  thematicBreak?: (token: ThematicBreakToken, next: () => string) => string;
  htmlBlock?: (token: HtmlBlockToken, next: () => string) => string;

  /* Inline hooks */
  text?: (token: TextToken, next: () => string) => string;
  bold?: (token: BoldToken, next: () => string) => string;
  italic?: (token: ItalicToken, next: () => string) => string;
  strikethrough?: (token: StrikethroughToken, next: () => string) => string;
  highlight?: (token: HighlightToken, next: () => string) => string;
  inlineCode?: (token: InlineCodeToken, next: () => string) => string;
  mathInline?: (token: MathInlineToken, next: () => string) => string;
  link?: (token: LinkToken, next: () => string) => string;
  image?: (token: ImageToken, next: () => string) => string;
}
