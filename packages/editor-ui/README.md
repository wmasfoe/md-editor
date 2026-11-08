# @md-editor/editor-ui

The React layer of the editor. It wraps the CodeMirror renderer in a component, adds the outline panel, document bar, welcome screen and dialogs, and holds the theme and settings UI shared by the desktop app, the web playground and the uTools plugin.

It sits between the renderer and the apps:

- It composes and presents. It turns the state in `@md-editor/editor-core` and the view in `@md-editor/renderer-codemirror` into React components.
- It does not compute document changes. Edits go through `editor-core` commands or renderer transactions, never through direct changes to the text or an AST.
- Colors come from CSS variables set by the theme compiler (Tailwind CSS), and strings come from `@md-editor/i18n`.

## Components

### `CodeMirrorEditor`

Mounts the editor for a `DocumentState`. The document state is the data flow: the component reads from it and writes edits back to it, so there is no `onChange` prop. Subscribe to the state to observe changes.

Props include:

| Group | Props |
| :--- | :--- |
| Content | `document` (required), `mdxMode`, `mdxComponents`, `plugins` (syntax plugins) |
| Appearance | `fontSize`, `proseFontFamily`, `codeFontFamily`, `headingFontFamily`, `lineHeight`, `letterSpacing`, `contentMaxWidth`, `boldFontWeight`, `headingFontWeight`, `codeBlockLineNumbers`, `showInlineStyleMarkers` |
| Behavior | `enableMarkdownLint` (off by default), `resolveImageSrc`, `openLinkTarget`, `writeClipboardText`, `hidden` |
| Callbacks | `onCursorLineChange`, `onSyncError`, `onQueuedExternalEditResult`, `onRendererPortsChange` |

`onRendererPortsChange` hands the host the renderer ports, which expose mode switching, formatting commands, find, lint and suggestions.

The component creates the renderer when it mounts and destroys it on unmount, and it survives React StrictMode's double mount.

### `OutlinePanel`

Shows a heading tree. It takes the outline as data, the id of the active heading and a jump callback:

```tsx
import { OutlinePanel, type OutlineItem } from "@md-editor/editor-ui";

const outline: OutlineItem[] = [
  { id: "intro", level: 1, text: "Intro", line: 1 },
  { id: "setup", level: 2, text: "Setup", line: 5 },
];

<OutlinePanel outline={outline} activeId="setup" onJump={(target) => scrollEditorTo(target)} />;
```

`extractHeadingOutline` in `@md-editor/markdown-fidelity` builds the list. `useOutlineController({ markdown, showToast })` builds it from the current text, tracks the active heading as the cursor moves, and resolves `#fragment` links to a heading. The active item scrolls into view in the panel.

### Other components

- `DocumentBar`: the title bar with the file name and save state.
- `WelcomeState`: the empty-window screen.
- `AssetPreview`: preview for non-Markdown files.
- `ConfirmActionDialog` and its button styles: confirmation dialogs.

## Minimal example

```tsx
import { createDocumentState } from "@md-editor/editor-core";
import { CodeMirrorEditor } from "@md-editor/editor-ui";
import { highlightPlugin, mathPlugin } from "@md-editor/syntax-plugins";

const documentState = createDocumentState({ markdown: "# Hello World" });

export function EditorPage() {
  return (
    <div className="h-screen">
      <CodeMirrorEditor document={documentState} plugins={[highlightPlugin, mathPlugin]} />
    </div>
  );
}
```

## Other exports

| Entry point | Contents |
| :--- | :--- |
| `@md-editor/editor-ui` | The components above, `hooks` (editor UI state, file action feedback, `useOutlineController`), `themes` (theme schema, built-in themes, the style compiler, web font loading) and `keyboard` helpers such as `formatKeymapParts` |
| `@md-editor/editor-ui/settings` | The settings shell and panels (appearance, editor, plugins, shortcuts, general) and shared setting styles |
| `@md-editor/editor-ui/hooks` | The hooks on their own |
| `@md-editor/editor-ui/OutlinePanel` | `OutlinePanel` on its own |

## Development

```bash
pnpm test
pnpm typecheck
```
