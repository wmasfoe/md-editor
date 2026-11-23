# Using `@md-editor/editor`

The Markdown view: one CodeMirror 6 instance that shows a document rendered (WYSIWYG) or as source.
This guide covers the three integration levels, the props and ports you will actually use, and the
complete export map. For the reference list, jump to [API map](#api-map).

- [Pick an integration level](#pick-an-integration-level)
- [Recipes](#recipes)
  - [Theme it](#theme-it)
  - [Handle images, links and clipboard](#handle-images-links-and-clipboard)
  - [Turn on Markdown lint](#turn-on-markdown-lint)
  - [Show AI suggestions](#show-ai-suggestions)
  - [Add syntax plugins](#add-syntax-plugins)
  - [Remap shortcuts](#remap-shortcuts)
  - [Build a toolbar](#build-a-toolbar)
- [What you get for free](#what-you-get-for-free)
- [API map](#api-map)

## Pick an integration level

### 1. React component (most hosts)

<!-- readme-check -->
```tsx
import { useState } from "react";
import { createDocumentState } from "@md-editor/core";
import { CodeMirrorEditor } from "@md-editor/editor/react";

export function Editor() {
  const [document] = useState(() => createDocumentState({ markdown: "# Hello" }));
  return <CodeMirrorEditor document={document} style={{ height: "100vh" }} />;
}
```

That is the whole integration. Built-in shortcuts work already — including `Mod-/` to switch
between WYSIWYG and source — because the editor owns those bindings and performs the two-phase
mode switch itself. You do **not** need a `window` keydown listener, and you do **not** need
`onRendererPortsChange` unless you want the imperative ports.

Keep the `DocumentState` stable across renders. The component subscribes to it; it does not accept
a controlled `markdown` string.

### 2. Bridge (any framework, or plain DOM)

<!-- readme-check -->
```ts
import { createDocumentState } from "@md-editor/core";
import { createCodeMirrorEditorBridge } from "@md-editor/editor";

const docState = createDocumentState({ markdown: "# Hello" });
const parent = globalThis.document.createElement("div"); // any HTMLElement
globalThis.document.body.appendChild(parent);

const bridge = createCodeMirrorEditorBridge({
  parent,
  document: docState,
  onSyncError: (error) => console.error(error.kind),
  onQueuedExternalEditResult: (result) => console.log(result.status),
});

bridge.ports.focus();
bridge.destroy();
```

The bridge keeps the view and the `DocumentState` in sync, binds built-in shortcuts, and exposes
`ports` (see [ports](#ports-reference)).

### 3. Renderer only (escape hatch)

`createCodeMirrorRenderer()` lives in `/internals` and is **not** a stable API. Use it only when you
need the DOM layer without a `DocumentState`; you then own mode switching, sync and saving.

## Recipes

### Theme it

Two independent knobs:

<!-- readme-check -->
```tsx
import { useState } from "react";
import { createDocumentState } from "@md-editor/core";
import { CodeMirrorEditor } from "@md-editor/editor/react";
import type { EditorTheme } from "@md-editor/editor";

const theme: EditorTheme = {
  colors: { canvasBg: "#101216", textColor: "#e6e6e6", primaryColor: "#6ea8fe" },
  typography: { fontSize: 16, lineHeight: 1.7, proseFontFamily: "Georgia, serif" },
  geometry: { contentMaxWidth: 760 },
};

export function Themed() {
  const [document] = useState(() => createDocumentState({ markdown: "# Hello" }));
  return <CodeMirrorEditor document={document} theme={theme} />;
}
```

`theme` compiles to `--theme-*` custom properties. If you prefer plain CSS, set the variables on any
ancestor instead — every one has a fallback, so a partial theme is fine:

```css
:root {
  --theme-bg: #101216;
  --theme-text: #e6e6e6;
  --theme-primary: #6ea8fe;
  --theme-content-width: 760px;
}
```

| Export | Use |
| --- | --- |
| `THEME_VARIABLES` | Every supported `--theme-*` name with its purpose; render a settings UI from it. |
| `compileEditorTheme(theme)` | `EditorTheme` → `Record<string, string>` of variables. |
| `injectStyles={false}` | You take over all CSS (the renderer stops injecting its own `<style>`). |

### Handle images, links and clipboard

<!-- readme-check -->
```tsx
import { useState } from "react";
import { createDocumentState } from "@md-editor/core";
import { CodeMirrorEditor } from "@md-editor/editor/react";

export function WithPlatformGlue() {
  const [document] = useState(() => createDocumentState({ markdown: "![diagram](./a.png)" }));
  return (
    <CodeMirrorEditor
      document={document}
      resolveImageSrc={(source) => new URL(source, window.location.href).toString()}
      openLinkTarget={(url) => window.open(url, "_blank")}
      writeClipboardText={(text) => navigator.clipboard.writeText(text)}
    />
  );
}
```

### Turn on Markdown lint

`markdownlint` is an optional peer dependency: the editor does not bundle it.

<!-- readme-check -->
```tsx
import { useState } from "react";
import { createDocumentState } from "@md-editor/core";
import { CodeMirrorEditor } from "@md-editor/editor/react";
import { lint } from "markdownlint/sync";

export function Linted() {
  const [document] = useState(() => createDocumentState({ markdown: "# Title" }));
  return <CodeMirrorEditor document={document} enableMarkdownLint markdownlint={{ lint }} />;
}
```

Set `enableMarkdownLint` without an engine and the editor throws on purpose — silent "no
diagnostics" would be worse. At runtime you can swap the engine through
`ports.setMarkdownLintEngine(engine)` (late-loading engines) or toggle with `ports.setMarkdownLint`.

### Show AI suggestions

The editor renders suggestions; it never calls a model. You produce the text, then hand it over.

<!-- readme-check -->
```ts
import { createDocumentState } from "@md-editor/core";
import { createCodeMirrorEditorBridge } from "@md-editor/editor";

const docState = createDocumentState({ markdown: "# Hello\n" });
const parent = globalThis.document.createElement("div");

const bridge = createCodeMirrorEditorBridge({
  parent,
  document: docState,
  onSyncError: () => {},
  onQueuedExternalEditResult: () => {},
});

bridge.ports.showSuggestion({
  from: 8,
  to: 8,
  text: " continued by AI",
  labels: { accept: "Accept", dismiss: "Dismiss" },
});

bridge.ports.acceptSuggestion(); // or let Tab accept it inside the editor
```

`@md-editor/ai` (in this repository) is one producer; anything that can emit `text` works.

### Add syntax plugins

Math, diagrams and custom callouts arrive as `MarkdownSyntaxPlugin` objects (see
[`@md-editor/plugin-sdk`](../plugin-sdk/USAGE.md)).

<!-- readme-check -->
```tsx
import { useState } from "react";
import { createDocumentState } from "@md-editor/core";
import { CodeMirrorEditor } from "@md-editor/editor/react";
import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";

const plugins: readonly MarkdownSyntaxPlugin[] = [];

export function WithPlugins() {
  const [document] = useState(() => createDocumentState({ markdown: "$$x^2$$" }));
  return <CodeMirrorEditor document={document} plugins={plugins} />;
}
```

### Remap shortcuts

Editor-owned chords (`format.*`, `view.toggleSource`) are applied through one authoritative map:

<!-- readme-check -->
```ts
import { createBuiltInKeymaps, createKeymapRegistry, resolveKeymaps } from "@md-editor/core";
import { createCodeMirrorEditorBridge } from "@md-editor/editor";
import { createDocumentState } from "@md-editor/core";

const docState = createDocumentState({ markdown: "" });
const bridge = createCodeMirrorEditorBridge({
  parent: globalThis.document.createElement("div"),
  document: docState,
  onSyncError: () => {},
  onQueuedExternalEditResult: () => {},
});

const registry = createKeymapRegistry();
const effective = resolveKeymaps(createBuiltInKeymaps(), {
  "format.bold": "Mod-Shift-b",
  "view.toggleSource": null, // unbind Mod-/
});

bridge.ports.setKeymaps(effective);
bridge.destroy();
registry.list();
```

The map is authoritative: an id that is absent has no chord, and a command's fixed alias follows
its command (unbind `format.codeBlock` and `Mod-Shift-k` stops working too).

### Build a toolbar

Use the ports; do not re-implement editor semantics.

<!-- readme-check -->
```ts
import { createDocumentState } from "@md-editor/core";
import { createCodeMirrorEditorBridge } from "@md-editor/editor";

const docState = createDocumentState({ markdown: "- item" });
const bridge = createCodeMirrorEditorBridge({
  parent: globalThis.document.createElement("div"),
  document: docState,
  onSyncError: () => {},
  onQueuedExternalEditResult: () => {},
});

const { ports } = bridge;
ports.executeFormatting("format.bold");
ports.executeFormatting("insert.table");
ports.openFind();
ports.toggleFocusMode();
console.log(ports.getViewModeState()); // { focus, typewriter }
bridge.destroy();
```

## What you get for free

- **Built-in shortcuts.** `format.*` (bold, italic, headings, lists, code blocks…) and `Mod-/` for
  switching WYSIWYG ↔ source. Hosts listen for nothing. If a host *also* binds a chord, its
  `preventDefault` makes CodeMirror skip the event, so nothing runs twice.
- **One view for both modes.** Switching modes reconfigures CodeMirror; selection, scroll position
  and undo history survive. The Markdown text is never rewritten.
- **Cursor-aware markers.** `##`, `**`, `>` and friends are hidden until the cursor reaches them.
- **Container CSS.** The component imports its own layout CSS; the renderer injects content styles
  with CSS-variable fallbacks, so no Tailwind or app theme is required.

## API map

Entry points:

| Entry | Contents |
| --- | --- |
| `@md-editor/editor` | Bridge, chrome/diagnostics helpers, theme compilation, code-block language list. |
| `@md-editor/editor/react` | `CodeMirrorEditor`, `CodeMirrorEditorProps`. |
| `@md-editor/editor/testing` | Renderer harness for tests (`createRendererTestHarness`, fixtures). |
| `@md-editor/editor/react/testing` | DOM inspection helpers for component tests. |
| `@md-editor/editor/internals` | Unstable escape hatch (renderer, widgets, formatting commands). Not a supported API. |

### Props (`CodeMirrorEditor`)

| Prop | Purpose |
| --- | --- |
| `document` | Required `DocumentState` from core. Keep it stable. |
| `theme`, `injectStyles`, `styleNonce` | Theming and style injection. |
| `style`, `className`, `ariaLabel`, `hidden` | Container. |
| `codeBlockLineNumbers`, `showInlineStyleMarkers`, `focusDimOpacity` | View toggles. |
| `language`, `translateEditorMessage` | Localization of lint messages and notices. |
| `enableMarkdownLint`, `markdownlint` | Markdown lint (optional peer). |
| `plugins`, `syntaxPluginHostPorts` | Syntax plugins and their host ports. |
| `mdxMode`, `mdxComponents` | MDX documents and the component allow-list. |
| `resolveImageSrc`, `openLinkTarget`, `writeClipboardText` | Platform glue. |
| `aiSuggestionLabels`, `onAiSuggestionAccepted` | AI suggestion chrome. |
| `onSyncError`, `onQueuedExternalEditResult` | Diagnostics: `renderer-sync`, `local-change-rejected`, `mode-switch`. |
| `onRendererPortsChange` | Access the imperative ports (receives `null` on unmount). |
| `onCursorLineChange` | Cursor line for status bars and outlines. |

### Ports reference

| Group | Methods |
| --- | --- |
| Mode | `mode.applyMode`, `mode.rollbackMode` |
| Text & selection | `getSelectionSnapshot`, `setSelection`, `scrollToLine`, `focus`, `undo` |
| Formatting | `executeFormatting(id)` |
| Blocks | `moveBlockUp`, `moveBlockDown`, `duplicateBlock`, `deleteBlock` |
| Search | `openFind`, `openReplace` |
| View | `setCodeBlockLineNumbers`, `setInlineStyleMarkers`, `setHostVisibility`, `toggleFocusMode`, `toggleTypewriterMode`, `getViewModeState` |
| Keys | `setKeymaps(map)` |
| Lint | `setMarkdownLint`, `setMarkdownLintEngine`, `configureMarkdownLint`, `getMarkdownLintState`, `recomputeMarkdownLint` |
| AI | `showSuggestion`, `setAiSuggestionLabels`, `acceptSuggestion`, `dismissSuggestion`, `getSuggestion` |
| External edits | `applyExternalEdit`, `prepareImageInsertion` |
| Meta | `clientId`, `setLanguage` |

### Other exports

| Export | Purpose |
| --- | --- |
| `createCodeMirrorEditorBridge(options)` | Vanilla integration (see above). |
| `compileEditorTheme(theme)`, `THEME_VARIABLES` | Theme compilation and the variable contract. |
| `createDefaultSyntaxPluginHostPorts(translate?)` | Serve media viewer / callout widgets without app-ui. |
| `CODE_BLOCK_LANGUAGES`, `findCodeBlockLanguage(id)` | Language list for selectors. |
| `calculateDocumentMetrics(snapshot)` | Word/line counts for status bars. |
| `dispatchEditorUserNotice(...)`, `EDITOR_USER_NOTICE_EVENT` | Toast-like notices from editor internals. |

## Related packages

- [`@md-editor/core`](../core/USAGE.md) — document state, commands, keymaps.
- [`@md-editor/plugin-sdk`](../plugin-sdk/USAGE.md) — plugin contract and syntax plugins.
