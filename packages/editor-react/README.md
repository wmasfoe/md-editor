# @md-editor/editor-react

Standalone React integration for `@md-editor/editor`. It exports `CodeMirrorEditor` and `CodeMirrorEditorProps`, mounts the browser editor, subscribes to document snapshots and disposes the bridge on unmount. It requires React and React DOM as peers and has no dependency on application UI, application localization or a platform runtime.

## Usage

```tsx
import { useState } from "react";
import { createDocumentState } from "@md-editor/core";
import { CodeMirrorEditor } from "@md-editor/editor-react";

export function Editor() {
  const [document] = useState(() => createDocumentState({ markdown: "# Hello" }));
  return <CodeMirrorEditor document={document} style={{ height: "100vh" }} />;
}
```

Keep the `DocumentState` stable across renders. Observe changes through `document.subscribeSnapshot`; the component does not accept a controlled Markdown `value`. It forwards configuration and host callbacks to the browser editor. Optional syntax plugins, MDX metadata, image resolution, link handling, clipboard access and AI labels are injected through props.

`onRendererPortsChange` reports editor ports on mount and `null` on cleanup. Import port and suggestion types directly from `@md-editor/editor`. Changes to styling, visibility and editor configuration update the current view; React StrictMode cleanup disposes each created bridge.

The optional `language` prop invalidates localized lint diagnostics when the host language changes. The host supplies its document language and AI labels; this package does not subscribe to application language events. Applications using this repository's outline and settings can use `AppEditor` from `@md-editor/app-ui`.

## Styles and tests

Container CSS is imported by the component. The browser editor owns and injects its content styles, with CSS variable fallbacks; application Tailwind styles and `EditorUiProvider` are not required. Mount the component on the client in a DOM environment.

`@md-editor/editor-react/testing` exposes React editor test helpers. Production code should use the root entry point.

```bash
pnpm --filter @md-editor/editor-react test
pnpm --filter @md-editor/editor-react typecheck
```

## Distribution

This is currently a private workspace package. Future npm builds should preserve dependencies on `@md-editor/editor`, `@md-editor/core` and the plugin SDK; React and React DOM remain peer dependencies.
