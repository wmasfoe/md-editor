# @md-editor/plugin-sdk

Public contract and TypeScript types for building **Inkpoint** (md-editor) plugins.

This package is the stable, app-decoupled surface that plugin authors import. It
contains plugin definitions, the `PluginContext` API, the manifest/catalog shapes,
and the syntax/MDX contribution types. The root and `/mdx` entrypoints are
lightweight contracts; `/callout` provides plain data and helpers without DOM or
CodeMirror dependencies. `/syntax` also provides executable syntax helpers and
the host-ports facet, so syntax consumers need its optional CodeMirror, Lezer and
CJK utility peers. The package does not bundle the editor or those runtimes.

## Install

```bash
npm install -D @md-editor/plugin-sdk
# or: pnpm add -D @md-editor/plugin-sdk
```

CodeMirror, Lezer and the CJK utility are declared as **optional peer dependencies**.
Install them when using `/syntax` at runtime or referencing its declarations;
command/keymap/template plugins using only the root do not need them.

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

[inkpoint-plugin-starter](https://github.com/inkpoint-editor/inkpoint-plugin-starter) and the
on-device model repository
[md-editor-models](https://github.com/inkpoint-editor/md-editor-models) now belong to the
inkpoint-editor organization. They moved from `wmasfoe/inkpoint-plugin-starter` and
`wmasfoe/md-editor-models`; those old addresses redirect automatically. The model
repository's default branch is `master`.

## License

GPL-3.0-or-later.
