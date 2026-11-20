---
"@md-editor/editor": patch
---

Avoid a synchronous full-document parse on every keystroke. `readCoverage` no longer calls `ensureSyntaxTree` on the incremental update path; parse decisions stay in `requiresCompleteParse`, and dirty-range expansion now locates candidates with binary search instead of scanning every record. Also re-measure table overflow when fonts load after mount, not just once via `document.fonts.ready`.
