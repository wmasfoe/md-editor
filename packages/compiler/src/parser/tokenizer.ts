import { Marked, type Token, type Tokens } from "marked";
import type {
  BlockToken,
  CompileResult,
  InlineToken,
  ListItemToken,
  StaticToken,
  TableCellToken,
} from "../tokens/types.ts";
import { defaultCalloutTitle } from "../data/callout-data.ts";

/**
 * Extracts first Heading 1 from Markdown as document title
 */
export function extractDocumentTitle(markdown: string): string | null {
  const match = markdown.match(/^#\s+([^\n]+)/m);
  return match ? (match[1]?.trim() ?? null) : null;
}

/**
 * Generates URL-safe heading anchor id
 */
export function generateHeadingSlug(text: string): string {
  const plainText = text.replace(/<[^>]+>/g, "").trim();
  return plainText
    .toLowerCase()
    .replace(/[`*_~[\]()]/g, "")
    .replace(/[^\w\u4e00-\u9fa5]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * Configures a dedicated Marked instance with math, highlight, and directive extensions
 */
function createMarkedLexer(): Marked {
  const marked = new Marked();

  marked.use({
    gfm: true,
    breaks: false,
    extensions: [
      // 1. Math Block: $$ ... $$
      {
        name: "math_block",
        level: "block",
        start(src: string) {
          return src.indexOf("$$");
        },
        tokenizer(src: string) {
          const match = /^\$\$[\r\n]+([\s\S]*?)[\r\n]+\$\$/.exec(src);
          if (match) {
            return {
              type: "math_block",
              raw: match[0],
              text: match[1].trim(),
            };
          }
          return undefined;
        },
      },
      // 2. Math Inline: $...$
      {
        name: "math_inline",
        level: "inline",
        start(src: string) {
          return src.indexOf("$");
        },
        tokenizer(src: string) {
          const match = /^\$([^$\r\n]+?)\$/.exec(src);
          if (match && !/^\s/.test(match[1]) && !/\s$/.test(match[1])) {
            return {
              type: "math_inline",
              raw: match[0],
              text: match[1],
            };
          }
          return undefined;
        },
      },
      // 3. Highlight: ==...==
      {
        name: "highlight",
        level: "inline",
        start(src: string) {
          return src.indexOf("==");
        },
        tokenizer(src: string) {
          const match = /^==((?:[^\s=]|(?:\s+[^\s=]))*?)==/.exec(src);
          if (match && match[1]) {
            return {
              type: "highlight",
              raw: match[0],
              text: match[1],
              tokens: this.lexer.inlineTokens(match[1]),
            };
          }
          return undefined;
        },
      },
      // 4. Container Directive: :::tip [optional title] ... :::
      {
        name: "directive_container",
        level: "block",
        start(src: string) {
          return src.indexOf(":::");
        },
        tokenizer(src: string) {
          const match = /^:::([a-zA-Z0-9_-]+)(?:[ \t]+([^\r\n]+))?[\r\n]+([\s\S]*?)[\r\n]+:::/.exec(
            src,
          );
          if (match) {
            const directiveType = match[1].toLowerCase();
            const customTitle = (match[2] || "").trim();
            const body = match[3] || "";
            return {
              type: "directive_container",
              raw: match[0],
              directiveType,
              title: customTitle,
              body,
              tokens: this.lexer.blockTokens(body),
            };
          }
          return undefined;
        },
      },
    ],
  });

  return marked;
}

const markedLexer = createMarkedLexer();

/**
 * Converts Marked inline tokens to StaticToken[]
 */
function convertInlineTokens(tokens?: Token[]): InlineToken[] | undefined {
  if (!tokens || tokens.length === 0) return undefined;

  const result: InlineToken[] = [];

  for (const t of tokens) {
    switch (t.type) {
      case "text":
        result.push({
          type: "text",
          raw: t.raw,
          text: (t as Tokens.Text).text,
        });
        break;
      case "strong":
        result.push({
          type: "bold",
          raw: t.raw,
          text: (t as Tokens.Strong).text,
          tokens: convertInlineTokens((t as Tokens.Strong).tokens),
        });
        break;
      case "em":
        result.push({
          type: "italic",
          raw: t.raw,
          text: (t as Tokens.Em).text,
          tokens: convertInlineTokens((t as Tokens.Em).tokens),
        });
        break;
      case "del":
        result.push({
          type: "strikethrough",
          raw: t.raw,
          text: (t as Tokens.Del).text,
          tokens: convertInlineTokens((t as Tokens.Del).tokens),
        });
        break;
      case "highlight": {
        const hToken = t as Token & { text: string; tokens?: Token[] };
        result.push({
          type: "highlight",
          raw: hToken.raw,
          text: hToken.text,
          tokens: convertInlineTokens(hToken.tokens),
        });
        break;
      }
      case "codespan":
        result.push({
          type: "inline_code",
          raw: t.raw,
          code: (t as Tokens.Codespan).text,
        });
        break;
      case "math_inline": {
        const mToken = t as Token & { text: string };
        result.push({
          type: "math_inline",
          raw: mToken.raw,
          math: mToken.text,
        });
        break;
      }
      case "link": {
        const link = t as Tokens.Link;
        result.push({
          type: "link",
          raw: link.raw,
          href: link.href,
          title: link.title ?? undefined,
          text: link.text,
          tokens: convertInlineTokens(link.tokens),
        });
        break;
      }
      case "image": {
        const img = t as Tokens.Image;
        result.push({
          type: "image",
          raw: img.raw,
          href: img.href,
          title: img.title ?? undefined,
          alt: img.text,
        });
        break;
      }
      case "escape":
      default:
        result.push({
          type: "text",
          raw: t.raw,
          text: (t as { text?: string }).text ?? t.raw,
        });
        break;
    }
  }

  return result;
}

/**
 * Converts Marked list item tokens to StaticToken[]
 */
function convertListItemTokens(tokens: Token[], loose?: boolean): StaticToken[] {
  const result: StaticToken[] = [];

  for (const t of tokens) {
    // 1. 任务列表复选框标记符：已由 ListItemToken 的 task/checked 属性全权托管，此处跳过以避免被降级为额外段落文本
    if (t.type === "checkbox") {
      continue;
    }
    // 2. 纯空白节点跳过
    if (t.type === "space") {
      continue;
    }
    // 3. 紧凑列表文本行：marked 在紧凑模式下会将行内标记包装于 Tokens.Text 中
    if (t.type === "text") {
      const txt = t as Tokens.Text;
      const inlines = convertInlineTokens(txt.tokens);
      if (inlines && inlines.length > 0) {
        result.push(...inlines);
      } else {
        result.push({
          type: "text",
          raw: txt.raw,
          text: txt.text,
        });
      }
      continue;
    }
    // 4. 其他块级节点（如 paragraph, list, code, blockquote, table 等）走常规块转换
    const blocks = convertBlockTokens([t]);
    // 若当前列表项为紧凑模式且块仅为单个普通段落，将其展开为纯内联 token，防止在 <li> 中产生多余 <p> 标签引发换行和边距
    if (!loose && blocks.length === 1 && blocks[0].type === "paragraph") {
      const p = blocks[0];
      if (p.tokens && p.tokens.length > 0) {
        result.push(...p.tokens);
      } else {
        result.push({
          type: "text",
          raw: p.raw,
          text: p.text,
        });
      }
    } else {
      result.push(...blocks);
    }
  }

  return result;
}

/**
 * Converts Marked block tokens to StaticToken[]
 */
function convertBlockTokens(tokens: Token[]): BlockToken[] {
  const result: BlockToken[] = [];

  for (const t of tokens) {
    switch (t.type) {
      case "heading": {
        const h = t as Tokens.Heading;
        const plain = h.text.replace(/<[^>]+>/g, "").trim();
        result.push({
          type: "heading",
          raw: h.raw,
          level: h.depth as 1 | 2 | 3 | 4 | 5 | 6,
          text: h.text,
          id: generateHeadingSlug(plain),
          tokens: convertInlineTokens(h.tokens),
        });
        break;
      }
      case "paragraph": {
        const p = t as Tokens.Paragraph;
        result.push({
          type: "paragraph",
          raw: p.raw,
          text: p.text,
          tokens: convertInlineTokens(p.tokens),
        });
        break;
      }
      case "code": {
        const c = t as Tokens.Code;
        result.push({
          type: "code_block",
          raw: c.raw,
          code: c.text,
          lang: c.lang || undefined,
        });
        break;
      }
      case "blockquote": {
        const bq = t as Tokens.Blockquote;
        const trimmed = bq.text.trim();
        const calloutMatch = trimmed.match(
          /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|DANGER)\](?:[ \t]+([^\r\n]+))?(?:\r?\n([\s\S]*))?$/i,
        );
        if (calloutMatch) {
          const rawType = calloutMatch[1]?.toLowerCase() ?? "info";
          const customTitle = calloutMatch[2]?.trim();
          const title = customTitle || defaultCalloutTitle(rawType);
          const bodyText = (calloutMatch[3] ?? "").trim();
          const innerTokens = bodyText ? markedLexer.lexer(bodyText) : [];

          result.push({
            type: "callout",
            raw: bq.raw,
            calloutType: rawType,
            title,
            bodyText,
            tokens: convertBlockTokens(innerTokens),
          });
        } else {
          result.push({
            type: "blockquote",
            raw: bq.raw,
            text: bq.text,
            tokens: bq.tokens ? convertBlockTokens(bq.tokens) : undefined,
          });
        }
        break;
      }
      case "directive_container": {
        const dc = t as Token & {
          directiveType: string;
          title: string;
          body: string;
          tokens?: Token[];
        };
        const title = dc.title || defaultCalloutTitle(dc.directiveType);
        result.push({
          type: "callout",
          raw: dc.raw,
          calloutType: dc.directiveType,
          title,
          bodyText: dc.body,
          tokens: dc.tokens ? convertBlockTokens(dc.tokens) : undefined,
        });
        break;
      }
      case "math_block": {
        const mb = t as Token & { text: string };
        result.push({
          type: "math_block",
          raw: mb.raw,
          math: mb.text,
        });
        break;
      }
      case "table": {
        const tb = t as Tokens.Table;
        const header: TableCellToken[] = tb.header.map((cell) => ({
          text: cell.text,
          tokens: convertInlineTokens(cell.tokens),
          align: tb.align[headerAlignIndex(tb, cell)] ?? null,
        }));
        const rows: TableCellToken[][] = tb.rows.map((row) =>
          row.map((cell, colIdx) => ({
            text: cell.text,
            tokens: convertInlineTokens(cell.tokens),
            align: tb.align[colIdx] ?? null,
          })),
        );
        result.push({
          type: "table",
          raw: tb.raw,
          header,
          rows,
        });
        break;
      }
      case "list": {
        const lst = t as Tokens.List;
        const items: ListItemToken[] = lst.items.map((item) => ({
          type: "list_item",
          raw: item.raw,
          task: item.task,
          checked: item.checked,
          loose: item.loose,
          text: item.text,
          tokens: item.tokens ? convertListItemTokens(item.tokens, item.loose) : undefined,
        }));
        result.push({
          type: "list",
          raw: lst.raw,
          ordered: lst.ordered,
          start: lst.start ? Number(lst.start) : undefined,
          items,
        });
        break;
      }
      case "hr":
        result.push({
          type: "thematic_break",
          raw: t.raw,
        });
        break;
      case "html":
        result.push({
          type: "html_block",
          raw: t.raw,
          text: (t as Tokens.HTML).text,
        });
        break;
      case "space":
        // Skip purely whitespace spacing tokens in AST output
        break;
      default:
        result.push({
          type: "paragraph",
          raw: t.raw,
          text: (t as { text?: string }).text ?? t.raw,
        });
        break;
    }
  }

  return result;
}

function headerAlignIndex(table: Tokens.Table, cell: Tokens.TableCell): number {
  return table.header.indexOf(cell);
}

export interface TokenizeOptions {
  /** Document title override */
  title?: string;
  /** Max bytes to process before truncating (default: 2MB) */
  maxBytes?: number;
}

/**
 * Parses Markdown source into structured tokens (AST), extracting frontmatter and title.
 */
export function tokenizeMarkdown(markdown: string, options: TokenizeOptions = {}): CompileResult {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024;
  let content = markdown;
  let isTruncated = false;

  if (typeof TextEncoder !== "undefined" && typeof TextDecoder !== "undefined") {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    if (bytes.length > maxBytes) {
      const truncatedBytes = bytes.slice(0, maxBytes);
      content = new TextDecoder("utf-8", { fatal: false }).decode(truncatedBytes);
      isTruncated = true;
    }
  } else if (content.length > maxBytes) {
    content = content.slice(0, maxBytes);
    isTruncated = true;
  }

  // Extract frontmatter if present
  let frontmatterRaw: string | undefined;
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fmMatch) {
    frontmatterRaw = fmMatch[1];
    content = content.slice(fmMatch[0].length);
  }

  if (isTruncated) {
    content +=
      "\n\n---\n\n> ⚠️ *文档体积较大（超过 2MB），仅展示前 2MB 内容。完整编辑与查阅请在 Inkpoint 中打开。*";
  }

  const title = options.title || extractDocumentTitle(content) || "Untitled";

  if (!content.trim()) {
    return {
      tokens: [],
      title,
      frontmatterRaw,
    };
  }

  const markedTokens = markedLexer.lexer(content);
  const staticTokens = convertBlockTokens(markedTokens);

  return {
    tokens: staticTokens,
    title,
    frontmatterRaw,
  };
}
