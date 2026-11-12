# @md-editor/core

The editor's domain model: document state, the command and keymap registries, and the editor runtime that ties them together. It does not depend on the DOM, CodeMirror or React, so the same code runs in the desktop app, the web playground and the uTools plugin.

It depends only on `@md-editor/shared` and `@md-editor/plugin-sdk`. It does not import `@md-editor/ai`. AI results reach it as plain data or command arguments, and network and model handling stay in the AI package. See the [capability boundaries](../../docs/agent/architecture/capability_boundary_design_principles.md).

## Install

```bash
npm install @md-editor/core
```

The package ships ESM JavaScript and TypeScript declarations. Its workspace
dependencies are installed automatically; a TypeScript source loader is not needed.

## Document state

`createDocumentState` returns the single source of truth for one open document.

```typescript
import { createDocumentState } from "@md-editor/core";

const doc = createDocumentState({
  markdown: "# Hello Inkpoint",
  filePath: "/notes/sample.md", // omit for an unsaved document
  mode: "wysiwyg", // or "source"
});

doc.subscribeSnapshot(() => {
  console.log("dirty:", doc.getSnapshot().isDirty);
});
```

A snapshot holds `markdown`, `savedMarkdown`, `filePath`, `mode`, `isDirty`, a document generation that increases whenever the document is replaced, and revision counters.

The state machine also handles:

- editor changes, which carry an origin so a renderer ignores its own echo (`applyEditorChange`);
- replacing the whole document and changing its path (`replaceDocument`, `setDocumentPath`);
- switching between WYSIWYG and source (`commitMode`, `switchEditorModeSafely`);
- external edits from plugins or AI, which reserve the document first and fail if it changed meanwhile (`reserveExternalEdit`, `finalizeExternalEdit`);
- saves, tracked as checkpoints so a late result cannot mark a newer edit as saved (`beginSave`, `settleSave`).

## Commands and keymaps

```typescript
import { createCommandRegistry } from "@md-editor/core";

const commands = createCommandRegistry();

commands.register({
  id: "format.bold",
  title: "Bold",
  placement: ["toolbar", "command-palette"], // also "editor-menu"
  keywords: ["strong"],
  when: (context) => context.document.getSnapshot().mode === "wysiwyg",
  run: (context) => {
    // ...
  },
});

await commands.dispatch("format.bold", { document: doc });
```

`list`, `listByPlacement` and `listAvailable` feed the toolbar, the command palette and menus from the same data. A command without `placement` appears in none of them. `when` decides whether a command is available, and a `when` that throws counts as unavailable.

`createKeymapRegistry` binds keys to command ids and reports conflicts with `findConflict`. `validateKeymapKey` checks a key string such as `Mod-Shift-H`.

## Editor runtime

`createEditorRuntime` combines a document, the command, keymap and feature registries and the MDX component registry. The built-in commands (file, view, formatting, search, block, lint, AI) are registered by `createBuiltInEditorFeature`, `createMarkdownFormattingFeature`, `createEditorSearchFeature`, `createBlockCommandsFeature` and `createAiWritingFeature`.

## Raw fragments

`collectRawFragments` and `serializeWithRawFragments` find the parts of a document that must be written back unchanged: front matter, HTML blocks, MDX components, MDX imports and expressions, and code fences.

## Development

```bash
pnpm test
pnpm typecheck
```
