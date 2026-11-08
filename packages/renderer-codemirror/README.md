# @md-editor/renderer-codemirror

The editor view, built on [CodeMirror 6](https://codemirror.net/). It shows a Markdown document either rendered (WYSIWYG) or as source, using one `EditorView` for both.

## One editor, two modes

Many Markdown editors keep two editors, for example ProseMirror for rendering and CodeMirror for source, and convert between them. Conversion changes the text, moves the cursor and breaks the undo history.

Here the document is always the plain Markdown string. WYSIWYG mode adds decorations on top of it:

- **Same instance in both modes.** Switching modes reconfigures CodeMirror compartments. The view is not remounted, and the selection, scroll position and undo history stay.
- **Markers hide away from the cursor.** `##`, `**`, `>` and similar markers are hidden with `Decoration.replace` and shown again when the cursor reaches them.
- **The text is never rewritten.** What you see is a projection of the source, and what is saved is the source.

## What WYSIWYG mode renders

Under `src/wysiwyg/`:

- **Headings** with a fold toggle, **blockquotes and callouts**, **lists** and **task lists**. Clicking a task checkbox toggles `[ ]` and `[x]` in the text.
- **Tables**: edit cells in place, add or remove rows and columns (`editing/table-editing.ts`).
- **Code blocks** with highlighting, a language selector, a copy button and optional line numbers.
- **Inline marks**: bold, italic, strikethrough, inline code and links. Their markers show when the cursor touches them.
- **Images, front matter, HTML blocks and MDX components**, shown as widgets. The source stays the source.
- **Block tools**: move, duplicate and delete a block, and drag handles.
- **Input helpers**: smart pairs, `Tab` to step out of brackets and links, smart paste, focus mode and typewriter mode.

Syntax beyond CommonMark (math, Mermaid, directives, highlight) comes from plugins. See `@md-editor/syntax-plugins`.

## AI suggestions

The package shows suggestions produced elsewhere: ghost text, multi-line previews, `Tab` to accept, `Esc` to dismiss, and invalidation when the cursor moves. It consumes the plain data that `@md-editor/ai` returns and does not call any model.

## Using it

Most hosts use the React component `CodeMirrorEditor` from `@md-editor/editor-ui`, which wraps the bridge below. To mount it yourself, create a bridge with a `DocumentState` from `@md-editor/editor-core`:

```typescript
import { createDocumentState } from "@md-editor/editor-core";
import { createCodeMirrorEditorBridge } from "@md-editor/renderer-codemirror";

const state = createDocumentState({ markdown: "# Hello Inkpoint" });

const bridge = createCodeMirrorEditorBridge({
  parent: document.getElementById("editor")!, // any HTMLElement
  document: state,
  onSyncError: (error) => console.error(error),
  onQueuedExternalEditResult: () => {},
});

// The bridge keeps the view and the document state in sync.
// bridge.ports exposes mode switching, formatting commands, find, lint and suggestions.
bridge.ports.focus();

bridge.destroy();
```

`createCodeMirrorEditorBridge` also accepts `plugins`, `resolveImageSrc`, `openLinkTarget`, `mdxMode`, `mdxComponents`, `enableMarkdownLint` and `writeClipboardText`.

## Layout

```
src/
├── bridge.ts       # createCodeMirrorEditorBridge: ties a DocumentState to a renderer
├── renderer/       # the renderer and its controller
├── mode.ts         # the mode compartment and mode switching
├── markdown/       # Markdown parsing and the range index
├── wysiwyg/        # decorations, widgets, editing commands and input handling
├── lint/           # markdownlint integration and diagnostics
├── media-viewer/   # click-to-zoom for images and Mermaid diagrams
├── plugins/        # the syntax plugin registry
└── testing.ts      # test helpers, exported as @md-editor/renderer-codemirror/testing
```

## Development

```bash
pnpm test
pnpm typecheck
pnpm lint
```
