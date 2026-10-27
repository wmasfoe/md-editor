import { renderStaticHtml, type StaticRenderResult } from "../index.ts";
import { createStaticDocumentHtml, type StaticDocumentOptions } from "../templates/document.ts";

export interface HtmlExportOptions extends StaticDocumentOptions {
  /**
   * 异步将相对/本地图片 src 转为 Data URL (base64) 的函数。
   * 若返回 null 或抛错，则保留原 src。
   */
  readonly resolveImageDataUrl?: (src: string) => Promise<string | null>;
  /**
   * 异步将 mermaid 图表源码转为 SVG 的函数。
   */
  readonly renderMermaidSvg?: (code: string) => Promise<{ svg: string; error?: string } | null>;
  /**
   * 打印样式覆盖（例如设置 @page { size: A4; margin: 15mm; }）
   */
  readonly printPageCss?: string;
  /**
   * 正文字体族栈
   */
  readonly proseFontFamily?: string;
  /**
   * 代码字体族栈
   */
  readonly codeFontFamily?: string;
  /**
   * 编辑器字号大小 (px)
   */
  readonly fontSize?: number;
}

export interface HtmlExportResult {
  /** 适合单文件传输的自包含 HTML (内联 base64 图片) */
  readonly standaloneHtml: string;
  /** 适合文件夹发布的标准 HTML (保持相对资源引用) */
  readonly linkedHtml: string;
  /** 文档提取的标题 */
  readonly title: string;
}

/**
 * 匹配 HTML 中 img 标签的 src 属性
 */
const IMG_SRC_REGEX = /<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*?)>/gi;

/**
 * 判断是否为不需要转 base64 的网络/协议图片
 */
function isAbsoluteOrDataUrl(src: string): boolean {
  return (
    src.startsWith("http://") ||
    src.startsWith("https://") ||
    src.startsWith("data:") ||
    src.startsWith("blob:")
  );
}

/**
 * 将 HTML 中的相对图片替换为 base64 Data URL
 */
async function inlineImagesInDataUrls(
  html: string,
  resolver?: (src: string) => Promise<string | null>,
): Promise<string> {
  if (!resolver) {
    return html;
  }

  // 收集所有匹配项
  const matches: Array<{ fullMatch: string; prefix: string; src: string; suffix: string }> = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(IMG_SRC_REGEX.source, "gi");

  while ((match = regex.exec(html)) !== null) {
    const [fullMatch, prefix, src, suffix] = match;
    if (src && !isAbsoluteOrDataUrl(src)) {
      matches.push({ fullMatch, prefix: prefix ?? "", src, suffix: suffix ?? "" });
    }
  }

  if (matches.length === 0) {
    return html;
  }

  // 异步获取所有图片的数据
  const replacements = await Promise.all(
    matches.map(async (m) => {
      try {
        const dataUrl = await resolver(m.src);
        return {
          ...m,
          replacement: dataUrl ? `<img${m.prefix}src="${dataUrl}"${m.suffix}>` : m.fullMatch,
        };
      } catch {
        return { ...m, replacement: m.fullMatch };
      }
    }),
  );

  let resultHtml = html;
  for (const { fullMatch, replacement } of replacements) {
    resultHtml = resultHtml.replace(fullMatch, replacement);
  }

  return resultHtml;
}

/**
 * 匹配 HTML 中 mermaid 语法高亮代码块
 */
const MERMAID_BLOCK_REGEX =
  /<pre><code class="[^"]*language-mermaid[^"]*">([\s\S]*?)<\/code><\/pre>/gi;

function unescapeHtmlEntities(escaped: string): string {
  return escaped
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 将 HTML 中的 Mermaid 代码块渲染为矢量 SVG 图表
 */
async function inlineMermaidSvg(
  html: string,
  renderer?: (code: string) => Promise<{ svg: string; error?: string } | null>,
): Promise<string> {
  if (!renderer) {
    return html;
  }

  const matches: Array<{ fullMatch: string; code: string }> = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(MERMAID_BLOCK_REGEX.source, "gi");

  while ((match = regex.exec(html)) !== null) {
    const [fullMatch, rawEscapedCode] = match;
    if (rawEscapedCode) {
      matches.push({ fullMatch, code: unescapeHtmlEntities(rawEscapedCode) });
    }
  }

  if (matches.length === 0) {
    return html;
  }

  const replacements = await Promise.all(
    matches.map(async (m) => {
      try {
        const res = await renderer(m.code);
        if (res && res.svg && res.svg.trim().length > 0) {
          return {
            fullMatch: m.fullMatch,
            replacement: `<div class="cm-md-mermaid-container"><div class="cm-md-mermaid-svg">${res.svg}</div></div>`,
          };
        }
        return { fullMatch: m.fullMatch, replacement: m.fullMatch };
      } catch {
        return { fullMatch: m.fullMatch, replacement: m.fullMatch };
      }
    }),
  );

  let resultHtml = html;
  for (const { fullMatch, replacement } of replacements) {
    resultHtml = resultHtml.replace(fullMatch, replacement);
  }

  return resultHtml;
}

/**
 * 双模 HTML 导出器：
 * 同时生成独立自包含 HTML (standalone) 与标准外链 HTML (linked)。
 */
export async function exportDocumentHtml(
  markdown: string,
  options: HtmlExportOptions = {},
): Promise<HtmlExportResult> {
  const renderOptions = {
    includeMarkers: options.includeMarkers ?? false,
    ...options,
  };
  const rendered = renderStaticHtml(markdown, renderOptions);

  const fontDeclarations: string[] = [];
  const bodyFontRules: string[] = [];
  const monoFontRules: string[] = [];

  if (options.proseFontFamily) {
    fontDeclarations.push(`--theme-font: ${options.proseFontFamily} !important;`);
    bodyFontRules.push(`font-family: var(--theme-font) !important;`);
  }
  if (options.codeFontFamily) {
    fontDeclarations.push(`--theme-mono-font: ${options.codeFontFamily} !important;`);
    monoFontRules.push(`font-family: var(--theme-mono-font) !important;`);
  }
  if (options.fontSize && Number.isFinite(options.fontSize) && options.fontSize > 0) {
    fontDeclarations.push(
      `--theme-editor-font-size: ${options.fontSize}px !important; font-size: ${options.fontSize}px !important;`,
    );
    bodyFontRules.push(`font-size: var(--theme-editor-font-size) !important;`);
  }

  const fontCssParts: string[] = [];
  if (fontDeclarations.length > 0) {
    fontCssParts.push(`:root, body, #content { ${fontDeclarations.join(" ")} }`);
  }
  if (bodyFontRules.length > 0) {
    fontCssParts.push(
      `body, #content, p, li, td, th, blockquote, div, h1, h2, h3, h4, h5, h6 { ${bodyFontRules.join(" ")} }`,
    );
    fontCssParts.push(
      `@media print { body, #content, p, li, td, th, blockquote, div, h1, h2, h3, h4, h5, h6 { ${bodyFontRules.join(" ")} } }`,
    );
  }
  if (monoFontRules.length > 0) {
    fontCssParts.push(
      `code, pre, pre code, .cm-md-inline-code, kbd, samp { ${monoFontRules.join(" ")} }`,
    );
    fontCssParts.push(
      `@media print { code, pre, pre code, .cm-md-inline-code, kbd, samp { ${monoFontRules.join(" ")} } }`,
    );
  }
  const fontCss = fontCssParts.join("\n");

  // options.customCss (主题样式) 位于前，用户指定的 fontCss 位于后，确保显式选择的排版字体优先级最高
  const customCssWithFonts = [options.customCss ?? "", fontCss].filter(Boolean).join("\n");
  const extraCss = options.printPageCss
    ? `${customCssWithFonts}\n@media print { ${options.printPageCss} }`
    : customCssWithFonts;

  // 1. Mermaid 图表转换为矢量 SVG (若提供了 mermaid 渲染器)
  const contentWithMermaid = await inlineMermaidSvg(rendered.html, options.renderMermaidSvg);

  // 2. linkedHtml: 包含 Mermaid 矢量图及原始相对图片
  const linkedRenderResult: StaticRenderResult = {
    ...rendered,
    html: contentWithMermaid,
  };
  const linkedHtml = createStaticDocumentHtml(linkedRenderResult, {
    ...renderOptions,
    customCss: extraCss,
  });

  // 3. standaloneHtml: 内联图片并包装
  const inlinedContentHtml = await inlineImagesInDataUrls(
    contentWithMermaid,
    options.resolveImageDataUrl,
  );
  const standaloneRenderResult: StaticRenderResult = {
    ...rendered,
    html: inlinedContentHtml,
  };
  const standaloneHtml = createStaticDocumentHtml(standaloneRenderResult, {
    ...renderOptions,
    customCss: extraCss,
  });

  return {
    standaloneHtml,
    linkedHtml,
    title: rendered.title,
  };
}

/**
 * 将 Markdown 渲染为适合直接粘贴到富文本编辑器（邮件、飞书、语雀、公众号）的语义片段 HTML
 */
export function renderFragmentHtml(markdown: string, options: StaticDocumentOptions = {}): string {
  const rendered = renderStaticHtml(markdown, {
    includeMarkers: options.includeMarkers ?? false,
    ...options,
  });
  return rendered.html;
}
