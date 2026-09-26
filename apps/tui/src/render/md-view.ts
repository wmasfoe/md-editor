/**
 * Markdown 文档视图（第一版：行稳定的「实时预览」渲染）
 *
 * 设计取舍（对应计划里的风险控制）：**不做块级重排**。
 * 一个源码行永远对应一个渲染行，渲染只做两件事：
 *   1) 块级样式（标题/引用/代码围栏/列表）与语法标记淡显；
 *   2) 行内样式（加粗/斜体/行内代码/链接），光标不在该行时隐藏标记（live preview），
 *      光标所在行保持源码可见 —— 这样光标列与源码列严格一致，CJK 光标定位不会错。
 * 块级重排（真 WYSIWYG 隐藏标记改变行数）作为后续演进，需要配套 linenum 映射表。
 *
 * 块上下文按文档版本缓存：TextDocument 每次编辑自增 version，视图据此失效重算。
 */
import type { TextDocument } from "../document/text-document.ts";
import { defaultTheme, type TerminalTheme } from "./theme.ts";

export type BlockContext =
  | { kind: "blank" }
  | { kind: "frontmatter" }
  | { kind: "heading"; level: number }
  | { kind: "quote"; depth: number }
  | { kind: "list"; marker: string; ordered: boolean }
  | { kind: "fence-delimiter"; lang: string | null }
  | { kind: "fence-body"; lang: string | null }
  | { kind: "rule" }
  | { kind: "table" }
  | { kind: "paragraph" };

const HEADING_RE = /^(#{1,6})(\s+)(.*)$/;
const QUOTE_RE = /^(\s*)((?:>\s?)+)(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const RULE_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const FRONTMATTER_RE = /^---\s*$/;
const TABLE_RE = /^\s*\|.*\|\s*$/;

/** 扫描全文，给每一行标注块上下文（行数与源码严格一致） */
export function computeBlockContexts(lines: readonly string[]): BlockContext[] {
  const contexts: BlockContext[] = [];
  let inFence = false;
  let fenceLang: string | null = null;
  let inFrontmatter = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (i === 0 && FRONTMATTER_RE.test(line)) {
      inFrontmatter = true;
      contexts.push({ kind: "frontmatter" });
      continue;
    }
    if (inFrontmatter) {
      contexts.push({ kind: "frontmatter" });
      if (FRONTMATTER_RE.test(line)) inFrontmatter = false;
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      if (!inFence) {
        inFence = true;
        fenceLang = normaliseLang(fence[3]);
        contexts.push({ kind: "fence-delimiter", lang: fenceLang });
      } else {
        inFence = false;
        const closingLang = normaliseLang(fence[3]);
        contexts.push({ kind: "fence-delimiter", lang: closingLang ?? fenceLang });
        fenceLang = null;
      }
      continue;
    }
    if (inFence) {
      contexts.push({ kind: "fence-body", lang: fenceLang });
      continue;
    }

    if (line.trim().length === 0) {
      contexts.push({ kind: "blank" });
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      contexts.push({ kind: "heading", level: heading[1].length });
      continue;
    }
    if (RULE_RE.test(line)) {
      contexts.push({ kind: "rule" });
      continue;
    }
    const quote = QUOTE_RE.exec(line);
    if (quote) {
      contexts.push({ kind: "quote", depth: countQuoteMarkers(quote[2]) });
      continue;
    }
    const list = LIST_RE.exec(line);
    if (list) {
      contexts.push({ kind: "list", marker: list[2], ordered: /\d/.test(list[2]) });
      continue;
    }
    if (TABLE_RE.test(line)) {
      contexts.push({ kind: "table" });
      continue;
    }
    contexts.push({ kind: "paragraph" });
  }
  return contexts;
}

function normaliseLang(info: string): string | null {
  const trimmed = info.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function countQuoteMarkers(markers: string): number {
  let count = 0;
  for (const char of markers) if (char === ">") count++;
  return count;
}

export interface RenderLineOptions {
  /** 光标所在行：显示源码并保留标记（live preview 的「活动行」） */
  active: boolean;
}

export class MdDocumentView {
  private contexts: BlockContext[] | null = null;
  private cachedVersion = -1;

  constructor(
    private readonly doc: TextDocument,
    private readonly theme: TerminalTheme = defaultTheme,
  ) {}

  /** 文档内容变化后调用（也可依赖 version 自动失效） */
  invalidate(): void {
    this.contexts = null;
    this.cachedVersion = -1;
  }

  contextAt(line: number): BlockContext {
    const contexts = this.ensureContexts();
    return contexts[line] ?? { kind: "paragraph" };
  }

  /** 渲染单个源码行；行数与源码一一对应 */
  renderLine(line: number, options: RenderLineOptions): string {
    const text = this.doc.lineText(line);
    const context = this.contextAt(line);
    const hideMarkers = !options.active;
    return this.renderWithContext(text, context, hideMarkers);
  }

  /** 批量渲染（供不需要逐行控制的场景：导出、测试） */
  renderAll(options: (line: number) => RenderLineOptions): string[] {
    const out: string[] = [];
    for (let line = 0; line < this.doc.lineCount; line++) {
      out.push(this.renderLine(line, options(line)));
    }
    return out;
  }

  private renderWithContext(text: string, context: BlockContext, hideMarkers: boolean): string {
    const theme = this.theme;

    switch (context.kind) {
      case "blank":
        return "";
      case "frontmatter":
        return theme.dim(text);
      case "fence-delimiter": {
        const fence = FENCE_RE.exec(text);
        if (!fence) return theme.fence(text);
        const [, indent, ticks, info] = fence;
        return theme.marker(indent) + theme.marker(ticks) + theme.marker(info);
      }
      case "fence-body":
        // 代码块正文：整行按代码样式（后续接 sugar-high 语法高亮）
        return theme.fence(text);
      case "heading": {
        const heading = HEADING_RE.exec(text);
        if (!heading) return text;
        const [, hashes, gap, body] = heading;
        const prefix = hideMarkers ? "" : theme.marker(hashes + gap);
        return prefix + theme.heading(context.level, this.renderInline(body, hideMarkers));
      }
      case "quote": {
        const quote = QUOTE_RE.exec(text);
        if (!quote) return theme.quote(text);
        const [, indent, markers, body] = quote;
        const prefix = hideMarkers
          ? "│ ".repeat(markers.length / 2 || 1)
          : theme.marker(indent + markers);
        return prefix + theme.quote(this.renderInline(body, hideMarkers));
      }
      case "list": {
        const list = LIST_RE.exec(text);
        if (!list) return text;
        const [, indent, marker, gap, body] = list;
        const bulletChar = context.ordered ? marker : "•";
        const prefixContent = `${bulletChar}${gap}`;
        const prefix = hideMarkers
          ? theme.bullet(prefixContent)
          : theme.marker(indent + marker + gap);
        return prefix + this.renderInline(body, hideMarkers);
      }
      case "rule":
        return theme.marker(text);
      case "table":
        return this.renderInline(text, hideMarkers);
      default:
        return this.renderInline(text, hideMarkers);
    }
  }

  /**
   * 行内样式扫描。支持：`code`、**strong**、__strong__、*emphasis*、_emphasis_、
   * ~~strike~~（用 dim 表示）、[text](url)。
   * 第一版不做嵌套解析（`**a *b* c**` 只处理外层），保持行内文本长度在隐藏标记后
   * 与显示内容一一对应；code span 内部不再解析其它标记。
   */
  private renderInline(text: string, hideMarkers: boolean): string {
    if (text.length === 0) return "";
    const theme = this.theme;
    let out = "";
    let i = 0;

    while (i < text.length) {
      // 行内代码：`code`
      if (text[i] === "`") {
        const end = text.indexOf("`", i + 1);
        if (end > i) {
          const body = text.slice(i + 1, end);
          out += hideMarkers
            ? theme.code(body)
            : theme.marker("`") + theme.code(body) + theme.marker("`");
          i = end + 1;
          continue;
        }
      }
      // 链接：[text](url)
      if (text[i] === "[") {
        const close = text.indexOf("](", i + 1);
        if (close > i) {
          const end = text.indexOf(")", close + 2);
          if (end > close) {
            const label = text.slice(i + 1, close);
            const url = text.slice(close + 2, end);
            out += hideMarkers
              ? theme.link(label)
              : theme.marker("[") + theme.link(label) + theme.marker(`](${url})`);
            i = end + 1;
            continue;
          }
        }
      }
      // 加粗：**text** 或 __text__
      const strong = matchDelimited(text, i, ["**", "__"]);
      if (strong) {
        const markers = text.slice(i, i + 2);
        out += hideMarkers
          ? theme.strong(strong.body)
          : theme.marker(markers) + theme.strong(strong.body) + theme.marker(markers);
        i = strong.end;
        continue;
      }
      // 删除线：~~text~~
      if (text.startsWith("~~", i)) {
        const end = text.indexOf("~~", i + 2);
        if (end > i + 2) {
          const body = text.slice(i + 2, end);
          out += hideMarkers
            ? theme.dim(body)
            : theme.marker("~~") + theme.dim(body) + theme.marker("~~");
          i = end + 2;
          continue;
        }
      }
      // 斜体：*text* 或 _text_
      const emphasis = matchDelimited(text, i, ["*", "_"]);
      if (emphasis) {
        const marker = text[i];
        out += hideMarkers
          ? theme.emphasis(emphasis.body)
          : theme.marker(marker) + theme.emphasis(emphasis.body) + theme.marker(marker);
        i = emphasis.end;
        continue;
      }
      out += text[i];
      i++;
    }
    return out;
  }

  private ensureContexts(): BlockContext[] {
    if (this.contexts && this.cachedVersion === this.doc.version) return this.contexts;
    const lines: string[] = [];
    for (let line = 0; line < this.doc.lineCount; line++) lines.push(this.doc.lineText(line));
    this.contexts = computeBlockContexts(lines);
    this.cachedVersion = this.doc.version;
    return this.contexts;
  }
}

/** 从位置 i 起匹配成对分隔符（避免误吃孤立的 * 或 _） */
function matchDelimited(
  text: string,
  i: number,
  delimiters: readonly string[],
): { body: string; end: number } | null {
  for (const delimiter of delimiters) {
    if (!text.startsWith(delimiter, i)) continue;
    const start = i + delimiter.length;
    if (start >= text.length) continue;
    const next = text[start];
    // "*" 后面紧跟空白不是合法的强调起始（例如列表项 "* item"）
    if (next === " " || next === "\t" || next === "\n") continue;
    const end = text.indexOf(delimiter, start);
    if (end <= start) continue;
    if (text[end - 1] === " ") continue;
    return { body: text.slice(start, end), end: end + delimiter.length };
  }
  return null;
}
