---
"@md-editor/core": patch
"@md-editor/editor": patch
"@md-editor/plugin-sdk": patch
"@md-editor/plugin-host": patch
"@md-editor/markdown-fidelity": patch
"@md-editor/shared": patch
---

Ship a task-oriented usage guide with every public package.

Each package gains `USAGE.md` next to its README, and both ship in the tarball, so the npm page
leads somewhere: minimal setup first, then the recipes people actually need (theme an editor, wire
images and links, turn on lint, remap shortcuts, build a toolbar, write a plugin, validate a
package), then a grouped export map so you can find an entry point without reading the source.

The samples are compiled, not typed by hand: the documentation gate now checks `USAGE.md` files
alongside READMEs, and every marked block is type-checked against the workspace sources. Fifteen
blocks failed on the first run — `applyEdit({ text })` does not exist, `restoreMarkdownImageSources`
takes a source map, `plugin-host` has `/github` and `/mdx` subpaths — and were corrected against the
real signatures.

`KeymapDescriptor.owner`, `resolveKeymaps()`, `ports.setKeymaps()` and the built-in `Mod-/` binding
are documented here for the first time; the docs describe the current behaviour (an unbound chord
stays unbound, editor-owned chords need no host listener) rather than the pre-0.8 contract.
