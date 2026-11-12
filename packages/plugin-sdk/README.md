# @md-editor/plugin-sdk

Public contract and TypeScript types for building **Inkpoint** (md-editor) plugins.

This package provides an app-decoupled surface for plugin authors. It
contains plugin definitions, the `PluginContext` API, the manifest/catalog shapes,
and the syntax/MDX contribution types. The root and `/mdx` entrypoints are
lightweight contracts; `/callout` provides plain data and helpers without DOM or
CodeMirror dependencies. `/syntax` also provides executable syntax helpers and
the host-ports facet. The package does not bundle the editor or its peer runtimes.

## Install

```bash
npm install @md-editor/plugin-sdk
# or: pnpm add @md-editor/plugin-sdk
```

CodeMirror, Lezer and the CJK utility are peer dependencies. The root TypeScript
contract references their types, and `/syntax` uses some of them at runtime.
Install compatible peer versions when your package manager does not install peers
automatically. Keep the SDK as a runtime dependency if your output imports
`definePlugin`; it can be a dev dependency only when your build bundles it.

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

Fork the starter, or click **Use this template** on GitHub, to scaffold, build, and
publish plugins through GitHub Releases:
<https://github.com/inkpoint-editor/inkpoint-plugin-starter>

## License

GPL-3.0-or-later.
