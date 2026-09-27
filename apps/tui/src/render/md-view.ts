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
 * 性能模型（2026-09 增补：增量扫描 + 行渲染缓存）：
 *   - 块上下文与「扫描状态」按行缓存（states[i] = 第 i 行之后的围栏/前置元数据状态）；
 *     编辑后只从文档报告的 lastEditLine 起重扫（围栏状态可安全续接），不再全文重扫；
 *   - 行渲染结果按「块上下文 + 是否光标行 + 行内容」做键缓存，未变的行零成本复用。
 * 每次击键的成本 ≈ 变更行 + O(行数) 的查表，与文档规模基本解耦。
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

/** 扫描跨行状态：决定「从第 N 行续扫」是否安全 */
export interface BlockScanState {
  inFence: boolean;
  fenceLang: string | null;
  inFrontmatter: boolean;
}

export const INITIAL_SCAN_STATE: BlockScanState = {
  inFence: false,
  fenceLang: null,
  inFrontmatter: false,
};

const HEADING_RE = /^(#{1,6})(\s+)(.*)$/;
const QUOTE_RE = /^(\s*)((?:>\s?)+)(.*)$/;
const LIST_RE = /^(\s*)([-*+]|\d+[.)])(\s+)(.*)$/;
const FENCE_RE = /^(\s*)(`{3,}|~{3,})(.*)$/;
const RULE_RE = /^\s*(-{3,}|\*{3,}|_{3,})\s*$/;
const FRONTMATTER_RE = /^---\s*$/;
const TABLE_RE = /^\s*\|.*\|\s*$/;

/**
 * 扫描一段行，返回逐行块上下文与「每行之后」的扫描状态。
 * initialState 允许从文档中间续扫（配 states[i-1] 使用）；atDocumentStart 用于
 * 决定是否把首行识别为前置元数据（只有整篇扫描才允许）。
 */
export function scanBlockContexts(
  lines: readonly string[],
  initialState: BlockScanState = INITIAL_SCAN_STATE,
  atDocumentStart = false,
): { contexts: BlockContext[]; states: BlockScanState[] } {
  const contexts: BlockContext[] = [];
  const states: BlockScanState[] = [];
  let state: BlockScanState = { ...initialState };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (state.inFrontmatter) {
      contexts.push({ kind: "frontmatter" });
      if (FRONTMATTER_RE.test(line)) state = { ...state, inFrontmatter: false };
      states.push(state);
      continue;
    }

    if (atDocumentStart && i === 0 && FRONTMATTER_RE.test(line)) {
      state = { ...state, inFrontmatter: true };
      contexts.push({ kind: "frontmatter" });
      states.push(state);
      continue;
    }

    const fence = FENCE_RE.exec(line);
    if (fence) {
      if (!state.inFence) {
        const lang = normaliseLang(fence[3]);
        state = { ...state, inFence: true, fenceLang: lang };
        contexts.push({ kind: "fence-delimiter", lang });
      } else {
        const lang = state.fenceLang;
        state = { ...state, inFence: false, fenceLang: null };
        contexts.push({ kind: "fence-delimiter", lang });
      }
      states.push(state);
      continue;
    }
    if (state.inFence) {
      contexts.push({ kind: "fence-body", lang: state.fenceLang });
      states.push(state);
      continue;
    }

    if (line.trim().length === 0) {
      contexts.push({ kind: "blank" });
      states.push(state);
      continue;
    }
    const heading = HEADING_RE.exec(line);
    if (heading) {
      contexts.push({ kind: "heading", level: heading[1].length });
      states.push(state);
      continue;
    }
    if (RULE_RE.test(line)) {
      contexts.push({ kind: "rule" });
      states.push(state);
      continue;
    }
    const quote = QUOTE_RE.exec(line);
    if (quote) {
      contexts.push({ kind: "quote", depth: countQuoteMarkers(quote[2]) });
      states.push(state);
      continue;
    }
    const list = LIST_RE.exec(line);
    if (list) {
      contexts.push({ kind: "list", marker: list[2], ordered: /\d/.test(list[2]) });
      states.push(state);
      continue;
    }
    if (TABLE_RE.test(line)) {
      contexts.push({ kind: "table" });
      states.push(state);
      continue;
    }
    contexts.push({ kind: "paragraph" });
    states.push(state);
  }
  return { contexts, states };
}

/** 全文扫描（给测试与一次性场景用的兼容入口） */
export function computeBlockContexts(lines: readonly string[]): BlockContext[] {
  return scanBlockContexts(lines, INITIAL_SCAN_STATE, true).contexts;
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

/** 块上下文 → 缓存键组成部分（上下文变了，即使行内容相同也必须重渲） */
function contextKey(context: BlockContext): string {
  switch (context.kind) {
    case "heading":
      return `heading${context.level}`;
    case "fence-delimiter":
    case "fence-body":
      return `${context.kind}:${context.lang ?? ""}`;
    case "list":
      return `list:${context.ordered ? "o" : "u"}`;
    case "quote":
      return `quote${context.depth}`;
    default:
      return context.kind;
  }
}

export interface RenderLineOptions {
  /** 光标所在行：显示源码并保留标记（live preview 的「活动行」） */
  active: boolean;
}

/** 行渲染缓存上限（防超长文档吃内存；到顶直接清空重建） */
const LINE_CACHE_LIMIT = 8000;

export class MdDocumentView {
  private contexts: BlockContext[] = [];
  private states: BlockScanState[] = [];
  private cachedVersion = -1;
  private readonly lineCache = new Map<string, string>();

  constructor(
    private readonly doc: TextDocument,
    private theme: TerminalTheme = defaultTheme,
  ) {}

  /** 动态切换主题并清空渲染缓存 */
  setTheme(theme: TerminalTheme): void {
    this.theme = theme;
    this.invalidate();
  }

  getTheme(): TerminalTheme {
    return this.theme;
  }

  /** 全部失效（主题变更、重新加载文档等） */
  invalidate(): void {
    this.contexts = [];
    this.states = [];
    this.cachedVersion = this.doc.version;
    this.lineCache.clear();
  }

  /** 内容版本变化时从「最早被编辑的行」起增量失效（自动，调用方无需关心） */
  private syncVersion(): void {
    if (this.cachedVersion === this.doc.version) return;
    this.invalidateFrom(this.doc.takeEditFloor());
    this.cachedVersion = this.doc.version;
  }

  /**
   * 编辑后从指定行起失效：该行之前的块上下文、扫描状态与渲染缓存都仍然有效。
   * 传入「编辑起始行」即可；传更靠前的行号也安全（只是多算一点）。
   */
  invalidateFrom(line: number): void {
    const from = Math.max(0, Math.min(line, this.contexts.length));
    this.contexts.length = from;
    this.states.length = from;
  }

  contextAt(line: number): BlockContext {
    this.syncVersion();
    this.ensureContexts();
    return this.contexts[line] ?? { kind: "paragraph" };
  }

  /** 渲染单个源码行；行数与源码一一对应 */
  renderLine(line: number, options: RenderLineOptions): string {
    this.syncVersion();
    this.ensureContexts();
    const text = this.doc.lineText(line);
    const context = this.contexts[line] ?? { kind: "paragraph" };
    const key = `${contextKey(context)}|${options.active ? "a" : "i"}|${text}`;
    const cached = this.lineCache.get(key);
    if (cached !== undefined) return cached;

    const rendered = this.renderWithContext(text, context, !options.active);
    if (this.lineCache.size >= LINE_CACHE_LIMIT) this.lineCache.clear();
    this.lineCache.set(key, rendered);
    return rendered;
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

  /** 按当前文档行数补齐块上下文：只扫描缺失的后半段，围栏状态从缓存续接 */
  private ensureContexts(): void {
    const count = this.doc.lineCount;
    if (this.contexts.length > count) {
      this.contexts.length = count;
      this.states.length = count;
    }
    if (this.contexts.length >= count) return;

    const start = this.contexts.length;
    const fresh: string[] = [];
    for (let line = start; line < count; line++) fresh.push(this.doc.lineText(line));
    const initialState = start === 0 ? INITIAL_SCAN_STATE : this.states[start - 1];
    const scanned = scanBlockContexts(fresh, initialState, start === 0);
    this.contexts.push(...scanned.contexts);
    this.states.push(...scanned.states);
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
