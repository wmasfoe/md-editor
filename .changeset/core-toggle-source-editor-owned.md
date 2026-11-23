---
"@md-editor/core": minor
---

Make `view.toggleSource` an editor-owned command and expose its default chord.

Mode switching is a two-phase protocol (renderer applies, core then commits with a
compare-and-swap, renderer rolls back on failure). The bridge holds both halves, so it can
perform the whole switch itself — but the chord was marked as host-owned, which forced every
host to re-implement that protocol behind its own keydown listener. One host did it by
listening in the capture phase to outrun CodeMirror's `defaultKeymap`, which is exactly the
kind of detail that should not leak into the contract.

- `view.toggleSource` is registered with `owner: "editor"`, so the editor installs the binding
  and hosts stop writing keyboard code for it.
- `TOGGLE_SOURCE_SHORTCUT` (`"Mod-/"`) exposes the default chord, following the existing
  `OPEN_FOLDER_SHORTCUT` precedent, so the registration and the editor's built-in binding
  cannot drift apart.
