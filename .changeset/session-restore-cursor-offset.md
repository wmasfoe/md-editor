---
"@md-editor/core": minor
---

`restoreDraftToDocument` now accepts a `cursorOffset` option and returns the clamped offset, so hosts can restore the caret when recovering an unsaved Hot Exit draft. Previously the persisted cursor was written but never read back, leaving every restored draft with the caret at the document start.

Clamping uses the LF-normalized length, matching what the document model actually stores, so CRLF drafts cannot produce an unreachable upper bound. Over-length offsets clamp to the end; negative values clamp to zero; absent or non-finite values fall back to the end.
