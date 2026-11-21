---
"@md-editor/editor": patch
---

Fix the editor content being shifted right on narrower windows. The content padding floors are now symmetric (`2.5rem` on both sides) instead of `5.5rem` left / `1.25rem` right, so the text column stays centered and no longer hugs the scrollbar; the left floor still covers the fold toggle gutter.
