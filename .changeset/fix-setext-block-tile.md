---
"@md-editor/editor": patch
"@md-editor/plugin-sdk": patch
---

Require @codemirror/view 6.43.15 and @codemirror/state 6.7.6 so multiline block widgets, including an empty setext heading, no longer corrupt the editor tile tree during composition updates.
