---
"@md-editor/core": minor
---

Give built-in shortcuts a single table and an explicit owner.

Default chords existed in six places, and they had already drifted: desktop spelled them with an
uppercase main key (`Mod-F`) where core used `Mod-f`, and the web shell claimed `Mod-b` for
"toggle sidebar" while the formatting table claimed the same chord for bold — so one `⌘B` meant
different things in different hosts.

Three additions make the table authoritative:

- `KeymapDescriptor.owner` (`"editor" | "host"`, default `"host"`) states who installs the
  keydown listener. Chords that belong to the host must not be bound by the editor at all;
  otherwise a host listening in the bubble phase never sees them.
- `MARKDOWN_FORMATTING_KEYMAPS` is the one place the formatting defaults are written. It is
  shaped as `KeymapDescriptor & { title }`, so `createMarkdownFormattingFeature()`, the editor,
  the desktop shortcut settings and the web cheat sheet all read the same rows.
- `createBuiltInKeymaps()` returns the full built-in table (commands without a `Runtime`),
  and `resolveKeymaps(base, overrides)` merges defaults with user overrides under one rule:
  `null` or a blank chord means *unbind* (the id is dropped), unknown ids are ignored.

`KeymapDescriptor` moved to `src/keymap.ts` and is re-exported from the package root, so existing
imports keep working.
