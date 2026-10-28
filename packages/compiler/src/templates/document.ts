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
    <script>
      (() => {
        function resolveHeadingElement(hash) {
          if (!hash) return null;
          try {
            hash = decodeURIComponent(hash);
          } catch (e) {}

          let el = document.getElementById(hash);
          if (!el) {
            try {
              el =
                document.querySelector('[id="' + CSS.escape(hash) + '"]') ||
                document.querySelector('[name="' + CSS.escape(hash) + '"]');
            } catch (e) {}
          }
          if (el) return el;

          const clean = (s) => (s || "").toLowerCase().replace(/[^\\p{L}\\p{N}\\p{M}]+/gu, "");
          const targetKey = clean(hash);
          if (!targetKey) return null;

          const headings = document.querySelectorAll("h1, h2, h3, h4, h5, h6");
          for (const h of headings) {
            const hId = h.id || "";
            const hText = h.getAttribute("data-heading-text") || h.textContent || "";
            if (clean(hId) === targetKey || clean(hText) === targetKey) {
              return h;
            }
          }
          return null;
        }

        document.addEventListener("click", (e) => {
          const a = e.target.closest('a[href^="#"]');
          if (!a) return;
          const href = a.getAttribute("href");
          if (!href || href === "#") return;
          const hash = href.slice(1);
          const target = resolveHeadingElement(hash);
          if (target) {
            e.preventDefault();
            target.scrollIntoView({ behavior: "smooth", block: "start" });
            try {
              history.pushState(null, "", href);
            } catch (err) {}
          }
        });

        if (window.location.hash) {
          const hash = window.location.hash.slice(1);
          const target = resolveHeadingElement(hash);
          if (target) {
            setTimeout(() => {
              target.scrollIntoView({ behavior: "smooth", block: "start" });
            }, 50);
          }
        }
      })();
    </script>
  </body>
</html>`;
}
