import type { BlockToken, InlineToken, ListItemToken, StaticToken } from "../tokens/types.ts";
import { escapeHtml, highlightCode } from "./highlight-code.ts";
import { renderMathToString } from "./math-render.ts";
import { getCalloutSvg } from "../data/callout-data.ts";
import type { StaticCustomRenderer } from "./custom-renderer.ts";

const defaultThematicBreak = () => "<hr />\n";

export interface EmitHtmlOptions {
  /**
   * Include CodeMirror syntax markers (.cm-md-marker)
   * Set to true to visually match Inkpoint CodeMirrorEditor's live syntax decoration
   * Default: true
   */
  includeMarkers?: boolean;
  /**
   * Custom renderer to intercept and customize output
   */
  customRenderer?: StaticCustomRenderer;
}

/**
 * Emits semantic, style-aware HTML from structured tokens
 */
export function emitHtml(tokens: StaticToken[], options: EmitHtmlOptions = {}): string {
  const includeMarkers = options.includeMarkers ?? true;
  const custom = options.customRenderer;

  function renderInline(token: InlineToken): string {
    switch (token.type) {
      case "text":
        return custom?.text
          ? custom.text(token, () => escapeHtml(token.text))
          : escapeHtml(token.text);

      case "bold": {
        const next = () => {
          const inner = token.tokens
            ? token.tokens.map(renderInline).join("")
            : escapeHtml(token.text);
          if (includeMarkers) {
            return `<span class="cm-md-marker cm-md-marker--bold">**</span><strong class="cm-md-inline cm-md-bold">${inner}</strong><span class="cm-md-marker cm-md-marker--bold">**</span>`;
          }
          return `<strong>${inner}</strong>`;
        };
        return custom?.bold ? custom.bold(token, next) : next();
      }

      case "italic": {
        const next = () => {
          const inner = token.tokens
            ? token.tokens.map(renderInline).join("")
            : escapeHtml(token.text);
          if (includeMarkers) {
            return `<span class="cm-md-marker cm-md-marker--italic">*</span><em class="cm-md-inline cm-md-italic">${inner}</em><span class="cm-md-marker cm-md-marker--italic">*</span>`;
          }
          return `<em>${inner}</em>`;
        };
        return custom?.italic ? custom.italic(token, next) : next();
      }

      case "strikethrough": {
        const next = () => {
          const inner = token.tokens
            ? token.tokens.map(renderInline).join("")
            : escapeHtml(token.text);
          if (includeMarkers) {
            return `<span class="cm-md-marker cm-md-marker--strikethrough">~~</span><del class="cm-md-inline cm-md-strikethrough">${inner}</del><span class="cm-md-marker cm-md-marker--strikethrough">~~</span>`;
          }
          return `<del>${inner}</del>`;
        };
        return custom?.strikethrough ? custom.strikethrough(token, next) : next();
      }

      case "highlight": {
        const next = () => {
          const inner = token.tokens
            ? token.tokens.map(renderInline).join("")
            : escapeHtml(token.text);
          if (includeMarkers) {
            return `<span class="cm-md-marker cm-md-marker--highlight">==</span><mark class="cm-md-inline cm-md-highlight">${inner}</mark><span class="cm-md-marker cm-md-marker--highlight">==</span>`;
          }
          return `<mark>${inner}</mark>`;
        };
        return custom?.highlight ? custom.highlight(token, next) : next();
      }

      case "inline_code": {
        const next = () => {
          const escaped = escapeHtml(token.code);
          if (includeMarkers) {
            return `<span class="cm-md-marker cm-md-marker--inline-code">\`</span><code class="cm-md-inline cm-md-inline-code">${escaped}</code><span class="cm-md-marker cm-md-marker--inline-code">\`</span>`;
          }
          return `<code>${escaped}</code>`;
        };
        return custom?.inlineCode ? custom.inlineCode(token, next) : next();
      }

      case "math_inline": {
        const next = () => {
          const rendered = renderMathToString(token.math, { displayMode: false });
          return `<span class="cm-md-math-inline math-inline">${rendered}</span>`;
        };
        return custom?.mathInline ? custom.mathInline(token, next) : next();
      }

      case "link": {
        const next = () => {
          const inner = token.tokens
            ? token.tokens.map(renderInline).join("")
            : escapeHtml(token.text);
          const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : "";
          return `<a href="${escapeHtml(token.href)}"${titleAttr}>${inner}</a>`;
        };
        return custom?.link ? custom.link(token, next) : next();
      }

      case "image": {
        const next = () => {
          const altAttr = token.alt ? ` alt="${escapeHtml(token.alt)}"` : "";
          const titleAttr = token.title ? ` title="${escapeHtml(token.title)}"` : "";
          return `<img src="${escapeHtml(token.href)}"${altAttr}${titleAttr} />`;
        };
        return custom?.image ? custom.image(token, next) : next();
      }

      default:
        return escapeHtml((token as { raw?: string }).raw ?? "");
    }
  }

  function renderBlock(token: BlockToken): string {
    switch (token.type) {
      case "heading": {
        const next = () => {
          const inner = token.tokens
            ? token.tokens.map(renderInline).join("")
            : escapeHtml(token.text);
          const plainText = token.text.replace(/<[^>]+>/g, "").trim();
          const idAttr = token.id ? ` id="${escapeHtml(token.id)}"` : "";
          return `<h${token.level}${idAttr} data-heading-text="${escapeHtml(plainText)}">${inner}</h${token.level}>\n`;
        };
        return custom?.heading ? custom.heading(token, next) : next();
      }

      case "paragraph": {
        const next = () => {
          const inner = token.tokens
            ? token.tokens.map(renderInline).join("")
            : escapeHtml(token.text);
          return `<p>${inner}</p>\n`;
        };
        return custom?.paragraph ? custom.paragraph(token, next) : next();
      }

      case "code_block": {
        const next = () => {
          const { highlighted, language } = highlightCode(token.code, token.lang);
          const langClass = language ? ` language-${escapeHtml(language)}` : "";
          return `<pre><code class="hljs${langClass}">${highlighted}</code></pre>\n`;
        };
        return custom?.codeBlock ? custom.codeBlock(token, next) : next();
      }

      case "math_block": {
        const next = () => {
          const rendered = renderMathToString(token.math, { displayMode: true });
          return `<div class="cm-md-math-block math-display">${rendered}</div>\n`;
        };
        return custom?.mathBlock ? custom.mathBlock(token, next) : next();
      }

      case "blockquote": {
        const next = () => {
          const inner = token.tokens
            ? token.tokens.map((t) => renderBlock(t as BlockToken)).join("")
            : escapeHtml(token.text);
          return `<blockquote>\n${inner}</blockquote>\n`;
        };
        return custom?.blockquote ? custom.blockquote(token, next) : next();
      }

      case "callout": {
        const next = () => {
          const iconSvg = getCalloutSvg(token.calloutType);
          const innerHtml = token.tokens
            ? token.tokens.map((t) => renderBlock(t as BlockToken)).join("")
            : escapeHtml(token.bodyText);

          return `<div class="cm-callout cm-callout--${escapeHtml(token.calloutType)}">
  <div class="cm-callout__header">
    <span class="cm-callout__icon">${iconSvg}</span>
    <strong class="cm-callout__title">${escapeHtml(token.title)}</strong>
  </div>
  ${innerHtml ? `<div class="cm-callout__body">${innerHtml}</div>` : ""}
</div>\n`;
        };
        return custom?.callout ? custom.callout(token, next) : next();
      }

      case "table": {
        const next = () => {
          let html = "<table>\n<thead>\n<tr>\n";
          for (const cell of token.header) {
            const alignAttr = cell.align ? ` style="text-align: ${cell.align}"` : "";
            const inner = cell.tokens
              ? cell.tokens.map(renderInline).join("")
              : escapeHtml(cell.text);
            html += `  <th${alignAttr}>${inner}</th>\n`;
          }
          html += "</tr>\n</thead>\n<tbody>\n";
          for (const row of token.rows) {
            html += "<tr>\n";
            for (const cell of row) {
              const alignAttr = cell.align ? ` style="text-align: ${cell.align}"` : "";
              const inner = cell.tokens
                ? cell.tokens.map(renderInline).join("")
                : escapeHtml(cell.text);
              html += `  <td${alignAttr}>${inner}</td>\n`;
            }
            html += "</tr>\n";
          }
          html += "</tbody>\n</table>\n";
          return html;
        };
        return custom?.table ? custom.table(token, next) : next();
      }

      case "list": {
        const next = () => {
          const tag = token.ordered ? "ol" : "ul";
          const startAttr =
            token.ordered && token.start && token.start !== 1 ? ` start="${token.start}"` : "";
          const itemsHtml = token.items.map((item) => renderListItem(item)).join("");
          return `<${tag}${startAttr}>\n${itemsHtml}</${tag}>\n`;
        };
        return custom?.list ? custom.list(token, next) : next();
      }

      case "thematic_break":
        return custom?.thematicBreak
          ? custom.thematicBreak(token, defaultThematicBreak)
          : defaultThematicBreak();

      case "html_block": {
        const next = () => token.text;
        return custom?.htmlBlock ? custom.htmlBlock(token, next) : next();
      }

      default:
        return "";
    }
  }

  function renderListItem(item: ListItemToken): string {
    const next = () => {
      const inner = item.tokens
        ? item.tokens.map((t) => renderBlock(t as BlockToken)).join("")
        : escapeHtml(item.text);

      if (item.task) {
        const checkedAttr = item.checked ? ' checked="" disabled=""' : ' disabled=""';
        return `<li class="task-list-item"><input type="checkbox"${checkedAttr}> ${inner}</li>\n`;
      }
      return `<li>${inner}</li>\n`;
    };
    return custom?.listItem ? custom.listItem(item, next) : next();
  }

  return tokens
    .map((token) => {
      if (
        "level" in token ||
        "items" in token ||
        token.type === "code_block" ||
        token.type === "paragraph" ||
        token.type === "blockquote" ||
        token.type === "callout" ||
        token.type === "table" ||
        token.type === "thematic_break" ||
        token.type === "math_block" ||
        token.type === "html_block"
      ) {
        return renderBlock(token as BlockToken);
      }
      return renderInline(token as InlineToken);
    })
    .join("");
}
