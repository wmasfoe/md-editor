---
"@md-editor/editor": minor
---

Bind `Mod-/` inside the editor so hosts no longer implement mode switching themselves.

`createCodeMirrorEditorBridge` now supplies `onToggleSourceMode` to the renderer, and the
editor's keymap binds `Mod-/` to it. The callback runs the same two-phase switch the port
exposes (`switchEditorModeSafely`: renderer applies → core commits with CAS → rollback on
failure), so mounting `<CodeMirrorEditor>` is enough — no `window` listener, no capture-phase
trick to outrun CodeMirror. Hosts that still bind the chord themselves keep working: their
`preventDefault` makes CodeMirror skip the event, so nothing runs twice.

`ports.setFormattingKeymaps()` is renamed to `ports.setKeymaps()`. The map is no longer
only about formatting: `view.toggleSource` is an editor-owned command too, and its chord is
read from the same table, so remapping mode switching in a host's shortcut settings takes
effect instead of leaving the built-in binding on the default chord. There is no deprecated
alias; call sites move to the new name.

Renderer option `onToggleSourceMode` is added for hosts that assemble
`createCodeMirrorRenderer` directly; without it the chord is not bound at all (the renderer
has no `DocumentState`, so it cannot switch modes on its own).

Two consequences worth knowing:

- The chord now only fires while the editor has focus. A host that listened on `window` used to
  toggle the mode from the sidebar or a toolbar; inside the editor it is CodeMirror's keymap that
  dispatches, so focus decides. Hosts that want the old reach should keep their own listener — it
  still wins over the built-in one (their `preventDefault` makes CodeMirror skip the event).
- A failed switch is no longer silent. `CodeMirrorEditorSyncError` gains a `"mode-switch"` variant
  carrying the failed `ModeSwitchResult`, reported through the existing `onSyncError` channel, so a
  host can surface the same toast it used to show. Exhaustive `switch` statements over the union
  need one more case.
