# @md-editor/plugin-host

## 0.2.0

### Minor Changes

- c4221f5: Add optional command descriptions and suggested shortcuts, explicit contribution ownership, and reusable user-managed command bindings. Preserve existing user overrides while leaving plugin suggestions unbound by default.
  
  Isolate runtime shortcut registration failures without disabling plugin commands and roll back failed suggestion registrations.

### Patch Changes

- Updated dependencies [c4221f5]
  - @md-editor/plugin-sdk@0.4.0

## 0.1.1

### Patch Changes

- 2088201: Clarify public package documentation and metadata, and declare the plugin SDK's type dependencies as required peers.
- Updated dependencies [2088201]
  - @md-editor/plugin-sdk@0.3.0
