---
"@md-editor/editor": patch
"@md-editor/plugin-sdk": patch
---

Require @codemirror/view 6.43.15 and @codemirror/state 6.7.6 so multiline block widgets, including an empty setext heading, no longer corrupt the editor tile tree during composition updates. The plugin-sdk peer floors were raised to @codemirror/state ^6.7.6 and @codemirror/view ^6.43.15, so external plugins still on older CodeMirror will get peer warnings.
