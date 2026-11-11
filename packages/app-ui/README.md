# @md-editor/app-ui

Shared application UI for desktop, web, mobile, the website and uTools: editor integration, outline, dialogs, themes and settings. Application strings come from `@md-editor/i18n`.

`AppEditor` connects the standalone `CodeMirrorEditor` from `@md-editor/editor/react` to application outline state, renderer-port registration and language props. Use `@md-editor/editor/react` directly when embedding an editor in your own React application. Editor transactions and interaction semantics belong to `@md-editor/editor`; document contracts belong to `@md-editor/core`.

## Components

### `AppEditor`

Mounts the editor for a `DocumentState`. The document state is the data flow: the component reads from it and writes edits back to it, so there is no `onChange` prop. Subscribe to the state to observe changes.

Props include:

| Group | Props |
| :--- | :--- |
| Content | `document` (required), `mdxMode`, `mdxComponents`, `plugins` (syntax plugins) |
| Appearance | `fontSize`, `proseFontFamily`, `codeFontFamily`, `headingFontFamily`, `lineHeight`, `letterSpacing`, `contentMaxWidth`, `boldFontWeight`, `headingFontWeight`, `codeBlockLineNumbers`, `showInlineStyleMarkers` |
| Behavior | `enableMarkdownLint` (off by default), `resolveImageSrc`, `openLinkTarget`, `writeClipboardText`, `hidden` |
| Callbacks | `onCursorLineChange`, `onSyncError`, `onQueuedExternalEditResult`, `onRendererPortsChange` |

`onRendererPortsChange` hands the host the renderer ports, which expose mode switching, formatting commands, find, lint and suggestions.

`AppEditor` uses `EditorUiProvider` when present to register ports and update the active outline heading. It forwards the React editor props and callbacks. Bridge creation, document subscriptions and cleanup belong to `@md-editor/editor/react`.

### `OutlinePanel`

Shows a heading tree. It takes the outline as data, the id of the active heading and a jump callback:

```tsx
import { OutlinePanel, type OutlineItem } from "@md-editor/app-ui";

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
import { createDocumentState } from "@md-editor/core";
import { AppEditor } from "@md-editor/app-ui";
import { highlightPlugin, mathPlugin } from "@md-editor/syntax-plugins";

const documentState = createDocumentState({ markdown: "# Hello World" });

export function EditorPage() {
  return (
    <div className="h-screen">
      <AppEditor document={documentState} plugins={[highlightPlugin, mathPlugin]} />
    </div>
  );
}
```

## Other exports

| Entry point | Contents |
| :--- | :--- |
| `@md-editor/app-ui` | The components above, `hooks` (editor UI state, file action feedback, `useOutlineController`), `themes` (theme schema, built-in themes, the style compiler, web font loading) and `keyboard` helpers such as `formatKeymapParts` |
| `@md-editor/app-ui/settings` | The settings shell and panels (appearance, editor, plugins, shortcuts, general) and shared setting styles |
| `@md-editor/app-ui/hooks` | The hooks on their own |
| `@md-editor/app-ui/OutlinePanel` | `OutlinePanel` on its own |

## Development

```bash
pnpm test
pnpm typecheck
```

## Package boundaries

`app-ui → editor → core` is the package dependency direction. The React adapter is provided by the optional `@md-editor/editor/react` sub-entrypoint inside `editor`. Each layer also declares direct dependencies for the contracts it imports. Editor ports and AI suggestion types are imported directly from `@md-editor/editor`, and React editor props from `@md-editor/editor/react`; this package does not forward those APIs.

These packages currently remain private workspace packages. Future npm distribution should preserve dependencies between them.
