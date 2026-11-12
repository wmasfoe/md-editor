# @md-editor/markdown-fidelity

Functions for preserving Markdown source through preview and editing. They protect front matter and MDX blocks, map image paths for preview and back, and build a heading outline without DOM or CodeMirror dependencies.

## Why it exists

Rendering and saving Markdown can alter front matter, raw HTML or image paths. This package provides the transforms Inkpoint uses to preserve those parts. Preview rewrites have corresponding restore functions; `serializeRoundTrip` deliberately normalizes line endings and adds a final newline.

## What is in it

| Area | Functions | Notes |
| :--- | :--- | :--- |
| Front matter | `findFrontmatterSourceRange`, `splitFrontmatter` | Finds the leading `---` block and its exact character ranges. Reports `closed` or `unterminated`. The YAML is never parsed or reordered. |
| Raw blocks | `rewriteRawBlocksForPreview`, `restoreRawBlocksFromPreview` | Wraps front matter and top-level MDX components (for example `<Callout>`) in managed code fences so they can be edited as source, then puts the original text back. Code fences in the document are left alone. |
| Images | `createMarkdownImageSrcResolver`, `rewriteMarkdownImageSourcesForPreview`, `restoreMarkdownImageSources` | Turns relative image paths into URLs the host can load (for example Tauri's `convertFileSrc`) and restores the original paths when saving. Remote and `data:` URLs are untouched. |
| Outline | `extractHeadingOutline`, `findActiveHeadingIdForLine` | H1 to H6 with level, text, line number and a unique id. Duplicate titles get `-2`, `-3`. |
| Anchors | `headingAnchorSlug`, `resolveHeadingAnchor` | Resolves `[text](#heading)` links to a heading. |
| Line endings | `serializeRoundTrip` | Converts to `\n` and makes sure the file ends with a newline. It changes nothing else. |
| Detection | `isLikelyMdxBlock` | True when the text starts with an uppercase JSX tag. |

## Install

```bash
npm install @md-editor/markdown-fidelity
```

## Usage

```typescript
import { extractHeadingOutline, findFrontmatterSourceRange } from "@md-editor/markdown-fidelity";

const content = `---
title: My article
---

# First
## Second
`;

const range = findFrontmatterSourceRange(content);
if (range?.status === "closed") {
  console.log(range.content); // "title: My article\n"
}

extractHeadingOutline(content);
// [
//   { id: "first", level: 1, text: "First", line: 5 },
//   { id: "second", level: 2, text: "Second", line: 6 },
// ]
```

## Development

```bash
pnpm test
pnpm typecheck
```
