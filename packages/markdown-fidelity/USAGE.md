# Using `@md-editor/markdown-fidelity`

Helpers that keep Markdown source intact while you preview or edit it: protect front matter and MDX
blocks, rewrite image paths for preview and back, and build a heading outline. No DOM, no
CodeMirror — safe on the server.

- [Image sources](#image-sources)
- [Front matter](#front-matter)
- [Protected blocks](#protected-blocks)
- [Heading outline](#heading-outline)
- [Round trip](#round-trip)
- [API map](#api-map)

## Image sources

Preview needs absolute URLs; saving needs the original relative paths. These two functions are
inverses of each other.

<!-- readme-check -->
```ts
import {
  createMarkdownImageSrcResolver,
  restoreMarkdownImageSources,
  rewriteMarkdownImageSourcesForPreview,
} from "@md-editor/markdown-fidelity";

const markdown = "![diagram](./assets/a.png)";
const resolve = createMarkdownImageSrcResolver("/docs/guide.md");
const preview = rewriteMarkdownImageSourcesForPreview(markdown, resolve);
const backToSource = restoreMarkdownImageSources(preview.markdown, preview.sourceMap);

console.log(preview.markdown, backToSource === markdown);
```

`createMarkdownImageSrcResolver(documentPath, options?)` returns a plain `(src) => src` function,
which is exactly what the editor's `resolveImageSrc` prop wants. Remote URLs, `data:` URIs and `#`
anchors pass through untouched.

## Front matter

<!-- readme-check -->
```ts
import { findFrontmatterSourceRange, splitFrontmatter } from "@md-editor/markdown-fidelity";

const markdown = "---\ntitle: Hello\n---\n\n# Body\n";
const block = splitFrontmatter(markdown);
const range = findFrontmatterSourceRange(markdown);

console.log(block?.raw.trim(), block?.body.trim(), range?.status, range?.contentRange.to);
```

`splitFrontmatter` returns `null` when the block is unterminated, so preview code can fall back to
showing the raw text instead of eating the document.

## Protected blocks

MDX and HTML blocks must survive an editor round trip byte-for-byte, even while they render as
widgets.

<!-- readme-check -->
```ts
import {
  isLikelyMdxBlock,
  restoreRawBlocksFromPreview,
  rewriteRawBlocksForPreview,
} from "@md-editor/markdown-fidelity";

const markdown = "<Callout type=\"info\">\nChildren\n</Callout>\n";
const placeholderPreview = rewriteRawBlocksForPreview(markdown);
const restored = restoreRawBlocksFromPreview(placeholderPreview.markdown, placeholderPreview.sourceMap);

console.log(isLikelyMdxBlock(markdown), restored === markdown);
```

The preview form is only a display substitute — never persist it. Restore before saving, or save
from the source snapshot instead.

## Heading outline

<!-- readme-check -->
```ts
import { extractHeadingOutline, findActiveHeadingIdForLine, headingAnchorSlug } from "@md-editor/markdown-fidelity";

const markdown = "# Intro\n\n## Details\n\n### Deep dive\n";
const outline = extractHeadingOutline(markdown);

console.log(outline.map((item) => `${item.level}:${item.text}`), outline[1]?.id);
console.log(headingAnchorSlug("Details"), findActiveHeadingIdForLine(outline, 3));
```

Slugs are de-duplicated per document (the second `## Intro` becomes `intro-1`), and the active
heading for a caret line is computed from source offsets, so an outline can highlight while you
type.

## Round trip

<!-- readme-check -->
```ts
import { serializeRoundTrip } from "@md-editor/markdown-fidelity";

const result = serializeRoundTrip("# Hello");
console.log(result.markdown, result.changed);
```

`serializeRoundTrip` documents the current normalization boundary: only line endings and the final
newline may change. Use it in tests to assert that your pipeline never rewrites content it should
not.

## API map

| Export | Purpose |
| --- | --- |
| `rewriteMarkdownImageSourcesForPreview`, `restoreMarkdownImageSources`, `createMarkdownImageSrcResolver` | Relative ↔ preview image sources. |
| `splitFrontmatter`, `findFrontmatterSourceRange` | Parse a front matter block and locate it in source. |
| `rewriteRawBlocksForPreview`, `restoreRawBlocksFromPreview`, `isLikelyMdxBlock` | Protect MDX/HTML while previewing. |
| `extractHeadingOutline`, `findActiveHeadingIdForLine`, `headingAnchorSlug`, `resolveHeadingAnchor` | Outline and anchors. |
| `serializeRoundTrip` | Round-trip check with an explicit normalization boundary. |

## Related packages

- [`@md-editor/shared`](../shared/USAGE.md) — the heading slug allocator this package builds on.
- [`@md-editor/editor`](../editor/USAGE.md) — consumes these helpers for images and MDX.
