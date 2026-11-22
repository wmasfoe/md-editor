---
"@md-editor/editor": minor
---

Take formatting defaults from `@md-editor/core` and treat the port table as authoritative.

`createMarkdownFormattingBindings()` used to carry its own copy of every default chord
(`getKey("format.bold", "Mod-b")`), duplicating `@md-editor/core`'s table. The defaults now come
from `MARKDOWN_FORMATTING_KEYMAPS`, so there is exactly one place to change them.

The map handed to `setFormattingKeymaps()` is now the **authoritative** table: an id missing from
it means that command has no chord, and the editor no longer falls back to the default. Hosts are
expected to pass `resolveKeymaps(createBuiltInKeymaps(), overrides)`, which is what makes
"unbind" actually unbind — a fixed alias such as `Mod-Shift-k` for `format.codeBlock` disappears
along with its command instead of lingering after the user removed it.

Callers that previously passed a partial map (only the chords they wanted to change) must merge
defaults first; passing no map at all still means "all defaults".
