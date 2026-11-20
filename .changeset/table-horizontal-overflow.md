---
"@md-editor/editor": patch
---

Fix tables overflowing the editor with a page-level horizontal scrollbar. Tables now adapt to the content column, wrap long cells, and fall back to scrolling inside the table itself when columns cannot shrink further; row/column handles and column resizing stay usable in both states.
