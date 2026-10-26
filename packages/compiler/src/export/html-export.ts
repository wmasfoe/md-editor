import { renderStaticHtml, type StaticRenderResult } from "../index.ts";
import { createStaticDocumentHtml, type StaticDocumentOptions } from "../templates/document.ts";

export interface HtmlExportOptions extends StaticDocumentOptions {
  /**
   * 异步将相对/本地图片 src 转为 Data URL (base64) 的函数。
   * 若返回 null 或抛错，则保留原 src。
   */
  readonly resolveImageDataUrl?: (src: string) => Promise<string | null>;
  /**
   * 打印样式覆盖（例如设置 @page { size: A4; margin: 15mm; }）
   */
  readonly printPageCss?: string;
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
  const extraCss = options.printPageCss
    ? `${options.customCss ?? ""}\n@media print { ${options.printPageCss} }`
    : options.customCss;

  // 1. linkedHtml: 直接使用原始 HTML
  const linkedHtml = createStaticDocumentHtml(rendered, {
    ...renderOptions,
    customCss: extraCss,
  });

  // 2. standaloneHtml: 内联图片并包装
  const inlinedContentHtml = await inlineImagesInDataUrls(
    rendered.html,
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
