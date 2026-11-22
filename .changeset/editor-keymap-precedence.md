---
"@md-editor/editor": patch
---

Stop CodeMirror's default keymap from overriding documented editor and host shortcuts.

Three collisions were reproduced in a real browser against a bare `CodeMirrorEditor` mount
(no host keybindings), and all three silently disagreed with the shortcut tables:

- **`Mod-/` inserted HTML comments instead of leaving the chord alone.** `packages/core`
  declares `Mod-/` as `view.toggleSource`, but `@codemirror/commands` binds the same chord to
  `toggleComment`, and `@codemirror/lang-markdown` supplies block comment tokens, so pressing
  it rewrote the line to `<!-- … -->`. Hosts had to swallow the key in the capture phase to
  make their own binding work — an implementation detail leaking into the contract.
- **`Mod-Shift-k` deleted the whole line instead of inserting a code block.** The formatting
  keymap binds that chord to `insertCodeBlock` (the documented backup for `Mod-Shift-c`), but
  it was assembled *after* `defaultKeymap`, and the `keymap` facet dispatches in assembly
  order, so upstream `deleteLine` won.
- **`Mod-i` only worked by luck.** Upstream `selectParentSyntax` claimed the chord; it
  happened to return `false`, and its binding carries `preventDefault: true`, so the event was
  consumed even though nothing happened.

Keymaps now have an explicit ownership policy. Chords that belong to the *host* (mode
switching, save, open, settings) are dropped from the editor's copy of `defaultKeymap` by a
new admission layer (`renderer/controller/default-keymap-policy.ts`) instead of being
swallowed: the editor installs no binding at all, so keydown reaches the host even when the
host binds in the bubble phase. Chords that belong to the *editor* (bold, italic, links, code
blocks) are installed with `Prec.high`, which outranks `defaultKeymap` but stays below the
editor's own `Prec.highest` bindings (the `Tab` arbiter and the HTML source-block keymap) and
leaves room for a host or plugin to outrank them. The precedence lives inside
`createMarkdownFormattingKeymap`, so the runtime `setFormattingKeymaps` reconfiguration
inherits it — otherwise customizing one shortcut would drop back to the default level and
start deleting lines again.

One **intended** consequence goes beyond the three bugs: the formatting layer now also outranks
`searchKeymap`, so `Mod-Shift-l` wraps the selection in a link instead of running the search
package's `selectSelectionMatches`. That matches the shortcut table, which already documents
`Mod-l`/`Mod-Shift-l` as the link commands. The same holds for `historyKeymap`: a *custom*
formatting shortcut takes precedence over undo/redo, so remapping a formatting command onto
`Mod-z` will shadow undo — hosts exposing a shortcut editor should warn about that.

Chord comparison is normalization-aware: upstream writes `Shift-Mod-k` where the formatting
table writes `Mod-Shift-k`, and both dispatch as the same chord. Chords are split with
`/-(?!$)/`, matching CodeMirror's own `normalizeKeyName`, so a binding whose main key is `-`
(`Mod--`) is compared correctly.
