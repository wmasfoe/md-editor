# @md-editor/plugin-sdk

Public contract and TypeScript types for building **Inkpoint** (md-editor) plugins.

This package is the stable, app-decoupled surface that plugin authors import. It
contains plugin definitions, the `PluginContext` API, the manifest/catalog shapes,
and the syntax/MDX contribution types. It ships **only types plus a single identity
helper** (`definePlugin`) — it does not bundle the editor, CodeMirror, or Lezer
runtimes. Those are injected by the host at runtime via `context.dependencies`.

## Install

```bash
npm install -D @md-editor/plugin-sdk
# or: pnpm add -D @md-editor/plugin-sdk
```

CodeMirror / Lezer are declared as **optional peer dependencies**. You only need
them installed if you author syntax plugins and reference their types directly;
command/keymap/template plugins do not need them.

## Usage

```ts
import { definePlugin } from "@md-editor/plugin-sdk";

export default definePlugin({
  activate(context) {
    context.commands.register({
      id: "author.weekly.insert", // contribution IDs must start with "<plugin id>."
      title: "Insert weekly note",
      async run() {
        const snapshot = context.editor.getSnapshot();
        await context.editor.applyEdit({
          markdown: snapshot.markdown + "\n\n## This week\n",
          expectedGeneration: snapshot.documentGeneration,
          expectedContentRevision: snapshot.contentRevision,
          selection: "end",
        });
      },
    });
    // Optionally return a cleanup function run on deactivate.
  },
});
```

## Entry points

| Import | Contents |
|---|---|
| `@md-editor/plugin-sdk` | `definePlugin`, `PluginDefinition`, `PluginContext`, manifest/catalog/package types, command/keymap/settings/editor types |
| `@md-editor/plugin-sdk/syntax` | `MarkdownSyntaxPlugin` and the Markdown range/policy/metadata types for syntax contributions |
| `@md-editor/plugin-sdk/callout` | Callout icons and default titles. Pure data, no CodeMirror. Use this from Node/JSC exporters |
| `@md-editor/plugin-sdk/mdx` | MDX component descriptor and registry contract types |

## Getting started

Fork the starter template to scaffold, build, and publish plugins through GitHub
Releases: <https://github.com/wmasfoe/inkpoint-plugin-starter>

## License

GPL-3.0-or-later.
