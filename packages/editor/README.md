# @md-editor/editor

The editor view, built on [CodeMirror 6](https://codemirror.net/). It shows a Markdown document either rendered (WYSIWYG) or as source, using one `EditorView` for both.

## One editor, two modes

Many Markdown editors keep two editors, for example ProseMirror for rendering and CodeMirror for source, and convert between them. Conversion changes the text, moves the cursor and breaks the undo history.

Here the document is always the plain Markdown string. WYSIWYG mode adds decorations on top of it:

- **Same instance in both modes.** Switching modes reconfigures CodeMirror compartments. The view is not remounted, and the selection, scroll position and undo history stay.
- **Markers hide away from the cursor.** `##`, `**`, `>` and similar markers are hidden with `Decoration.replace` and shown again when the cursor reaches them.
- **The text is never rewritten.** What you see is a projection of the source, and what is saved is the source.

## What WYSIWYG mode renders

- **Headings** with a fold toggle, **blockquotes and callouts**, **lists** and **task lists**. Clicking a task checkbox toggles `[ ]` and `[x]` in the text.
- **Tables**: edit cells in place, add or remove rows and columns.
- **Code blocks** with highlighting, a language selector, a copy button and optional line numbers.
- **Inline marks**: bold, italic, strikethrough, inline code and links. Their markers show when the cursor touches them.
- **Images, front matter, HTML blocks and MDX components**, shown as widgets. The source stays the source.
- **Block tools**: move, duplicate and delete a block, and drag handles.
- **Input helpers**: smart pairs, `Tab` to step out of brackets and links, smart paste, focus mode and typewriter mode.

Syntax beyond CommonMark (math, Mermaid, directives, highlight) comes from plugins. The repository contains `@md-editor/syntax-plugins`, which is currently excluded from the npm release workflow; external hosts must supply compatible plugins separately.

## AI suggestions

The package shows suggestions produced elsewhere: ghost text, multi-line previews, `Tab` to accept, `Esc` to dismiss, and invalidation when the cursor moves. It consumes the plain data that `@md-editor/ai` returns and does not call any model.

## Using it

```bash
npm install @md-editor/core @md-editor/editor
# For the optional /react entrypoint:
npm install react react-dom
```

The package ships ESM JavaScript, TypeScript declarations and its own styles.
Use a browser bundler that handles CSS imports. The editor requires a DOM and
modern JavaScript APIs, including `Array.prototype.toSorted`; server rendering
should mount the editor on the client. Older WebViews require host-provided
polyfills and separate compatibility testing.

`@md-editor/plugin-sdk` and the other runtime dependencies are installed
automatically. Syntax plugins such as math and Mermaid are separate integrations;
they are not required to use the core editor.

Most hosts use the React component `CodeMirrorEditor` from `@md-editor/editor/react`, which wraps the bridge below. To mount it yourself, create a bridge with a `DocumentState` from `@md-editor/core`:

```typescript
import { createDocumentState } from "@md-editor/core";
import { createCodeMirrorEditorBridge } from "@md-editor/editor";

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

## React integration: `@md-editor/editor/react`

Standalone React integration for `@md-editor/editor`. It exports `CodeMirrorEditor` and `CodeMirrorEditorProps`, mounts the browser editor, subscribes to document snapshots and disposes the bridge on unmount. React is an optional peer of the editor package. The integration has no dependency on application UI, application localization or a platform runtime.

### Usage

```tsx
import { useState } from "react";
import { createDocumentState } from "@md-editor/core";
import { CodeMirrorEditor } from "@md-editor/editor/react";

export function Editor() {
  const [document] = useState(() => createDocumentState({ markdown: "# Hello" }));
  return <CodeMirrorEditor document={document} style={{ height: "100vh" }} />;
}
```

Keep the `DocumentState` stable across renders. Observe changes through `document.subscribeSnapshot`; the component does not accept a controlled Markdown `value`. It forwards configuration and host callbacks to the browser editor. Optional syntax plugins, MDX metadata, image resolution, link handling, clipboard access and AI labels are injected through props.

`onRendererPortsChange` reports editor ports on mount and `null` on cleanup. Import port and suggestion types directly from `@md-editor/editor`. Changes to styling, visibility and editor configuration update the current view; React StrictMode cleanup disposes each created bridge.

The optional `language` prop invalidates localized lint diagnostics when the host language changes. The host supplies its document language and AI labels; this entrypoint does not subscribe to application language events. Applications using this repository's outline and settings can use `AppEditor` from `@md-editor/app-ui`.

### Styles and tests

Container CSS is imported by the component. The browser editor owns and injects its content styles, with CSS variable fallbacks; application Tailwind styles and `EditorUiProvider` are not required. Mount the component on the client in a DOM environment.

`@md-editor/editor/react/testing` exposes React editor test helpers. Production React code should use `@md-editor/editor/react`.

```bash
pnpm --filter @md-editor/editor test
pnpm --filter @md-editor/editor typecheck
```

Only React consumers need to install React (`>=18.3.0 <20`). The main
`@md-editor/editor` entrypoint has no React runtime or type dependency. The adapter
does not import React DOM; your application supplies its own React renderer.
The optional peer applies to the whole package, so an installed React version may
still be checked by the package manager. Using `/react` without React fails during
module resolution or bundling.

## Styles and theming

This package owns its own styles. It renders the editor DOM, so it also ships the
rules for that DOM — the same approach CodeMirror itself takes (`EditorView.baseTheme`
plus `style-mod`) and Tiptap takes (`createStyleTag` plus a `style.ts` constant).

Styles are injected automatically when a renderer is created. No CSS import is
needed, and no host class is required:

```typescript
createCodeMirrorEditorBridge({ parent, document: state, /* ... */ });
// a single <style id="md-editor-renderer-style"> is appended to document.head
```

Injection is idempotent — mounting several editors or hot-reloading never stacks
duplicate rules. Pass `injectStyles: false` to opt out and bring your own CSS, or
`styleNonce` when your CSP requires a nonce.

### Theme variables

Every color, font and spacing value is read as `var(--theme-xxx, <fallback>)`.
All 70 variables carry a fallback, so an editor with no theme at all still looks
right. Provide any subset on an ancestor element (usually `:root`) to theme it:

```css
:root {
  --theme-bg: #ffffff;
  --theme-text: #24292f;
  --theme-primary: #0969da;
}
```

`THEME_VARIABLES` exports the full contract (name, group, purpose) and
`injectEditorStyles`, `EDITOR_STYLE_CSS`, `EDITOR_STYLE_ELEMENT_ID` are available
for hosts that want to drive injection themselves. `@md-editor/app-ui`'s
`compileThemeCss()` generates the same variables from a theme configuration.

Scope comes from this package's own classes (`.cm-md-editor`, set via
`EditorView.editorAttributes`), not from a host-provided wrapper.

## Layout

```
src/
├── bridge.ts       # createCodeMirrorEditorBridge: ties a DocumentState to a renderer
├── renderer/       # the renderer and its controller
├── react/          # optional React component and /react/testing helpers
├── mode.ts         # the mode compartment and mode switching
├── markdown/       # Markdown parsing and the range index
├── wysiwyg/        # decorations, widgets, editing commands and input handling
├── lint/           # markdownlint integration and diagnostics
├── media-viewer/   # click-to-zoom for images and Mermaid diagrams
├── plugins/        # the syntax plugin registry
└── testing.ts      # test helpers, exported as @md-editor/editor/testing
```

## Development

```bash
pnpm test
pnpm typecheck
pnpm lint
```
