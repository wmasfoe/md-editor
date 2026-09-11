# Changelog - Web Playground

All notable changes to the Inkpoint Web Playground will be documented in this file.

## 0.1.0 - 2026-09-09

- Initial public release of Inkpoint Web Playground
- Built on a single CodeMirror 6 state stack isomorphic to the desktop app, with zero-latency switching between WYSIWYG and Source modes
- Built-in official MDX interactive components (Callout alerts, code syntax highlighting, GFM tables, task lists) out of the box
- Clean, full-width canvas design focusing purely on the writing experience without a file tree
- Top bar lightweight dark/light theme toggle and settings modal (100% aligned with desktop configuration options)
- Pure client-side integration with OpenAI-compatible APIs and DeepSeek via native fetch, supporting inline ghost text completions at the cursor
- Draft auto-persistence and accident recovery via localStorage
- Real-time table of contents (TOC) slide-over drawer with keyboard shortcut navigation
