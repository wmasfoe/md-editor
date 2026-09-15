import { STATIC_DOCUMENT_BASE_CSS } from "./styles.ts";
import { escapeHtml } from "../emitter/highlight-code.ts";
import type { StaticRenderOptions, StaticRenderResult } from "../index.ts";

export interface StaticDocumentOptions extends StaticRenderOptions {
  /** Optional custom CSS string to inject into the document */
  customCss?: string;
}

/**
 * Renders Markdown into a standalone, complete HTML document suitable for Quick Look,
 * HTML Export, Print, or Headless PDF/Image generation.
 */
export function createStaticDocumentHtml(
  result: StaticRenderResult,
  options: StaticDocumentOptions = {},
): string {
  const title = escapeHtml(result.title);
  const extraCss = options.customCss ?? "";

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="color-scheme" content="light dark" />
    <title>${title}</title>
    <style>
${STATIC_DOCUMENT_BASE_CSS}
${extraCss}
    </style>
  </head>
  <body>
    <div id="content">
${result.html}
    </div>
  </body>
</html>`;
}
