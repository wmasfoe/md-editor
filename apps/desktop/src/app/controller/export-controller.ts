import { invoke, isTauri } from "@tauri-apps/api/core";
import type { ColorSchemeOverrides, EditorUiActionsContextValue } from "@md-editor/app-ui";
import { compileThemeCss, resolveCodeFontStack, resolveProseFontStack } from "@md-editor/app-ui";
import { validateMarkdownRelativeLinks } from "@md-editor/file-system";
import type { LinkDiagnosticItem } from "@md-editor/editor";
import { resolvePreviewImageSrc } from "../../lib/markdown-preview";
import { type AppSettings, resolveThemeColorScheme } from "../settings";

export interface ExportDocumentStylingOptions {
  readonly proseFontFamily?: string;
  readonly codeFontFamily?: string;
  readonly fontSize?: number;
  readonly themeCss?: string;
  readonly isDark?: boolean;
}

export interface ExportPdfOptions extends ExportDocumentStylingOptions {
  readonly pageSize?: "A4" | "Letter";
  readonly orientation?: "portrait" | "landscape";
  readonly margin?: string;
}

/**
 * 从全局设置中提取导出排版样式（字体、字号、主题变量与色彩方案）
 */
export function resolveExportStyling(settings: AppSettings): ExportDocumentStylingOptions {
  const scheme = resolveThemeColorScheme(settings.theme.mode);
  const themeScheme = scheme === "dark" ? settings.theme.dark : settings.theme.light;
  const themeCss = compileThemeCss({
    baseTheme: themeScheme.builtinTheme,
    colorScheme: scheme === "dark" ? "dark" : "light",
    customCssText: (themeScheme as { readonly customCss?: string }).customCss,
    lightOverrides: settings.theme.light as unknown as ColorSchemeOverrides,
    darkOverrides: settings.theme.dark as unknown as ColorSchemeOverrides,
  });
  const rawProseFont = resolveProseFontStack(settings.editor.proseFontFamily);
  const rawCodeFont = resolveCodeFontStack(settings.editor.codeFontFamily);
  // 未显式选择覆盖字体时保持 undefined，完整继承主题自身的默认字体（如 Kami 衬线或宣纸文楷）
  const proseFontFamily = rawProseFont || undefined;
  const codeFontFamily = rawCodeFont || undefined;
  const fontSize = settings.editor.wysiwygFontSize || 16;
  const isDark = scheme === "dark";

  return {
    proseFontFamily,
    codeFontFamily,
    fontSize,
    themeCss,
    isDark,
  };
}

/**
 * 尝试动态加载 syntax-plugins 的 Mermaid 矢量渲染器
 */
async function resolveMermaidRenderer(
  isDark = false,
): Promise<((code: string) => Promise<{ svg: string; error?: string } | null>) | undefined> {
  try {
    const { renderMermaidSvg } = await import("@md-editor/syntax-plugins");
    return (code: string) => renderMermaidSvg(code, isDark);
  } catch {
    return undefined;
  }
}

/**
 * 匹配 HTML 中 mermaid 语法高亮代码块。
 *
 * 与 `@md-editor/compiler` 的 `MERMAID_BLOCK_REGEX` 保持一致：Rust 渲染器按契约
 * 只输出 `<pre><code class="…language-mermaid…">`，SVG 替换在宿主侧完成。
 */
const MERMAID_BLOCK_REGEX =
  /<pre><code class="[^"]*language-mermaid[^"]*">([\s\S]*?)<\/code><\/pre>/gi;

/** 还原 HTML 实体，得到 mermaid 源码。 */
function unescapeHtmlEntities(escaped: string): string {
  return escaped
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

/**
 * 把 HTML 里的 mermaid 代码块替换为矢量 SVG。
 *
 * 这是「mermaid 契约（方式 a）」的宿主侧实现：Rust 渲染核心不感知 mermaid，
 * 只输出代码块；图表渲染留在 JS（依赖 mermaid.js 与 DOM）。
 */
async function inlineMermaidSvg(
  html: string,
  renderer?: (code: string) => Promise<{ svg: string; error?: string } | null>,
): Promise<string> {
  if (!renderer) {
    return html;
  }

  const matches: Array<{ fullMatch: string; code: string }> = [];
  const regex = new RegExp(MERMAID_BLOCK_REGEX.source, "gi");
  let match: RegExpExecArray | null;

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
    matches.map(async (item) => {
      try {
        const res = await renderer(item.code);
        if (res && res.svg && res.svg.trim().length > 0) {
          return {
            fullMatch: item.fullMatch,
            replacement: `<div class="cm-md-mermaid-container"><div class="cm-md-mermaid-svg">${res.svg}</div></div>`,
          };
        }
        return { fullMatch: item.fullMatch, replacement: item.fullMatch };
      } catch {
        return { fullMatch: item.fullMatch, replacement: item.fullMatch };
      }
    }),
  );

  let resultHtml = html;
  for (const { fullMatch, replacement } of replacements) {
    resultHtml = resultHtml.replace(fullMatch, replacement);
  }
  return resultHtml;
}

/** 拼装导出用的字体覆盖 CSS（与 `@md-editor/compiler` 的 html-export 保持一致）。 */
function buildFontCss(styling: ExportDocumentStylingOptions): string {
  const fontDeclarations: string[] = [];
  const bodyFontRules: string[] = [];
  const monoFontRules: string[] = [];

  if (styling.proseFontFamily) {
    fontDeclarations.push(`--theme-font: ${styling.proseFontFamily} !important;`);
    bodyFontRules.push(`font-family: var(--theme-font) !important;`);
  }
  if (styling.codeFontFamily) {
    fontDeclarations.push(`--theme-mono-font: ${styling.codeFontFamily} !important;`);
    monoFontRules.push(`font-family: var(--theme-mono-font) !important;`);
  }
  if (styling.fontSize && Number.isFinite(styling.fontSize) && styling.fontSize > 0) {
    fontDeclarations.push(
      `--theme-editor-font-size: ${styling.fontSize}px !important; font-size: ${styling.fontSize}px !important;`,
    );
    bodyFontRules.push(`font-size: var(--theme-editor-font-size) !important;`);
  }

  const parts: string[] = [];
  if (fontDeclarations.length > 0) {
    parts.push(`:root, body, #content { ${fontDeclarations.join(" ")} }`);
  }
  if (bodyFontRules.length > 0) {
    parts.push(
      `body, #content, p, li, td, th, blockquote, div, h1, h2, h3, h4, h5, h6 { ${bodyFontRules.join(" ")} }`,
    );
    parts.push(
      `@media print { body, #content, p, li, td, th, blockquote, div, h1, h2, h3, h4, h5, h6 { ${bodyFontRules.join(" ")} } }`,
    );
  }
  if (monoFontRules.length > 0) {
    parts.push(`code, pre, pre code, .cm-md-inline-code, kbd, samp { ${monoFontRules.join(" ")} }`);
    parts.push(
      `@media print { code, pre, pre code, .cm-md-inline-code, kbd, samp { ${monoFontRules.join(" ")} } }`,
    );
  }
  return parts.join("\n");
}

/**
 * 用 Rust 渲染核心产出 HTML 片段，并完成宿主侧后处理。
 *
 * 分工边界：
 * - Rust：Markdown → HTML（含标题 ID、callout、highlight、代码高亮、数学公式）
 * - 宿主（此处）：mermaid → SVG、图片 → Data URL、字体/打印 CSS 拼装、文档包装
 */
async function renderDocumentHtmlWithRust(
  markdown: string,
  styling: ExportDocumentStylingOptions,
  options: {
    readonly printPageCss?: string;
    readonly resolveImageDataUrl?: (src: string) => Promise<string | null>;
    readonly renderMermaidSvg?: (code: string) => Promise<{ svg: string; error?: string } | null>;
  } = {},
): Promise<{ standaloneHtml: string; linkedHtml: string; title: string }> {
  const fragment = await invoke<string>("render_markdown_fragment", {
    markdown,
    includeMarkers: false,
  });

  const fontCss = buildFontCss(styling);
  const baseCss = [styling.themeCss ?? "", fontCss].filter(Boolean).join("\n");
  const customCss = options.printPageCss
    ? `${baseCss}\n@media print { ${options.printPageCss} }`
    : baseCss;

  const withMermaid = await inlineMermaidSvg(fragment, options.renderMermaidSvg);

  const renderDocument = (contentHtml: string) =>
    invoke<string>("render_markdown_document_from_fragment", {
      fragment: contentHtml,
      customCss,
    });

  // linked：保留原始相对图片路径
  const linkedHtml = await renderDocument(withMermaid);

  // standalone：图片内联为 Data URL
  const inlinedContent = await inlineImagesInDataUrls(withMermaid, options.resolveImageDataUrl);
  const standaloneHtml = await renderDocument(inlinedContent);

  const title = extractDocumentTitle(markdown);
  return { standaloneHtml, linkedHtml, title };
}

/**
 * 从 Markdown 提取文档标题（第一个 H1），用于导出文件命名。
 */
function extractDocumentTitle(markdown: string): string {
  const match = /^#\s+([^\n]+)/m.exec(markdown);
  return match?.[1]?.trim() || "Untitled";
}

/**
 * 将 HTML 中的相对图片替换为 base64 Data URL。
 *
 * 与 `@md-editor/compiler` 的 `inlineImagesInDataUrls` 语义一致。
 */
async function inlineImagesInDataUrls(
  html: string,
  resolver?: (src: string) => Promise<string | null>,
): Promise<string> {
  if (!resolver) {
    return html;
  }

  const IMG_SRC_REGEX = /<img\b([^>]*?)\bsrc=["']([^"']+)["']([^>]*?)>/gi;
  const matches: Array<{ fullMatch: string; src: string }> = [];
  let match: RegExpExecArray | null;
  const regex = new RegExp(IMG_SRC_REGEX.source, "gi");

  while ((match = regex.exec(html)) !== null) {
    const [fullMatch, , src] = match;
    if (!src) continue;
    if (/^(https?:|data:|blob:)/i.test(src)) continue;
    matches.push({ fullMatch, src });
  }

  if (matches.length === 0) {
    return html;
  }

  const replacements = await Promise.all(
    matches.map(async (item) => {
      try {
        const dataUrl = await resolver(item.src);
        if (!dataUrl) return { fullMatch: item.fullMatch, replacement: item.fullMatch };
        return {
          fullMatch: item.fullMatch,
          replacement: item.fullMatch.replace(item.src, dataUrl),
        };
      } catch {
        return { fullMatch: item.fullMatch, replacement: item.fullMatch };
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
 * 将指定相对图片路径转为 Base64 Data URL
 */
async function resolveImageAsBase64(
  documentPath: string | null,
  src: string,
): Promise<string | null> {
  if (src.startsWith("data:") || src.startsWith("http://") || src.startsWith("https://")) {
    return src;
  }

  try {
    const resolvedUrl = resolvePreviewImageSrc(documentPath, src);
    const response = await fetch(resolvedUrl);
    if (!response.ok) return null;
    const blob = await response.blob();
    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.addEventListener("loadend", () => {
        resolve(typeof reader.result === "string" ? reader.result : null);
      });
      reader.addEventListener("error", () => resolve(null));
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/**
 * 复制语义富文本 HTML 到系统剪贴板（兼容各类富文本编辑器与邮件客户端）
 */
export async function copyDocumentAsHtml(
  markdown: string,
  styling: ExportDocumentStylingOptions = {},
): Promise<boolean> {
  const mermaidRenderer = await resolveMermaidRenderer(styling.isDark ?? false);
  const rawFragment = await invoke<string>("render_markdown_fragment", {
    markdown,
    includeMarkers: false,
  });
  const fragment = await inlineMermaidSvg(rawFragment, mermaidRenderer);
  if (typeof navigator !== "undefined" && navigator.clipboard) {
    try {
      if (typeof ClipboardItem !== "undefined") {
        const textBlob = new Blob([markdown], { type: "text/plain" });
        const htmlBlob = new Blob([fragment], { type: "text/html" });
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/plain": textBlob,
            "text/html": htmlBlob,
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(fragment);
      }
      return true;
    } catch {
      return false;
    }
  }
  return false;
}

/**
 * 导出单一独立 HTML 文件（内联样式、公式、Mermaid 矢量图与图片资源）
 */
export async function exportDocumentAsHtml(
  documentPath: string | null,
  markdown: string,
  styling: ExportDocumentStylingOptions = {},
): Promise<{ success: boolean; filePath?: string; message?: string }> {
  try {
    const mermaidRenderer = await resolveMermaidRenderer(styling.isDark ?? false);
    const exportResult = await renderDocumentHtmlWithRust(markdown, styling, {
      resolveImageDataUrl: (src: string) => resolveImageAsBase64(documentPath, src),
      renderMermaidSvg: mermaidRenderer,
    });

    const baseName = documentPath
      ? (documentPath
          .split(/[/\\]/)
          .pop()
          ?.replace(/\.[^/.]+$/, "") ?? "document")
      : exportResult.title || "document";
    const defaultFilename = `${baseName}.html`;

    if (isTauri()) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const selected = await save({
        defaultPath: defaultFilename,
        filters: [{ name: "HTML 文档", extensions: ["html", "htm"] }],
        title: "导出 HTML 文档",
      });

      if (!selected || typeof selected !== "string") {
        return { success: false, message: "已取消导出" };
      }

      const dirIndex = Math.max(selected.lastIndexOf("/"), selected.lastIndexOf("\\"));
      const directory = dirIndex >= 0 ? selected.slice(0, dirIndex) : "";
      const fileName = dirIndex >= 0 ? selected.slice(dirIndex + 1) : selected;

      await invoke("write_exported_files", {
        directory,
        files: {
          [fileName]: exportResult.standaloneHtml,
        },
      });

      return { success: true, filePath: selected };
    }

    // Web 浏览器环境直接下载单个独立的 HTML 文件
    if (typeof document !== "undefined") {
      const blob = new Blob([exportResult.standaloneHtml], { type: "text/html;charset=utf-8" });
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = defaultFilename;
      link.click();
      URL.revokeObjectURL(url);
    }
    return { success: true };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message };
  }
}

/**
 * 导出 PDF 文档（调起原生保存对话框并完成精确矢量排版落盘）
 */
export async function exportDocumentAsPdf(
  documentPath: string | null,
  markdown: string,
  options: ExportPdfOptions = {},
): Promise<{ success: boolean; filePath?: string; message?: string }> {
  try {
    const pageSize = options.pageSize ?? "A4";
    const orientation = options.orientation ?? "portrait";
    const margin = options.margin ?? "15mm 20mm";

    const printPageCss = `@page { size: ${pageSize} ${orientation}; margin: ${margin}; }`;
    const mermaidRenderer = await resolveMermaidRenderer(options.isDark ?? false);
    const exportResult = await renderDocumentHtmlWithRust(markdown, options, {
      printPageCss,
      resolveImageDataUrl: (src: string) => resolveImageAsBase64(documentPath, src),
      renderMermaidSvg: mermaidRenderer,
    });

    const baseName = documentPath
      ? (documentPath
          .split(/[/\\]/)
          .pop()
          ?.replace(/\.[^/.]+$/, "") ?? "document")
      : exportResult.title || "document";
    const defaultFilename = `${baseName}.pdf`;

    if (isTauri()) {
      const { save } = await import("@tauri-apps/plugin-dialog");
      const selected = await save({
        defaultPath: defaultFilename,
        filters: [{ name: "PDF 文档", extensions: ["pdf"] }],
        title: "导出 PDF 文档",
      });

      if (!selected || typeof selected !== "string") {
        return { success: false, message: "已取消导出" };
      }

      try {
        await invoke("export_html_to_pdf", {
          html: exportResult.standaloneHtml,
          outputPath: selected,
          pageSize,
          orientation,
        });

        return { success: true, filePath: selected };
      } catch (backendError) {
        // 若底层直接落盘遇到系统环境阻碍，平滑降级调起系统打印/另存为 PDF 窗口，保障用户随时可用
        const printOk = await triggerPrintFallback(exportResult.standaloneHtml);
        if (printOk) {
          return {
            success: true,
            filePath: undefined,
            message: "已调起系统打印面板（可选择“另存为 PDF”）",
          };
        }
        throw backendError;
      }
    }

    // Web 浏览器环境通过 iframe 调起浏览器打印（支持“另存为 PDF”）
    const ok = await triggerPrintFallback(exportResult.standaloneHtml);
    return { success: ok };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { success: false, message };
  }
}

function triggerPrintFallback(html: string): Promise<boolean> {
  if (typeof document === "undefined") return Promise.resolve(false);
  const iframe = document.createElement("iframe");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "100%";
  iframe.style.height = "100%";
  iframe.style.opacity = "0";
  iframe.style.pointerEvents = "none";
  iframe.style.zIndex = "-1";
  iframe.srcdoc = html;

  document.body.appendChild(iframe);

  // 在无真实打印窗口的测试/无头环境下直接完成清理并返回
  if (!iframe.contentWindow || typeof iframe.contentWindow.print !== "function") {
    if (typeof window !== "undefined" && typeof window.print === "function") {
      window.print();
    }
    document.body.removeChild(iframe);
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    iframe.addEventListener("load", () => {
      setTimeout(() => {
        iframe.contentWindow?.focus?.();
        iframe.contentWindow?.print?.();
        setTimeout(() => {
          document.body.removeChild(iframe);
          resolve(true);
        }, 300);
      }, 100);
    });
  });
}

async function probeLinkTargets(
  targets: readonly { readonly path: string; readonly includeHeadings: boolean }[],
): Promise<
  Readonly<
    Record<
      string,
      {
        readonly exists: boolean;
        readonly headingLines: string | null;
        readonly accessError?: boolean;
      }
    >
  >
> {
  if (isTauri()) {
    return invoke("inspect_markdown_link_targets", { targets });
  }
  return Object.fromEntries(
    targets.map(({ path }) => [path, { exists: true, headingLines: null }]),
  );
}

/**
 * 执行文档本地链接检查与 MarkdownLint 诊断，并投影至 CodeMirror 编辑器
 */
export async function checkDocumentLinksAndLint(
  documentPath: string | null,
  markdown: string,
  getRendererPorts: EditorUiActionsContextValue["getRendererPorts"],
  enableMarkdownLint = true,
): Promise<{ total: number; errors: number; warnings: number }> {
  const access = getRendererPorts();
  if (access.status !== "available") {
    return { total: 0, errors: 0, warnings: 0 };
  }

  const validateLinks = async (text: string): Promise<readonly LinkDiagnosticItem[]> => {
    if (!documentPath) return [];
    const items = await validateMarkdownRelativeLinks(text, {
      documentPath,
      probeTargets: probeLinkTargets,
    });
    return items.map((d) => ({
      from: d.from,
      to: d.to,
      target: d.rawTarget,
      message: d.message,
      severity: d.kind === "missing" || d.kind === "anchor-missing" ? "error" : "warning",
    }));
  };

  const diagnostics = await access.ports.runDocumentLint({
    enableMarkdownLint,
    enableLinkCheck: Boolean(documentPath),
    validateLinks,
  });

  const errors = diagnostics.filter((d) => d.severity === "error").length;
  const warnings = diagnostics.filter((d) => d.severity === "warning").length;

  return {
    total: diagnostics.length,
    errors,
    warnings,
  };
}
