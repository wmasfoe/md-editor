import { Marked, type Tokens } from "marked";
import hljs from "highlight.js";
import { resolveLanguageAlias } from "../markdown/language-names.ts";
import { getCalloutSvg, defaultCalloutTitle } from "../markdown/callout-data.ts";

export interface StaticRenderOptions {
  /** Document title for fallback heading or metadata */
  title?: string;
  /** Max input bytes to parse (default: 2MB) */
  maxBytes?: number;
}

export interface StaticRenderResult {
  /** Rendered HTML string */
  readonly html: string;
  /** Extracted document title (from first H1 or provided options) */
  readonly title: string;
  /** Extracted Frontmatter raw content, if present */
  readonly frontmatterRaw?: string;
}

/**
 * Escapes unsafe characters in plain text for HTML output
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
 * Normalizes code block language identifier and attempts syntax highlighting via highlight.js
 */
function highlightCode(code: string, rawLang?: string): { highlighted: string; language: string } {
  const normalized = (rawLang || "").trim().toLowerCase();
  // Match language against known aliases in renderer-codemirror
  const targetLang = resolveLanguageAlias(normalized) ?? normalized;

  if (targetLang && hljs.getLanguage(targetLang)) {
    try {
      const result = hljs.highlight(code, { language: targetLang, ignoreIllegals: true });
      return { highlighted: result.value, language: targetLang };
    } catch {
      // Fall through to auto highlight
    }
  }

  // Fallback to auto-detection
  try {
    const autoResult = hljs.highlightAuto(code);
    if (autoResult.language && hljs.getLanguage(autoResult.language)) {
      return { highlighted: autoResult.value, language: autoResult.language };
    }
  } catch {
    // Fallback to safe escaped plain text
  }

  return { highlighted: escapeHtml(code), language: normalized };
}

/**
 * Creates and configures a Marked instance with GFM, task lists, code highlighting and Callout blocks
 */
function createStaticMarked(): Marked {
  const marked = new Marked();

  marked.use({
    gfm: true,
    breaks: false,
    extensions: [
      {
        name: "highlight",
        level: "inline",
        start(src: string) {
          return src.indexOf("==");
        },
        tokenizer(src: string) {
          const match = /^==((?:[^\s=]|(?:\s+[^\s=]))*?)==/.exec(src);
          if (match && match[1]) {
            return {
              type: "highlight",
              raw: match[0],
              text: match[1],
              tokens: this.lexer.inlineTokens(match[1]),
            };
          }
          return undefined;
        },
        renderer(token: Tokens.Generic) {
          const inner = token.tokens ? this.parser.parseInline(token.tokens) : (token.text ?? "");
          return `<span class="cm-md-marker cm-md-marker--highlight">==</span><mark class="cm-md-inline cm-md-highlight">${inner}</mark><span class="cm-md-marker cm-md-marker--highlight">==</span>`;
        },
      },
    ],
    renderer: {
      strong({ text }: { text: string }) {
        return `<span class="cm-md-marker cm-md-marker--bold">**</span><strong class="cm-md-inline cm-md-bold">${text}</strong><span class="cm-md-marker cm-md-marker--bold">**</span>`;
      },

      em({ text }: { text: string }) {
        return `<span class="cm-md-marker cm-md-marker--italic">*</span><em class="cm-md-inline cm-md-italic">${text}</em><span class="cm-md-marker cm-md-marker--italic">*</span>`;
      },

      del({ text }: { text: string }) {
        return `<span class="cm-md-marker cm-md-marker--strikethrough">~~</span><del class="cm-md-inline cm-md-strikethrough">${text}</del><span class="cm-md-marker cm-md-marker--strikethrough">~~</span>`;
      },

      codespan({ text }: { text: string }) {
        return `<span class="cm-md-marker cm-md-marker--inline-code">\`</span><code class="cm-md-inline cm-md-inline-code">${text}</code><span class="cm-md-marker cm-md-marker--inline-code">\`</span>`;
      },

      code({ text, lang }: { text: string; lang?: string }) {
        const { highlighted, language } = highlightCode(text, lang);
        const langClass = language ? ` language-${escapeHtml(language)}` : "";
        return `<pre><code class="hljs${langClass}">${highlighted}</code></pre>\n`;
      },

      listitem(item: { text: string; task?: boolean; checked?: boolean }) {
        if (item.task) {
          const checkedAttr = item.checked ? ' checked="" disabled=""' : ' disabled=""';
          return `<li class="task-list-item"><input type="checkbox"${checkedAttr}> ${item.text}</li>\n`;
        }
        return `<li>${item.text}</li>\n`;
      },

      blockquote(token: Tokens.Blockquote) {
        // Check for GFM Alert syntax: > [!NOTE], > [!TIP], > [!IMPORTANT], > [!WARNING], > [!CAUTION]
        const trimmed = token.text.trim();
        const calloutMatch = trimmed.match(
          /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION|INFO|DANGER)\](?:[ \t]+([^\r\n]+))?(?:\r?\n([\s\S]*))?$/i,
        );
        if (calloutMatch) {
          const rawType = calloutMatch[1]?.toLowerCase() ?? "info";
          const customTitle = calloutMatch[2]?.trim();
          const title = customTitle || defaultCalloutTitle(rawType);
          const bodyText = (calloutMatch[3] ?? "").trim();
          const iconSvg = getCalloutSvg(rawType);

          // Parse inner body if present
          const innerHtml = bodyText ? (marked.parse(bodyText, { async: false }) as string) : "";

          return `<div class="cm-callout cm-callout--${escapeHtml(rawType)}">
  <div class="cm-callout__header">
    <span class="cm-callout__icon">${iconSvg}</span>
    <strong class="cm-callout__title">${escapeHtml(title)}</strong>
  </div>
  ${innerHtml ? `<div class="cm-callout__body">${innerHtml}</div>` : ""}
</div>\n`;
        }

        const body = token.tokens ? this.parser.parse(token.tokens) : token.text;
        return `<blockquote>\n${body}</blockquote>\n`;
      },
    },
  });

  return marked;
}

const staticMarked = createStaticMarked();

/**
 * Extracts first Heading 1 from Markdown as document title
 */
function extractTitle(markdown: string): string | null {
  const match = markdown.match(/^#\s+([^\n]+)/m);
  return match ? (match[1]?.trim() ?? null) : null;
}

/**
 * Pure function: Renders Markdown to sanitized static HTML string.
 * Completely headless: runs in Node.js, WebKit, Browser, and JavaScriptCore.
 */
export function renderStaticHtml(
  markdown: string,
  options: StaticRenderOptions = {},
): StaticRenderResult {
  const maxBytes = options.maxBytes ?? 2 * 1024 * 1024; // 2MB default safety threshold
  let content = markdown;
  let isTruncated = false;

  if (typeof TextEncoder !== "undefined" && typeof TextDecoder !== "undefined") {
    const encoder = new TextEncoder();
    const bytes = encoder.encode(content);
    if (bytes.length > maxBytes) {
      // Truncate to safe byte limit
      const truncatedBytes = bytes.slice(0, maxBytes);
      content = new TextDecoder("utf-8", { fatal: false }).decode(truncatedBytes);
      isTruncated = true;
    }
  } else if (content.length > maxBytes) {
    content = content.slice(0, maxBytes);
    isTruncated = true;
  }

  // Extract frontmatter if present at offset 0
  let frontmatterRaw: string | undefined;
  const fmMatch = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (fmMatch) {
    frontmatterRaw = fmMatch[1];
    content = content.slice(fmMatch[0].length);
  }

  if (isTruncated) {
    content +=
      "\n\n---\n\n> ⚠️ *文档体积较大（超过 2MB），仅展示前 2MB 内容。完整编辑与查阅请在 Inkpoint 中打开。*";
  }

  const title = options.title || extractTitle(content) || "Untitled";

  if (!content.trim()) {
    return {
      html: '<p style="color: var(--theme-muted, #86868b); font-style: italic;">空文档 (Empty document)</p>',
      title,
      frontmatterRaw,
    };
  }

  try {
    const rawHtml = staticMarked.parse(content, { async: false }) as string;
    return {
      html: rawHtml,
      title,
      frontmatterRaw,
    };
  } catch {
    const escaped = escapeHtml(content);
    return {
      html: `<div class="error-container"><pre><code>${escaped}</code></pre></div>`,
      title,
      frontmatterRaw,
    };
  }
}
