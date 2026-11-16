---
"@md-editor/core": minor
"@md-editor/editor": minor
"@md-editor/plugin-sdk": minor
---

Add default-layout Mermaid diagram creation and editing with editor-owned draft sessions and isolated undoable updates.

Keep diagram viewing and editing as the two block actions, with compact contextual tools outside the diagram viewport and single-step connection forms.

Support explicit drag-to-connect tools, geometry-based selection feedback, and cascading deletion of incident edges or messages while preserving surviving entities and styles.

Load the diagram canvas dependency on demand so hosts that never render a diagram no longer pay for it at startup.

Connect flowchart nodes by dragging a handle from the selected node's edges onto a target node, replacing the toolbar connect mode and its source/target form. Double-click a node to edit its label in place, and double-click empty canvas to append a node through the same validated form.
