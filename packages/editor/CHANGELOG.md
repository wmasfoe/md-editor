# @md-editor/editor

## 0.2.3

### Patch Changes

- b231e08: Require @codemirror/view 6.43.15 and @codemirror/state 6.7.6 so multiline block widgets, including an empty setext heading, no longer corrupt the editor tile tree during composition updates. The plugin-sdk peer floors were raised to @codemirror/state ^6.7.6 and @codemirror/view ^6.43.15, so external plugins still on older CodeMirror will get peer warnings.
- Updated dependencies [b231e08]
  - @md-editor/plugin-sdk@0.4.1

## 0.2.2

### Patch Changes

- 52bd6f3: Reveal editable Markdown source when clicking a container directive header.
  Keep callout headers within a single text line so source disclosure does not shift the body.
  Balance callout insets and remove the extra empty line reserved for inactive closing fences.
  Allow GFM alert headers to reveal and edit their original Markdown through pointer and keyboard navigation.
  A callout at the beginning of a document now shows its header source immediately when the initial caret is on that line.

## 0.2.1

### Patch Changes

- Updated dependencies [c4221f5]
  - @md-editor/plugin-sdk@0.4.0
  - @md-editor/plugin-host@0.2.0
  - @md-editor/core@0.2.1

## 0.2.0

### Minor Changes

- 6d9509a: Add a platform-independent document save use case and prepared image insertion with stale-document guards, selection replacement, and atomic undo support.

### Patch Changes

- 6d9509a: Restore the native text caret in editable table cells instead of inheriting the main editor's transparent caret color.
- Updated dependencies [6d9509a]
  - @md-editor/core@0.2.0

## 0.1.1

### Patch Changes

- 2088201: Clarify public package documentation and metadata, and declare the plugin SDK's type dependencies as required peers.
- Updated dependencies [2088201]
  - @md-editor/core@0.1.1
  - @md-editor/markdown-fidelity@0.1.1
  - @md-editor/plugin-host@0.1.1
  - @md-editor/plugin-sdk@0.3.0
  - @md-editor/shared@0.1.1
