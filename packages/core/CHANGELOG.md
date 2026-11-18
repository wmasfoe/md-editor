# @md-editor/core

## 0.3.1

### Patch Changes

- Updated dependencies [27a6557]
  - @md-editor/plugin-sdk@0.6.0

## 0.3.0

### Minor Changes

- 68ed9ef: Add default-layout Mermaid diagram creation and editing with editor-owned draft sessions and isolated undoable updates.
  
  Keep diagram viewing and editing as the two block actions, with compact contextual tools outside the diagram viewport and single-step connection forms.
  
  Support explicit drag-to-connect tools, geometry-based selection feedback, and cascading deletion of incident edges or messages while preserving surviving entities and styles.
  
  Load the diagram canvas dependency on demand so hosts that never render a diagram no longer pay for it at startup.
  
  Connect flowchart nodes by dragging a handle from the selected node's edges onto a target node, replacing the toolbar connect mode and its source/target form. Double-click a node to edit its label in place, and double-click empty canvas to append a node through the same validated form.

### Patch Changes

- Updated dependencies [68ed9ef]
  - @md-editor/plugin-sdk@0.5.0

## 0.2.1

### Patch Changes

- Updated dependencies [c4221f5]
  - @md-editor/plugin-sdk@0.4.0

## 0.2.0

### Minor Changes

- 6d9509a: Add a platform-independent document save use case and prepared image insertion with stale-document guards, selection replacement, and atomic undo support.

## 0.1.1

### Patch Changes

- 2088201: Clarify public package documentation and metadata, and declare the plugin SDK's type dependencies as required peers.
- Updated dependencies [2088201]
  - @md-editor/plugin-sdk@0.3.0
  - @md-editor/shared@0.1.1
