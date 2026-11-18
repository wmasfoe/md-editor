---
"@md-editor/core": minor
---

`restoreDraftToDocument` now accepts a `cursorOffset` option and returns the clamped offset, so hosts can restore the caret when recovering an unsaved Hot Exit draft. Previously the persisted cursor was written but never read back, leaving every restored draft with the caret at the document start. Offsets past the draft length clamp to the end, negative and non-finite values fall back safely.
