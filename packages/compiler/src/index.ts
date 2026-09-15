import {
  tokenizeMarkdown,
  type TokenizeOptions,
  extractDocumentTitle,
  generateHeadingSlug,
} from "./parser/tokenizer.ts";
import { emitHtml, type EmitHtmlOptions } from "./emitter/html-emitter.ts";
import { createStaticDocumentHtml, type StaticDocumentOptions } from "./templates/document.ts";
import type { StaticToken, CompileResult } from "./tokens/types.ts";

export interface StaticRenderOptions extends TokenizeOptions, EmitHtmlOptions {}

export interface StaticRenderResult {
  /** Rendered HTML string */
  readonly html: string;
  /** Extracted document title (from first H1 or provided options) */
  readonly title: string;
  /** Extracted Frontmatter raw content, if present */
  readonly frontmatterRaw?: string;
  /** Structured token tree */
  readonly tokens: readonly StaticToken[];
}

/**
 * 编译 Markdown 为结构化 Token 流（类 AST 树）
 * 供第三方进行语法分析、大模型提取、目录索引或定制处理
 */
export function compileToTokens(markdown: string, options: TokenizeOptions = {}): CompileResult {
  return tokenizeMarkdown(markdown, options);
}

/**
 * 静态 HTML 渲染纯函数（纯 Headless，0 DOM / 0 CM6 依赖）
 * 可在 Node.js、WebKit、JavaScriptCore (macOS QuickLook) 及 Worker 中高性能运行。
 */
export function renderStaticHtml(
  markdown: string,
  options: StaticRenderOptions = {},
): StaticRenderResult {
  if (!markdown.trim()) {
    const title = options.title || "Untitled";
    return {
      html: '<p style="color: var(--theme-muted, #86868b); font-style: italic;">空文档 (Empty document)</p>',
      title,
      frontmatterRaw: undefined,
      tokens: [],
    };
  }

  const compiled = tokenizeMarkdown(markdown, options);
  const html = emitHtml(compiled.tokens, {
    includeMarkers: options.includeMarkers ?? true,
    customRenderer: options.customRenderer,
  });

  return {
    html,
    title: compiled.title,
    frontmatterRaw: compiled.frontmatterRaw,
    tokens: compiled.tokens,
  };
}

/**
 * 将 Markdown 渲染为自包含的独立 HTML 文档（内联 CSS、KaTeX 样式与主题变量）
 * 专供 macOS Finder QuickLook 快速预览、离线导出、打印或无头抓取。
 */
export function renderStaticDocument(
  markdown: string,
  options: StaticDocumentOptions = {},
): string {
  const result = renderStaticHtml(markdown, options);
  return createStaticDocumentHtml(result, options);
}

// 导出 Token 类型体系
export * from "./tokens/types.ts";

// 导出自定义渲染器接口
export type { StaticCustomRenderer } from "./emitter/custom-renderer.ts";

// 导出数学与着色工具
export { renderMathToString, type MathRenderOptions } from "./emitter/math-render.ts";
export { highlightCode, escapeHtml, type HighlightResult } from "./emitter/highlight-code.ts";

// 导出元数据工具
export { CALLOUT_SVG_ICONS, getCalloutSvg, defaultCalloutTitle } from "./data/callout-data.ts";
export {
  SUPPORTED_LANGUAGE_METAS,
  resolveLanguageAlias,
  type LanguageMeta,
} from "./data/language-names.ts";

// 导出样式与辅助函数
export { STATIC_DOCUMENT_BASE_CSS } from "./templates/styles.ts";
export { extractDocumentTitle, generateHeadingSlug };
export type { StaticDocumentOptions, TokenizeOptions, EmitHtmlOptions };
