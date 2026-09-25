# Changelog - Web Playground

All notable changes to the Inkpoint Web Playground will be documented in this file.

## 0.1.3 - 2026-09-25 (#128, #129, #130, #131, #132)

- Fixed: Tab in body text did not indent and moved focus out of the editor (now a two-space line indent with focus kept; Shift-Tab outdents; protected regions are untouched)
- Fixed: bare links, angle autolinks and reference-style links could not be edited or deleted
- New: Cmd/Ctrl + left click opens links in the system default browser (bare / angle / inline / reference-style; dangerous protocols rejected)

## 0.1.2 - 2026-09-18 (#90)

- Silenced success toast notifications for ordinary operations to optimize the immersive writing experience.

## 0.1.1 - 2026-09-18 (#88, #89)

- Fixed severe viewport jumps and cursor loss when toggling between WYSIWYG and Source modes in scrolled documents, achieving pixel-stable transitions.
- Fixed a phantom extra empty line rendered visually above thematic breaks (`---`) and cursor vertical drift.
- Fixed image zoom viewer button escaping to the top-right corner of the editor viewport, and hidden when preview is absent.
- Fixed unwanted blue text selection background rendered above thematic break block widgets.

## 0.1.0 - 2026-09-09

- Initial public release of Inkpoint Web Playground
- Built on a single CodeMirror 6 state stack isomorphic to the desktop app, with zero-latency switching between WYSIWYG and Source modes
- Built-in official MDX interactive components (Callout alerts, code syntax highlighting, GFM tables, task lists) out of the box
- Clean, full-width canvas design focusing purely on the writing experience without a file tree
- Top bar lightweight dark/light theme toggle and settings modal (100% aligned with desktop configuration options)
- Pure client-side integration with OpenAI-compatible APIs and DeepSeek via native fetch, supporting inline ghost text completions at the cursor
- Draft auto-persistence and accident recovery via localStorage
- Real-time table of contents (TOC) slide-over drawer with keyboard shortcut navigation
