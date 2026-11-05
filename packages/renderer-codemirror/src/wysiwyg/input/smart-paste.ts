/**
 * @file smart-paste.ts
 * @description 智能富文本与链接粘贴管线（Smart Paste Pipeline）。
 *
 * 核心职责：
 * 1. 剪贴板富文本识别：仅当 `text/html` 含有意义的结构（强调、链接、标题、列表、表格、代码块等）时，
 *    清洗外部噪音并转换为 GFM Markdown。只有 span/div/p/br，或 IDE 语法高亮时，不拦截事件，
 *    交回 CodeMirror 原生 `text/plain` 粘贴，避免缩进被折叠、Markdown 字符被转义；
 * 2. 代码环境保真降级（Bypass）：在围栏代码块（`code-block`）或行内代码（`inline-code`）内粘贴时，
 *    100% 提取 `text/plain` 原样插入，严禁破坏空格、缩进与换行；
 * 3. 强制纯文本模式（Shift+Paste）：`Shift+Cmd+V` 或 `Shift+Ctrl+V` 时，绕过转换，执行原生纯文本粘贴；
 * 4. 智能链接包装（Smart Link）：选中文本粘贴合法 URL 时，自动转换为 `[选中文本](URL)`；
 * 5. 事务与历史栈一致性：粘贴变更注入单步全局撤销历史（`Cmd+Z`），支持安全撤销。
 */

import { syntaxTree } from "@codemirror/language";
import {
  EditorSelection,
  type EditorState,
  Transaction,
  type TransactionSpec,
} from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import type { SyntaxNode } from "@lezer/common";
import TurndownService from "turndown";
// @ts-expect-error -- turndown-plugin-gfm does not ship official TypeScript definitions on npm
import { gfm } from "turndown-plugin-gfm";
import { isAllowedImageSrc, isAllowedLinkProtocol } from "../../markdown/html-whitelist.ts";
import { markdownRangeIndexField } from "../../markdown/range-index.ts";
import { authorizeWysiwygProtectedChange } from "../state/change-authorization.ts";
import { wysiwygProjectionField } from "../state/projection-field.ts";

/**
 * 抽象粘贴视图接口（便于 Node 单元测试与真实 EditorView 双向适配）
 */
export interface SmartPasteView {
  readonly state: EditorState;
  readonly composing?: boolean;
  dispatch(...specs: readonly TransactionSpec[]): void;
}

/**
 * 抽象剪贴板数据。`types` 与浏览器 DataTransfer.types 对齐，用于识别 IDE 自定义 MIME。
 */
export interface SmartPasteClipboardData {
  getData(format: string): string;
  readonly types?: readonly string[];
}

/**
 * 抽象剪贴板事件接口
 */
export interface SmartPasteEvent {
  readonly clipboardData: SmartPasteClipboardData | null;
  readonly shiftKey?: boolean;
  preventDefault(): void;
}

/**
 * 校验是否为合法 URL
 */
export function isValidUrl(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed || /\s/.test(trimmed)) {
    return false;
  }
  // 必须以标准 Web 协议开头
  if (!/^(https?|ftp):\/\/[^\s]+$/i.test(trimmed)) {
    return false;
  }
  try {
    const url = new URL(trimmed);
    return Boolean(url.protocol && url.host);
  } catch {
    return false;
  }
}

/**
 * 剥离常见外部追踪查询参数（如 utm_*, fbclid）
 */
export function stripTrackingParams(url: string): string {
  try {
    const parsed = new URL(url);
    const trackingParams = [
      "utm_source",
      "utm_medium",
      "utm_campaign",
      "utm_term",
      "utm_content",
      "fbclid",
      "gclid",
      "spm_id_from",
    ];
    let changed = false;
    for (const param of trackingParams) {
      if (parsed.searchParams.has(param)) {
        parsed.searchParams.delete(param);
        changed = true;
      }
    }
    return changed ? parsed.toString() : url;
  } catch {
    return url;
  }
}

/**
 * 协议判断前去掉 C0 控制字符，避免 `java\\nscript:` 这类夹杂空白的绕过。
 * 只用于判定，不改写最终写回文档的 URL。
 */
function normalizeUrlForProtocolCheck(value: string): string {
  let normalized = "";
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code <= 0x1f || code === 0x7f) continue;
    normalized += value.charAt(index);
  }
  return normalized.trim();
}

/**
 * 粘贴进 Markdown 源码的链接：复用 HTML 白名单（http/https/mailto 与相对路径）。
 * `javascript:` / `vbscript:` / `data:` / `file:` 以及其余未登记 scheme 一律拒绝。
 */
function isSafePasteLinkHref(href: string): boolean {
  return isAllowedLinkProtocol(normalizeUrlForProtocolCheck(href));
}

/**
 * 粘贴进 Markdown 源码的图片。比 HTML 块白名单更严：`data:`（含 data:image）和 `file:`
 * 都不能进入文档，否则与「危险协议不落盘」的约定不一致，也避免把超大 data URL 写进源码。
 * 相对路径与 http/https/asset 保持放行。
 */
function isSafePasteImageSrc(src: string): boolean {
  const normalized = normalizeUrlForProtocolCheck(src);
  if (/^data:/i.test(normalized)) return false;
  return isAllowedImageSrc(normalized);
}

function escapeMarkdownTitle(title: string): string {
  return title.replace(/\\/g, "\\\\").replace(/"/g, '\\"');
}

/** VS Code / Cursor 编辑器复制会带上这个自定义 MIME，内容是语法高亮 HTML，不是富文本。 */
const IDE_CLIPBOARD_TYPES = ["vscode-editor-data"] as const;

/**
 * 这些标签会改变 Markdown 语义。span/div/p/br/font 只是表现层，不在此列。
 */
const MEANINGFUL_RICH_TAGS = new Set([
  "a",
  "strong",
  "b",
  "em",
  "i",
  "u",
  "s",
  "strike",
  "del",
  "ins",
  "mark",
  "sub",
  "sup",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "ul",
  "ol",
  "li",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "th",
  "td",
  "pre",
  "code",
  "blockquote",
  "img",
  "hr",
  "input",
]);

function clipboardHasType(clipboard: SmartPasteClipboardData, type: string): boolean {
  if (clipboard.types) {
    return clipboard.types.includes(type);
  }
  try {
    return clipboard.getData(type).length > 0;
  } catch {
    return false;
  }
}

function stripClipboardNoise(html: string): string {
  return html
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "");
}

/**
 * Google Docs 用 `<b style="font-weight:normal" id="docs-internal-guid-…">` 包住整段纯文本。
 * 这不是强调，不能据此把整段送进 Turndown。
 */
function isPresentationalBold(attrs: string): boolean {
  return /docs-internal-guid/i.test(attrs) || /font-weight\s*:\s*normal\b/i.test(attrs);
}

/**
 * JetBrains 等 IDE 用 `<pre>` 套一串带颜色的 `<span>` 来保留缩进。
 * 这不是 Markdown 代码块；`<pre><code>` 才是。
 */
function isSyntaxHighlightPre(html: string, innerStart: number): boolean {
  const close = /<\/pre\s*>/i.exec(html.slice(innerStart));
  const inner = close ? html.slice(innerStart, innerStart + close.index) : html.slice(innerStart);
  if (/<code\b/i.test(inner)) return false;
  if (!/<span\b/i.test(inner)) return false;
  for (const match of inner.matchAll(/<([a-zA-Z][\w:-]*)\b/g)) {
    const tag = (match[1] ?? "").toLowerCase();
    if (tag === "span" || tag === "br" || tag === "font" || tag === "wbr") continue;
    return false;
  }
  return true;
}

/**
 * HTML 是否含有必须转成 Markdown 的结构。
 * 只有表现层标签时返回 false，调用方应保留 text/plain。
 */
function htmlHasMeaningfulRichStructure(html: string): boolean {
  const source = stripClipboardNoise(html);
  for (const match of source.matchAll(/<([a-zA-Z][\w:-]*)\b([^>]*)>/g)) {
    const tag = (match[1] ?? "").toLowerCase();
    if (!MEANINGFUL_RICH_TAGS.has(tag)) continue;
    const attrs = match[2] ?? "";
    if ((tag === "b" || tag === "strong") && isPresentationalBold(attrs)) continue;
    const openTagEnd = (match.index ?? 0) + match[0].length;
    if (tag === "pre" && isSyntaxHighlightPre(source, openTagEnd)) continue;
    return true;
  }
  return false;
}

/**
 * 是否应把剪贴板 HTML 转成 Markdown。
 * IDE 自定义 MIME 优先于标签：编辑器复制即使包了 pre/code，也走 text/plain。
 */
export function shouldConvertClipboardHtml(clipboard: SmartPasteClipboardData): boolean {
  if (IDE_CLIPBOARD_TYPES.some((type) => clipboardHasType(clipboard, type))) {
    return false;
  }
  const html = clipboard.getData("text/html");
  if (!html.trim()) return false;
  return htmlHasMeaningfulRichStructure(html);
}

/**
 * 判断指定文档区间是否位于代码环境（代码块 / 行内代码）中。
 * 采用 RangeIndex 与 Lezer SyntaxTree 双重安全检索。
 */
export function isCodeContext(state: EditorState, from: number, to: number): boolean {
  // 1. 优先通过 RangeIndex 高速空间索引匹配
  const rangeIndex = state.field(markdownRangeIndexField, false);
  if (rangeIndex) {
    const overlapping = rangeIndex.overlapping(from, to);
    if (overlapping.some((record) => Boolean(record.codeBlock) || record.kind === "inline-code")) {
      return true;
    }
  }

  // 2. SyntaxTree 兜底语法节点检测
  const tree = syntaxTree(state);
  const node = tree.resolveInner(from, 1);
  let cur: SyntaxNode | null = node;
  while (cur) {
    const name = cur.name;
    if (
      name === "FencedCode" ||
      name === "CodeBlock" ||
      name === "InlineCode" ||
      name === "CodeText" ||
      name === "CodeInfo" ||
      name === "CodeMark"
    ) {
      return true;
    }
    cur = cur.parent;
  }
  return false;
}

function elementChildren(parent: Element): Element[] {
  return Array.from(parent.children);
}

/** 只收集当前表的行，不把嵌套表的行算进来。 */
function tableRows(table: Element): Element[] {
  const rows: Element[] = [];
  const visit = (parent: Element) => {
    for (const child of elementChildren(parent)) {
      const name = child.tagName.toLowerCase();
      if (name === "tr") {
        rows.push(child);
      } else if (name === "thead" || name === "tbody" || name === "tfoot") {
        visit(child);
      }
    }
  };
  visit(table);
  return rows;
}

function tableCells(row: Element): Element[] {
  return elementChildren(row).filter((child) => {
    const name = child.tagName.toLowerCase();
    return name === "td" || name === "th";
  });
}

/**
 * 单元格走 Turndown，把内部强调/链接转成 Markdown，再压成单行。
 * 不使用 outerHTML，因此 style/class/onclick 不会进入文档。
 */
function renderTableCell(cell: Element, service: TurndownService): string {
  const markdown = service
    .turndown(cell.innerHTML)
    .replace(/\s*\n+\s*/g, " ")
    .trim()
    .replace(/\|/g, "\\|");
  if (!/<[a-z!/]/i.test(markdown)) return markdown;
  return markdown.replace(/<\/?[a-z][^>\n]*>/gi, "");
}

/**
 * 任意 HTML 表 → GFM 表。没有 `<th>` 时把第一行当作表头
 * （Excel / Google Sheets / Word 复制出来的表通常如此）。
 */
function renderGfmTable(table: Element, service: TurndownService): string {
  const rendered = tableRows(table).map((row) =>
    tableCells(row).map((cell) => renderTableCell(cell, service)),
  );
  const width = rendered.reduce((max, row) => Math.max(max, row.length), 0);
  if (width === 0) return "";
  const lines = rendered.map((row) => {
    const cells = row.slice();
    while (cells.length < width) cells.push("");
    return `| ${cells.join(" | ")} |`;
  });
  const separator = `| ${Array.from({ length: width }, () => "---").join(" | ")} |`;
  const body = lines.slice(1);
  return `\n\n${lines[0]}\n${separator}${body.length > 0 ? `\n${body.join("\n")}` : ""}\n\n`;
}

let turndownServiceInstance: TurndownService | null = null;

/**
 * 获取或创建单例 Turndown 转换服务
 */
export function getTurndownService(): TurndownService {
  if (!turndownServiceInstance) {
    const service = new TurndownService({
      headingStyle: "atx",
      codeBlockStyle: "fenced",
      emDelimiter: "*",
      strongDelimiter: "**",
      hr: "---",
      bulletListMarker: "-",
    });

    // 启用 GFM 扩展（表格、删除线、任务列表）
    service.use(gfm);

    // 剔除无意义或具有安全隐患的外部标签及其子内容
    service.remove(["script", "style", "meta", "link", "noscript", "iframe"]);

    // 代码块高亮与语言保留强化：识别 <pre><code class="language-xxx">
    service.addRule("fencedCodeBlockWithLang", {
      filter(node) {
        return node.nodeName === "PRE" && Boolean(node.querySelector("code"));
      },
      replacement(_content, node) {
        const element = node as HTMLElement;
        const codeEl = element.querySelector("code");
        const text = codeEl?.textContent ?? element.textContent ?? "";
        const className = codeEl?.getAttribute("class") ?? element.getAttribute("class") ?? "";
        const match = /(?:language|lang)-([a-zA-Z0-9_-]+)/i.exec(className);
        const lang = match ? match[1] : "";
        return `\n\n\`\`\`${lang}\n${text.replace(/\n$/, "")}\n\`\`\`\n\n`;
      },
    });

    // 超链接清洗：危险协议（含 data:/file:）只保留可见文字，并去掉追踪参数。
    service.addRule("cleanLinks", {
      filter: "a",
      replacement(content, node) {
        const element = node as HTMLAnchorElement;
        const href = element.getAttribute("href");
        if (!href || !isSafePasteLinkHref(href)) {
          return content;
        }
        const cleanedHref = stripTrackingParams(href);
        const title = element.getAttribute("title");
        const titlePart = title ? ` "${escapeMarkdownTitle(title)}"` : "";
        return `[${content}](${cleanedHref}${titlePart})`;
      },
    });

    // 图片同样过滤危险协议。Turndown 默认规则会原样写出 img src。
    service.addRule("cleanImages", {
      filter: "img",
      replacement(_content, node) {
        const element = node as HTMLImageElement;
        const src = element.getAttribute("src");
        const alt = element.getAttribute("alt") ?? "";
        if (!src || !isSafePasteImageSrc(src)) {
          return alt;
        }
        const title = element.getAttribute("title");
        const titlePart = title ? ` "${escapeMarkdownTitle(title)}"` : "";
        return `![${alt}](${src}${titlePart})`;
      },
    });

    // 盖过 turndown-plugin-gfm：无表头的表会被它 keep() 成带 style/class 的 outerHTML，MDX 无法编译。
    service.addRule("spreadsheetTable", {
      filter: "table",
      replacement(_content, node) {
        return renderGfmTable(node as HTMLElement, service);
      },
    });

    turndownServiceInstance = service;
  }
  return turndownServiceInstance;
}

/**
 * 将 HTML 字符串转换为规范的 GFM Markdown
 */
export function convertHtmlToMarkdown(html: string): string {
  if (!html || !html.trim()) {
    return "";
  }
  const service = getTurndownService();
  return service.turndown(html).trim();
}

/**
 * 纯业务执行器：处理单次粘贴事件
 */
export function handleSmartPaste(event: SmartPasteEvent, view: SmartPasteView): boolean {
  if (view.composing) {
    return false;
  }

  const { state } = view;
  const projection = state.field(wysiwygProjectionField, false);
  if (projection && projection.compositionGuardRanges.length > 0) {
    return false;
  }

  const clipboardData = event.clipboardData;
  if (!clipboardData) {
    return false;
  }

  const rawHtml = clipboardData.getData("text/html");
  const rawPlain = clipboardData.getData("text/plain");

  // 1. 检查选区是否处于代码环境（代码块 / 行内代码）
  const isInsideCode = state.selection.ranges.some((range) =>
    isCodeContext(state, range.from, range.to),
  );
  if (isInsideCode) {
    // 代码块内绝对保真降级（Bypass）：严禁将 HTML 转换为 Markdown。
    // 若剪贴板中存在纯文本，直接原样插入纯文本，杜绝 HTML 污染与缩进丢失。
    if (rawPlain) {
      event.preventDefault();
      const changes = state.changeByRange((range) => ({
        changes: { from: range.from, to: range.to, insert: rawPlain },
        range: EditorSelection.cursor(range.from + rawPlain.length),
      }));
      view.dispatch(
        state.update({
          ...changes,
          annotations: [
            Transaction.addToHistory.of(true),
            authorizeWysiwygProtectedChange.of(true),
          ],
          userEvent: "input.paste",
        }),
      );
      return true;
    }
    return false;
  }

  // 2. 强制纯文本快捷键（Shift+Cmd+V / Shift+Ctrl+V）
  if (event.shiftKey) {
    return false; // 交回 CM6 原生纯文本粘贴管线
  }

  // 3. 智能链接粘贴扩展（选中文本时粘贴有效 URL，自动转换为 [选中文字](URL)）
  const trimmedPlain = rawPlain.trim();
  const nonRanges = state.selection.ranges.filter((r) => !r.empty);
  if (nonRanges.length > 0 && isValidUrl(trimmedPlain)) {
    // 若选中文本本身已包含未闭合的 markdown 链接语法，则回退常规粘贴
    const isAlreadyLink = nonRanges.some((range) => {
      const text = state.sliceDoc(range.from, range.to);
      return text.startsWith("[") && text.endsWith(")");
    });

    if (!isAlreadyLink) {
      event.preventDefault();
      const spec = state.changeByRange((range) => {
        if (range.empty) {
          return { range };
        }
        const selectedText = state.sliceDoc(range.from, range.to);
        const wrapped = `[${selectedText}](${trimmedPlain})`;
        return {
          changes: { from: range.from, to: range.to, insert: wrapped },
          range: EditorSelection.cursor(range.from + wrapped.length),
        };
      });

      view.dispatch(
        state.update({
          ...spec,
          annotations: [
            Transaction.addToHistory.of(true),
            authorizeWysiwygProtectedChange.of(true),
          ],
          userEvent: "input.paste",
        }),
      );
      return true;
    }
  }

  // 4. 富文本 HTML 转换管线。没有有意义结构时返回 false：
  // CodeMirror 会按 text/plain 粘贴，缩进、换行和 Markdown 字符与改动前一致
  // （含多光标按行分发）。这里不能自己插入 text/plain，否则会改变那条原生路径。
  if (rawHtml.trim() && shouldConvertClipboardHtml(clipboardData)) {
    const convertedMarkdown = convertHtmlToMarkdown(rawHtml);
    if (convertedMarkdown) {
      event.preventDefault();
      const changes = state.changeByRange((range) => ({
        changes: { from: range.from, to: range.to, insert: convertedMarkdown },
        range: EditorSelection.cursor(range.from + convertedMarkdown.length),
      }));
      view.dispatch(
        state.update({
          ...changes,
          annotations: [
            Transaction.addToHistory.of(true),
            authorizeWysiwygProtectedChange.of(true),
          ],
          userEvent: "input.paste",
        }),
      );
      return true;
    }
  }

  return false;
}

/**
 * 智能富文本与链接粘贴扩展：
 * 统一收敛处理 IME 输入、代码块 Bypass、纯文本快捷键、Smart Link 以及富文本转换。
 */
export const smartPasteExtension = EditorView.domEventHandlers({
  paste(event: ClipboardEvent, view: EditorView) {
    return handleSmartPaste(event, view);
  },
});
