---
"@md-editor/editor": patch
---

Make incremental Markdown index updates linear instead of quadratic. Reused records and rebuilt ranges are now merged in one pass rather than inserted one by one into a sorted array, and coverage is projected from the previous index instead of re-measured. On an 800-block document this drops the per-keystroke cost from ~51ms to ~9ms.
