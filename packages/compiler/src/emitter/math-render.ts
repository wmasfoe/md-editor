import { renderToString } from "katex";

export interface MathRenderOptions {
  displayMode?: boolean;
}

/**
 * Escapes unsafe characters for HTML fallback
 */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 离线纯 JS 数学公式渲染器（基于 katex.renderToString）
 * 100% 无 DOM 依赖，可直接在 Node.js、JavaScriptCore (QuickLook)、浏览器 Web Worker 中安全执行。
 */
export function renderMathToString(mathSource: string, options: MathRenderOptions = {}): string {
  const displayMode = options.displayMode ?? false;
  const trimmed = mathSource.trim();
  if (!trimmed) return "";

  try {
    return renderToString(trimmed, {
      displayMode,
      throwOnError: false,
      output: "html",
    });
  } catch {
    const escaped = escapeHtml(trimmed);
    const tag = displayMode ? "pre" : "code";
    return `<${tag} class="katex-error">${escaped}</${tag}>`;
  }
}
