# @md-editor/compiler

Turns Markdown into HTML without a DOM and without CodeMirror. It runs in any JavaScript engine: Node.js, a browser, JavaScriptCore and Workers.

## Where it is used

- **macOS QuickLook**: `apps/desktop/scripts/build-quicklook-engine.mjs` bundles this package into the engine that renders `.md` and `.mdx` files when you press Space in Finder. That path needs a fast start and no DOM.
- **HTML export** in the desktop app, through `exportDocumentHtml`.
- Any other place that needs HTML from Markdown without a browser, such as a Worker or a build script.

## API

| Function | Returns | Use it for |
| :--- | :--- | :--- |
| `compileToTokens(markdown, options?)` | the token tree, the title and the front matter | Reading the structure: outlines, indexing, feeding a model |
| `renderStaticHtml(markdown, options?)` | `{ html, title, frontmatterRaw, tokens }` | An HTML fragment to place inside your own page |
| `renderStaticDocument(markdown, options?)` | a full HTML string | A standalone page with the CSS, KaTeX styles and a dark mode media query inlined |
| `await exportDocumentHtml(markdown, options?)` | `{ standaloneHtml, linkedHtml, title }` | Export. `standaloneHtml` is one file with images inlined as base64. `linkedHtml` keeps relative resource links. Pass `resolveImageDataUrl` and `renderMermaidSvg` to inline images and diagrams. |

Code blocks are highlighted with `highlight.js` and formulas are rendered with `katex`. Input above 2 MB (`maxBytes`) is truncated. `options.title` overrides the title, which otherwise comes from front matter or the first H1. `options.customCss` adds CSS to the full document, and `options.customRenderer` lets you replace the output for specific tokens.

## Usage

````typescript
import {
  compileToTokens,
  exportDocumentHtml,
  renderStaticDocument,
  renderStaticHtml,
} from "@md-editor/compiler";

const markdown = `
# Title

Euler: $e^{i\\pi} + 1 = 0$

\`\`\`typescript
const greeting = "Hello Inkpoint";
\`\`\`
`;

const { tokens, title } = compileToTokens(markdown);
const { html } = renderStaticHtml(markdown);
const page = renderStaticDocument(markdown, { customCss: "body { max-width: 720px; }" });

const { standaloneHtml } = await exportDocumentHtml(markdown, {
  resolveImageDataUrl: async (src) => null, // return a data: URL to inline the image
});
````

## Development

```bash
pnpm test
pnpm typecheck
```
