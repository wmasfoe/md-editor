import { invoke, isTauri } from "@tauri-apps/api/core";
import type { EditorUiActionsContextValue } from "@md-editor/editor-ui";
import { resolveCodeFontStack, resolveProseFontStack } from "@md-editor/editor-ui";
import { validateMarkdownRelativeLinks } from "@md-editor/file-system";
import type { LinkDiagnosticItem } from "@md-editor/renderer-codemirror";
import { resolvePreviewImageSrc } from "../../lib/markdown-preview";
import { type AppSettings, resolveThemeColorScheme } from "../settings";
import { builtInThemeCss } from "../settings/built-in-themes";

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

const DEFAULT_EDITOR_PROSE_FONT =
  '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "PingFang SC", "Hiragino Sans GB", "Noto Sans CJK SC", "Source Han Sans SC", "Microsoft YaHei UI", sans-serif';
const DEFAULT_EDITOR_CODE_FONT =
  'ui-monospace, "SF Mono", Menlo, Monaco, "Cascadia Code", "JetBrains Mono", "Source Code Pro", Consolas, monospace';

/**
 * 从全局设置中提取导出排版样式（字体、字号、主题变量与色彩方案）
 */
export function resolveExportStyling(settings: AppSettings): ExportDocumentStylingOptions {
  const scheme = resolveThemeColorScheme(settings.theme.mode);
  const themeScheme = scheme === "dark" ? settings.theme.dark : settings.theme.light;
  const themeCss = builtInThemeCss(themeScheme.builtinTheme);
  const rawProseFont = resolveProseFontStack(settings.editor.proseFontFamily);
  const rawCodeFont = resolveCodeFontStack(settings.editor.codeFontFamily);
  const proseFontFamily = rawProseFont || DEFAULT_EDITOR_PROSE_FONT;
  const codeFontFamily = rawCodeFont || DEFAULT_EDITOR_CODE_FONT;
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
  const { exportDocumentHtml } = await import("@md-editor/compiler");
  const mermaidRenderer = await resolveMermaidRenderer(styling.isDark ?? false);
  const result = await exportDocumentHtml(markdown, {
    renderMermaidSvg: mermaidRenderer,
    proseFontFamily: styling.proseFontFamily,
    codeFontFamily: styling.codeFontFamily,
    fontSize: styling.fontSize,
    customCss: styling.themeCss,
  });
  const fragment = result.standaloneHtml;
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
    const { exportDocumentHtml } = await import("@md-editor/compiler");
    const mermaidRenderer = await resolveMermaidRenderer(styling.isDark ?? false);
    const exportResult = await exportDocumentHtml(markdown, {
      resolveImageDataUrl: (src: string) => resolveImageAsBase64(documentPath, src),
      renderMermaidSvg: mermaidRenderer,
      proseFontFamily: styling.proseFontFamily,
      codeFontFamily: styling.codeFontFamily,
      fontSize: styling.fontSize,
      customCss: styling.themeCss,
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
    const { exportDocumentHtml } = await import("@md-editor/compiler");
    const mermaidRenderer = await resolveMermaidRenderer(options.isDark ?? false);
    const exportResult = await exportDocumentHtml(markdown, {
      printPageCss,
      resolveImageDataUrl: (src: string) => resolveImageAsBase64(documentPath, src),
      renderMermaidSvg: mermaidRenderer,
      proseFontFamily: options.proseFontFamily,
      codeFontFamily: options.codeFontFamily,
      fontSize: options.fontSize,
      customCss: options.themeCss,
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

async function probeFileExists(path: string): Promise<boolean> {
  if (isTauri()) {
    return invoke<boolean>("check_path_exists", { path });
  }
  return true;
}

async function probeReadFileContent(path: string): Promise<string | null> {
  if (isTauri()) {
    try {
      const doc = await invoke<{ markdown: string }>("open_markdown_document_at_path", { path });
      return doc.markdown;
    } catch {
      return null;
    }
  }
  return null;
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
      fileExists: probeFileExists,
      readFile: probeReadFileContent,
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
