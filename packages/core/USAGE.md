# Using `@md-editor/core`

Practical guide to the headless domain model: document state, commands, keymaps and the runtime
that ties them together. For the reference summary, see [API map](#api-map) at the end.

Nothing here touches the DOM, CodeMirror or React. The same code runs in a browser, in a Tauri
webview, in Node, or in a test.

- [Minimal use](#minimal-use)
- [Recipes](#recipes)
  - [Switch WYSIWYG ↔ source](#switch-wysiwyg--source)
  - [Save to disk](#save-to-disk)
  - [Register commands and shortcuts](#register-commands-and-shortcuts)
  - [Let users remap shortcuts](#let-users-remap-shortcuts)
  - [Apply an external edit (AI, formatter)](#apply-an-external-edit-ai-formatter)
  - [Inject content into a renderer](#inject-content-into-a-renderer)
- [API map](#api-map)

## Minimal use

<!-- readme-check -->
```ts
import { createDocumentState } from "@md-editor/core";

const document = createDocumentState({ markdown: "# Hello" });

// Read the current snapshot (immutable value object).
console.log(document.getSnapshot().mode); // "wysiwyg"

// Subscribe: the callback fires for any visible change (text, mode, path).
const unsubscribe = document.subscribeSnapshot(() => {
  const snapshot = document.getSnapshot();
  console.log(snapshot.markdown, snapshot.stateRevision);
});

unsubscribe();
```

`createDocumentState` accepts:

| Field | Type | Notes |
| --- | --- | --- |
| `markdown` | `string` | Required. Normalized to `\n` line endings. |
| `mode` | `"wysiwyg" \| "source"` | Defaults to `"wysiwyg"`. |
| `filePath` | `string \| null` | Only metadata; core never touches the filesystem. |

Keep the `DocumentState` instance stable for the lifetime of the editor. It is the single source
of truth; renderers read snapshots from it and push user input back into it.

## Recipes

### Switch WYSIWYG ↔ source

Mode switching is a two-phase protocol: the renderer applies the mode first, then core commits it
with a compare-and-swap, and the renderer rolls back if the commit fails. Do not call
`document.commitMode()` directly — use `switchEditorModeSafely()` so the view and the snapshot
cannot disagree.

<!-- readme-check -->
```ts
import { createDocumentState, switchEditorModeSafely, type ModeRendererPort } from "@md-editor/core";

declare const renderer: ModeRendererPort;
const document = createDocumentState({ markdown: "# Hello" });

const next = document.getSnapshot().mode === "wysiwyg" ? "source" : "wysiwyg";
const result = switchEditorModeSafely(document, next, { renderer });

if (!result.ok) {
  console.error(result.error, result.message); // renderer refused, or the CAS lost
}
```

If you use `@md-editor/editor`, you never write this: the bridge already binds it to `Mod-/` and
runs the same call. This recipe is for hosts that build their own renderer.

### Save to disk

Core owns the save checkpoint so a slow write cannot lose edits. Your filesystem layer only
performs the write.

<!-- readme-check -->
```ts
import { createDocumentState, executeDocumentSave } from "@md-editor/core";

const document = createDocumentState({ markdown: "# Hello", filePath: null });

// The port receives an immutable checkpoint and reports what it knows about the write.
const result = await executeDocumentSave(
  document,
  async (checkpoint) => {
    const target = checkpoint.destination.kind === "current-path" ? checkpoint.destination.path : null;
    if (!target) {
      return { status: "cancelled", commit: "not-committed", phase: "dialog", reason: "dialog-cancelled" };
    }
    await myPlatformWrite(target, checkpoint.markdownLf);
    return { status: "succeeded", commit: "committed", filePath: target, warnings: [] };
  },
  true, // forceDialog: ask the user even when filePath is known
);

console.log(result.outcome.status); // "succeeded" | "failed" | "cancelled" | "indeterminate" | ...

declare function myPlatformWrite(path: string, markdown: string): Promise<void>;
```

### Register commands and shortcuts

Commands describe *what* can be done; keymaps describe *which chord* triggers it. Both are plain
registries, so the command palette, the menu bar and the keydown listener can read the same data.

<!-- readme-check -->
```ts
import {
  createCommandRegistry,
  createKeymapRegistry,
  createEditorRuntime,
  createDocumentState,
  createFeatureRegistry,
  createBuiltInEditorFeature,
} from "@md-editor/core";

const features = createFeatureRegistry();
features.register(createBuiltInEditorFeature());

const runtime = createEditorRuntime({
  document: createDocumentState({ markdown: "" }),
  mdxComponents: {} as never, // omit MDX support by passing an empty registry
  features,
});

for (const command of runtime.commands.list()) {
  console.log(command.id, command.title);
}
```

`runtime.keymaps.list()` returns every built-in shortcut with its `owner`:

- `owner: "editor"` — the editor installs the binding itself (`format.*`, `view.toggleSource`);
- anything else (the default) — the host installs it.

Dispatch a command with the actions your platform provides:

<!-- readme-check -->
```ts
import { createDocumentState, createEditorRuntime, createFeatureRegistry } from "@md-editor/core";

const runtime = createEditorRuntime({
  document: createDocumentState({ markdown: "" }),
  mdxComponents: {} as never,
  features: createFeatureRegistry(), // no features: the registry is empty
});

void runtime.commands.dispatch("file.save", {
  document: runtime.document,
  actions: {
    saveDocument: async () => {
      /* write the snapshot somewhere */
    },
  },
});
```

### Let users remap shortcuts

`resolveKeymaps()` is the only merge rule: `null` or a blank chord means *unbind*, unknown ids are
ignored. Feed the result to your keydown dispatcher and to the editor's `ports.setKeymaps()`.

<!-- readme-check -->
```ts
import { createBuiltInKeymaps, resolveKeymaps } from "@md-editor/core";

const effective = resolveKeymaps(createBuiltInKeymaps(), {
  "file.save": "Mod-Shift-s",
  "ai.fixGrammar": null, // explicitly unbound
});

console.log(effective.get("file.save")); // "Mod-Shift-s"
console.log(effective.has("ai.fixGrammar")); // false
```

Validate user input before storing it:

<!-- readme-check -->
```ts
import { validateKeymapKey } from "@md-editor/core";

console.log(validateKeymapKey("Mod-Shift-p")); // null (valid)
console.log(validateKeymapKey("Hyper-p")); // "Unknown modifier: Hyper"
```

Defaults live in one place. `MARKDOWN_FORMATTING_KEYMAPS` holds the formatting commands,
`createBuiltInKeymaps()` returns everything, and the two chord constants exist so you never copy a
literal:

<!-- readme-check -->
```ts
import {
  MARKDOWN_FORMATTING_KEYMAPS,
  OPEN_FOLDER_SHORTCUT,
  TOGGLE_SOURCE_SHORTCUT,
} from "@md-editor/core";

console.log(MARKDOWN_FORMATTING_KEYMAPS.length, TOGGLE_SOURCE_SHORTCUT, OPEN_FOLDER_SHORTCUT);
```

### Apply an external edit (AI, formatter)

External edits take a reservation first, so a queued composition cannot be clobbered mid-IME. The
renderer applies the text and returns a receipt; core finalizes it.

<!-- readme-check -->
```ts
import { createDocumentState } from "@md-editor/core";

const document = createDocumentState({ markdown: "# Hello" });
const snapshot = document.getSnapshot();

const reservation = document.reserveExternalEdit({
  operationId: "ai:continue",
  expectedGeneration: snapshot.documentGeneration,
  expectedContentRevision: snapshot.contentRevision,
});

if (reservation.status === "reserved") {
  // 1) call renderer.applyReservedExternalEdit(...) with the new text
  // 2) finalize with the receipt it returned
  // 3) release if you end up writing nothing
  document.releaseExternalEdit(reservation.reservation, "cancelled");
}
```

If you use the editor bridge, `ports.applyExternalEdit(request)` wraps all three steps.

### Inject content into a renderer

`synchronizeRendererEvent()` is what the bridge calls for every transition. You only need it when
you write your own renderer integration.

<!-- readme-check -->
```ts
import { createDocumentState, synchronizeRendererEvent, type RendererSyncPort } from "@md-editor/core";

declare const renderer: RendererSyncPort;
const document = createDocumentState({ markdown: "# Hello" });

const unsubscribe = document.subscribeTransitions((event) => {
  const delivery = synchronizeRendererEvent(document, renderer, event);
  if (delivery.status === "sync-error") console.error(delivery);
});

unsubscribe();
```

## API map

Everything below is exported from `@md-editor/core`.

### Document state

| Export | Purpose |
| --- | --- |
| `createDocumentState(input)` | Create the state machine (`markdown`, `mode?`, `filePath?`). |
| `DocumentState` (type) | `getSnapshot`, `subscribeSnapshot`, `subscribeTransitions`, `applyEditorChange`, `replaceDocument`, `setDocumentPath`, `commitMode`, `reserveExternalEdit`, `finalizeExternalEdit`, `releaseExternalEdit`, `beginSave`, `settleSave`, `isMutationBusy?`. |
| `DocumentSnapshot` (type) | Immutable view: `markdown`, `mode`, `filePath`, `documentGeneration`, `stateRevision`, `contentRevision`, dirty flags. |
| `switchEditorModeSafely(document, mode, options)` | Two-phase mode switch with automatic rollback. |
| `synchronizeRendererEvent(document, renderer, event)` | Reconcile a renderer with a core transition. |

### Save & history

| Export | Purpose |
| --- | --- |
| `executeDocumentSave(document, options)` | Runs the checkpoint → write → settle flow. |
| `markSaved(document, snapshot)` | Mark a snapshot as saved after an external write. |
| `computeDirtyState(document)` | `dirty` / `savedRevision` helpers for UI badges. |
| `isDiscardProtectionRequired(document)` | Whether closing would lose unsaved edits. |
| `resolveReplaceIntent(input)` | Decide create-vs-replace when opening a document. |
| `restoreDraftToDocument`, `revertDocumentToSnapshot` | Draft restore and history revert. |

### Commands, keymaps, features

| Export | Purpose |
| --- | --- |
| `createCommandRegistry()` | `register`, `unregister`, `dispatch`, `list`, `listByPlacement`, `listAvailable`. |
| `createKeymapRegistry()` | `register`, `unregister`, `list`, `findConflict`, `version`. |
| `createFeatureRegistry()` | Group commands + keymaps behind one `setup()` call. |
| `createEditorRuntime(input)` | Bundles document + commands + keymaps + features + MDX registry. |
| `createBuiltInEditorFeature()`, `createMarkdownFormattingFeature()`, `createEditorSearchFeature()`, `createAiWritingFeature()`, `createBlockCommandsFeature()` | Built-in feature descriptors. |
| `createBuiltInKeymaps()` | Full default keymap table (no runtime required). |
| `MARKDOWN_FORMATTING_KEYMAPS` | Formatting defaults (`KeymapDescriptor & { title }`). |
| `resolveKeymaps(base, overrides)` | Merge defaults with user overrides (`null`/blank = unbind). |
| `validateKeymapKey(key)` | Validate a chord string before storing it. |
| `TOGGLE_SOURCE_SHORTCUT`, `OPEN_FOLDER_SHORTCUT` | Chord constants so hosts never copy literals. |

### Markdown content

| Export | Purpose |
| --- | --- |
| `createEditorContent(markdown)`, `serializeEditorContent(content)` | Internal content model ↔ Markdown. |
| `serializeMarkdownDocument(...)`, `serializeWithRawFragments(...)` | Emit Markdown while preserving protected ranges. |
| `collectRawFragments(markdown)`, `getRawFragmentSaveSource(...)`, `updateRawMarkdown(...)` | Front matter / MDX / HTML protection. |
| `normalizeMarkdownForComparison(a, b)` | Compare while ignoring line endings and trailing newline. |
| `parseMarkdownFixture`, `roundTripMarkdownFixture` | Test helpers for Markdown fixtures. |
| `clampCursorOffset(text, offset)` | Safe cursor math for external edits. |
| `RawFragmentRangeError`, `externalEditReservationBrand` | Error type and reservation brand. |

## Related packages

- [`@md-editor/editor`](../editor/USAGE.md) — the CodeMirror view, React component and ports.
- [`@md-editor/plugin-sdk`](../plugin-sdk/USAGE.md) — plugin contract and syntax plugins.
- [`@md-editor/markdown-fidelity`](../markdown-fidelity/USAGE.md) — front matter, images, outline.
