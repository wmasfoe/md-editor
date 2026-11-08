# @md-editor/mobile-core

The web page that runs inside the Android WebView and the iOS WKWebView. It renders and edits a document and talks to the native app over a small message bridge. Mobile is no longer released, but the source is kept; see [`apps/mobile`](../README.md).

## What it does

- **Two modes.** Reading mode (`ReaderCanvas`) renders the document as static content. Edit mode (`EditorCanvas`) creates a CodeMirror 6 editor when it is needed and follows the soft keyboard.
- **Error boundary.** If a plugin or the renderer throws, `ErrorBoundary` shows a retry card instead of a blank page and reports the error to the native side.
- **Shared code.** It uses the same `@md-editor/renderer-codemirror` and `@md-editor/syntax-plugins` as the desktop app.

## The bridge

The message types live in `src/bridge/contracts.ts`. The Swift and Kotlin projects mirror them, and each has a contract test (`InkpointContractTests` for iOS, `BridgeContractTest` for Android).

From native to web, `bridge.dispatchNativeAction` receives `{ id, action, payload }`:

| Action | Payload | Effect |
| :--- | :--- | :--- |
| `loadDocument` | `{ content, path?, mode?, title? }` | Opens a document in `read` or `edit` mode |
| `setMode` | `{ mode: "read" \| "edit" }` | Switches mode |
| `setTheme` | `{ isDark }` | Switches between light and dark |
| `scrollToHeading` | `{ headingId }` | Scrolls to a heading |
| `execCommand` | `{ command }` | Runs a formatting command in edit mode: `bold`, `italic`, `strikethrough`, `inlineCode`, `h1`, `h2`, `h3`, `bulletList`, `orderedList`, `taskList`, `quote`, `codeBlock`, `undo` or `redo` |
| `requestContent` | none | Asks the page to reply with the current text (`saveResponse`) |

From web to native, `bridge.postToNative(event, payload)` sends:

| Event | Payload | Meaning |
| :--- | :--- | :--- |
| `ready` | none | The page has mounted |
| `contentChange` | `{ isDirty, wordCount }` | The text changed |
| `selectionChange` | `{ activeFormats }` | Which formats apply at the cursor |
| `outlineExtracted` | `{ headings, outline? }` | The heading list |
| `saveResponse` | `{ markdown, isSuccess, path? }` | The text to write to disk |
| `haptic` | `{ type }` | Ask for haptic feedback: `selection`, `impactLight`, `impactMedium`, `impactHeavy`, `notificationSuccess` or `notificationError` |
| `error` | the error details | An uncaught error |

## Development

```bash
pnpm --filter @md-editor/mobile-core dev         # preview in a browser
pnpm --filter @md-editor/mobile-core build       # writes dist/
pnpm --filter @md-editor/mobile-core test
pnpm --filter @md-editor/mobile-core typecheck
```

From the repository root, `pnpm build:mobile` builds this package and copies `dist/` into the Android and iOS projects.
