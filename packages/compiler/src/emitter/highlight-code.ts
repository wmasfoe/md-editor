import hljs from "highlight.js";
import { resolveLanguageAlias } from "../data/language-names.ts";

/**
 * Escapes unsafe characters in plain text for HTML output
 */
export function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface HighlightResult {
  readonly highlighted: string;
  readonly language: string;
}

/**
 * Normalizes code block language identifier and highlights code syntax via highlight.js
 */
export function highlightCode(code: string, rawLang?: string): HighlightResult {
  const normalized = (rawLang || "").trim().toLowerCase();
  const targetLang = resolveLanguageAlias(normalized) ?? normalized;

  // 1. If an explicit language was specified, respect it and do not overwrite with auto-detection
  if (targetLang) {
    if (hljs.getLanguage(targetLang)) {
      try {
        const result = hljs.highlight(code, { language: targetLang, ignoreIllegals: true });
        return { highlighted: result.value, language: targetLang };
      } catch {
        // Fall through to safe escaped plain text with preserved language
      }
    }
    return { highlighted: escapeHtml(code), language: targetLang };
  }

  // 2. Fallback to auto-detection ONLY when no explicit language was specified
  try {
    const autoResult = hljs.highlightAuto(code);
    if (autoResult.language && hljs.getLanguage(autoResult.language)) {
      return { highlighted: autoResult.value, language: autoResult.language };
    }
  } catch {
    // Fallback to safe escaped plain text
  }

  return { highlighted: escapeHtml(code), language: "" };
}
