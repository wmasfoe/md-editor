# Using `@md-editor/plugin-sdk`

Contract and TypeScript types for writing plugins: commands, keymaps, editor edits, settings, and
Markdown syntax extensions (math, diagrams, callouts). A plugin is a plain object with an
`activate(context)` function — this package ships types plus the helpers you need to build one;
`@md-editor/plugin-host` runs it.

- [Two kinds of plugins](#two-kinds-of-plugins)
- [Write a plugin](#write-a-plugin)
- [Register a command and a shortcut](#register-a-command-and-a-shortcut)
- [Edit the document](#edit-the-document)
- [Extend Markdown syntax](#extend-markdown-syntax)
- [Callout helpers](#callout-helpers)
- [API map](#api-map)

## Two kinds of plugins

| Kind | What it is | Where |
| --- | --- | --- |
| **Plugin** | `{ activate(context) }`, loaded by a host, can register syntax/commands/keymaps/settings and edit the document | `@md-editor/plugin-sdk` |
| **Syntax plugin** | A pure `MarkdownSyntaxPlugin` descriptor (Lezer extension + optional node policy or graphical editor) that both plugins and apps can pass to the editor | `@md-editor/plugin-sdk/syntax` |

If you only want to add syntax, you do not need the plugin runtime: hand the descriptor to the
editor's `plugins` prop.

## Write a plugin

<!-- readme-check -->
```ts
import { definePlugin } from "@md-editor/plugin-sdk";

export default definePlugin({
  activate(context) {
    context.commands.register({
      id: "demo.hello",
      title: "Insert greeting",
      run: async () => {
        const snapshot = context.editor.getSnapshot();
        await context.editor.applyEdit({
          markdown: `${snapshot.markdown}\nHello from a plugin`,
          expectedGeneration: snapshot.documentGeneration,
          expectedContentRevision: snapshot.contentRevision,
        });
      },
    });

    // Return a disposer; the host calls it when the plugin unloads.
    const { signal } = context;
    return () => void signal;
  },
});
```

`context` gives you:

| Member | Purpose |
| --- | --- |
| `manifest` | The plugin's own metadata (`id`, `name`, `version`, …). |
| `signal` | `AbortSignal` aborted on unload; use it for timers and fetches. |
| `syntax.register(plugin)` | Add a `MarkdownSyntaxPlugin` (see below). |
| `commands.register(command)` | Add a command to the host's palette and menus. |
| `keymaps.register(keymap)` | Add a shortcut (`Mod` = ⌘ / Ctrl). |
| `editor.getSnapshot()` | Read Markdown, mode, selection — no privileges beyond reading. |
| `editor.applyEdit(request)` | Write through the host's external-edit protocol (reservation + receipt). |
| `settings.get()` / `settings.update(patch)` | Read and persist plugin settings. |
| `dependencies` | The pinned CodeMirror/Lezer packages the plugin must import from. |

Use `context.dependencies.*` instead of importing CodeMirror yourself: the host guarantees those
instances match the editor's, and duplicated copies break syntax nodes.

## Register a command and a shortcut

<!-- readme-check -->
```ts
import { definePlugin, type PluginCommand, type PluginKeymap } from "@md-editor/plugin-sdk";

export default definePlugin({
  activate(context) {
    // `run()` takes no arguments: capture what you need from the activation context.
    const command: PluginCommand = {
      id: "demo.strikeTodo",
      title: "Strike through TODO lines",
      run: async () => {
        const snapshot = context.editor.getSnapshot();
        await context.editor.applyEdit({
          markdown: snapshot.markdown.replace(/^- TODO/gm, "- ~~TODO~~"),
          expectedGeneration: snapshot.documentGeneration,
          expectedContentRevision: snapshot.contentRevision,
        });
      },
    };

    const keymap: PluginKeymap = {
      id: "demo.strikeTodo",
      key: "Mod-Shift-d",
      commandId: "demo.strikeTodo",
    };

    context.commands.register(command);
    context.keymaps.register(keymap);
  },
});
```

Hosts validate the package before activating it (`validatePluginPackage`) and reject duplicate
command ids or chords rather than letting two plugins silently fight.

## Edit the document

`editor.applyEdit` is the only write path, and it is deliberately coarse: the host reserves an
external edit, the renderer applies it, core finalizes it. Concurrent user typing wins — your edit
returns a status instead of throwing.

<!-- readme-check -->
```ts
import { definePlugin } from "@md-editor/plugin-sdk";

export default definePlugin({
  activate(context) {
    void (async () => {
      const snapshot = context.editor.getSnapshot();
      await context.editor.applyEdit({
        markdown: `${snapshot.markdown}\n<!-- appended by plugin -->`,
        expectedGeneration: snapshot.documentGeneration,
        expectedContentRevision: snapshot.contentRevision,
        selection: "preserve-offset-clamped",
      });
    })();
  },
});
```

Keep edits small and idempotent: hosts may retry after an IME composition settles.

## Extend Markdown syntax

<!-- readme-check -->
```ts
import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";

export const strikeTodoSyntax: MarkdownSyntaxPlugin = {
  id: "demo.strike-todo",
  name: "TODO strike-through",
  nodePolicy: { nodeName: "Strikethrough", kind: "strikethrough", isBlock: false },
};
```

A full syntax plugin adds a Lezer `markdownExtension`, optional inline node policy, and optionally a
`graphicalEditor` for fenced code blocks. `@md-editor/syntax-plugins` in this repository contains
production examples (math, Mermaid, directives).

Register it from a plugin with `context.syntax.register(plugin)`, or pass it straight to the editor:

<!-- readme-check -->
```tsx
import { useState } from "react";
import { createDocumentState } from "@md-editor/core";
import { CodeMirrorEditor } from "@md-editor/editor/react";
import type { MarkdownSyntaxPlugin } from "@md-editor/plugin-sdk/syntax";

const plugin: MarkdownSyntaxPlugin = { id: "demo", name: "Demo" };

export function WithSyntax() {
  const [document] = useState(() => createDocumentState({ markdown: "demo" }));
  return <CodeMirrorEditor document={document} plugins={[plugin]} />;
}
```

## Callout helpers

Shared data for callout UIs, so an app and a plugin render the same icons and titles:

<!-- readme-check -->
```ts
import { CALLOUT_SVG_ICONS, defaultCalloutTitle, getCalloutSvg } from "@md-editor/plugin-sdk/callout";

console.log(Object.keys(CALLOUT_SVG_ICONS));
console.log(defaultCalloutTitle("warning"));
console.log(getCalloutSvg("warning")?.slice(0, 4));
```

CJK-friendly Markdown helpers live in `/syntax` when you need emphasis that respects Chinese and
Japanese punctuation:

<!-- readme-check -->
```ts
import { CJK_FRIENDLY_MARKDOWN_EXTENSIONS, resolveCjkFriendlyDelimiterSides } from "@md-editor/plugin-sdk/syntax";

console.log(CJK_FRIENDLY_MARKDOWN_EXTENSIONS.length);
// marker 只能是 "*" / "_" / "~" / "="；neighbors 是相邻码点（行首/行尾为 null）
console.log(resolveCjkFriendlyDelimiterSides("*", { before: "中".codePointAt(0) ?? null, beforePrevious: null, after: "文".codePointAt(0) ?? null }));
```

## API map

| Entry | Contents |
| --- | --- |
| `@md-editor/plugin-sdk` | `definePlugin`, and the types a plugin needs: `PluginDefinition`, `PluginContext`, `PluginManifest`, `PluginCommand`, `PluginKeymap`, `PluginEditRequest`, `PluginEditResult`, `PluginEditorSnapshot`, `PluginSettingValue`, `PluginSettingSchema`, `Disposable`. |
| `@md-editor/plugin-sdk/syntax` | `MarkdownSyntaxPlugin`, `SyntaxPluginRegistry`, `syntaxPluginHostPortsFacet`, `GraphicalCodeBlockEditorProvider`, `CJK_FRIENDLY_MARKDOWN_EXTENSIONS`, `cjkFriendlyEmphasisMarkdownExtension`, `cjkFriendlyStrikethroughMarkdownExtension`, `readDelimiterNeighbors`, `resolveCjkFriendlyDelimiterSides`, plus the callout helpers re-exported below. |
| `@md-editor/plugin-sdk/callout` | `CALLOUT_SVG_ICONS`, `defaultCalloutTitle`, `getCalloutSvg`. |

The package has almost no runtime: `definePlugin` is an identity function that exists so your
definition is type-checked in place.

## Related packages

- [`@md-editor/plugin-host`](../plugin-host/USAGE.md) — validating and running plugins.
- [`@md-editor/editor`](../editor/USAGE.md) — the `plugins` prop and `syntaxPluginHostPorts`.
