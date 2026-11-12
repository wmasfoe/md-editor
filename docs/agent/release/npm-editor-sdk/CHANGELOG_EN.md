# npm Editor SDK changelog

Purpose: record npm versions and consumer changes for core/editor and their required dependencies. These versions were published to npm on 2026-11-12.

## core 0.1.0 / editor 0.1.0

- First standalone distribution of document state, transactions, commands and editor runtime, plus the CodeMirror 6 Markdown source/WYSIWYG editor.
- The optional editor `/react` entrypoint includes component styles. The base entrypoint does not depend on React, application UI, application i18n or Tauri.
- Ship consumable ESM JavaScript, TypeScript declarations, CSS and license text without workspace sources or a TypeScript runtime loader.
- Terminal Mermaid blocks and nested blocks in quotes/lists share virtual-line and source-navigation behavior.
- editor requires plugin-sdk `^0.2.0`; the published SDK 0.1.0 does not provide all required interfaces.

## plugin-sdk 0.2.0

- Add the `/callout` plain-data entrypoint for consumers without DOM or CodeMirror dependencies.
- Expose CJK syntax extensions, `SyntaxPluginHostPorts` and `syntaxPluginHostPortsFacet` through `/syntax` so hosts can inject interaction capabilities.
- Keep the root and `/mdx` contracts independent. Hosts using `/syntax` must install that entrypoint's optional peers.

## Required dependency initial releases

- shared 0.1.0: lightweight utilities shared across packages.
- markdown-fidelity 0.1.0: Markdown/frontmatter preservation, heading anchors and related utilities; a direct editor dependency.
- plugin-host 0.1.0: plugin registration and loading; a direct editor dependency.

## Imports and runtime requirements

- Import callout and CJK syntax helpers from `@md-editor/plugin-sdk/callout` or `/syntax`; editor/compiler no longer forward these exports.
- editor requires a browser DOM, a CSS-capable bundler and modern JavaScript APIs including `toSorted`. React hosts need React `>=18.3.0 <20`.
- compiler and syntax-plugins are deferred. Application-specific private packages are excluded from publication.
