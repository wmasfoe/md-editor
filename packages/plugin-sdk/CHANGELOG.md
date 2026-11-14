# @md-editor/plugin-sdk

## 0.4.1

### Patch Changes

- b231e08: Require @codemirror/view 6.43.15 and @codemirror/state 6.7.6 so multiline block widgets, including an empty setext heading, no longer corrupt the editor tile tree during composition updates. The plugin-sdk peer floors were raised to @codemirror/state ^6.7.6 and @codemirror/view ^6.43.15, so external plugins still on older CodeMirror will get peer warnings.

## 0.4.0

### Minor Changes

- c4221f5: Add optional command descriptions and suggested shortcuts, explicit contribution ownership, and reusable user-managed command bindings. Preserve existing user overrides while leaving plugin suggestions unbound by default.
  
  Isolate runtime shortcut registration failures without disabling plugin commands and roll back failed suggestion registrations.

## 0.3.0

### Minor Changes

- 2088201: Clarify public package documentation and metadata, and declare the plugin SDK's type dependencies as required peers.
