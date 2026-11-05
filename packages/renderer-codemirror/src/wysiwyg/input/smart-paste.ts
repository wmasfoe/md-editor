/**
 * @file smart-paste.ts
 * @description 智能富文本与链接粘贴管线（Smart Paste Pipeline）。
 *
 * 核心职责：
 * 1. 剪贴板富文本识别：当剪贴板携带 `text/html` 时，自动清洗外部噪音并转换为排版标准的 GFM Markdown；
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
 * 抽象剪贴板事件接口
 */
export interface SmartPasteEvent {
  readonly clipboardData: {
    getData(format: string): string;
  } | null;
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

    // 超链接清洗规则：过滤危险协议与追踪 query 参数
    service.addRule("cleanLinks", {
      filter: "a",
      replacement(content, node) {
        const element = node as HTMLAnchorElement;
        const href = element.getAttribute("href");
        if (!href || /^(javascript|vbscript):/i.test(href.trim())) {
          return content;
        }
        const cleanedHref = stripTrackingParams(href);
        const title = element.getAttribute("title");
        const titlePart = title ? ` "${title}"` : "";
        return `[${content}](${cleanedHref}${titlePart})`;
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

  // 4. 富文本 HTML 转换管线（Smart Rich-Text Paste）
  if (rawHtml && rawHtml.trim()) {
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
