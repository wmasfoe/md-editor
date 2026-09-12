# Changelog - uTools Plugin

All notable changes to the Inkpoint uTools plugin will be documented in this file.

## 0.1.0 - 2026-09-05

- Initial public release of the Inkpoint uTools platform plugin (`apps/utools`), serving as a lightweight editor and traffic bridge to the desktop app
- Instant keyword invocation: quick launch via `md`, `markdown`, `编辑器`, `Inkpoint`, and `墨点`
- WYSIWYG editing: built on a single CodeMirror 6 state stack with zero latency and 600ms debounced auto-save
- Cloud-synced drafts: integrated with `utools.db` for seamless draft synchronization across devices under the user's account
- Fast local file editing: association with `.md`, `.markdown`, `.mdx`, and `.txt` files via Node.js `fs` bridge in the preload script
- Super Panel integration: global text selection (`cmd: over`) for one-click Markdown editing and "Paste back to app"
- Keyboard shortcut support: immediate disk saving via `Cmd+S` / `Ctrl+S` with toast feedback
- Theme synchronization: automatic detection and adaptation to uTools dark and light mode
- Zero-pollution architecture: completely isolated in `apps/utools` without polluting core domain packages
- Marketplace-compliant packaging: automated build plugin generating unminified CommonJS preload scripts and production `plugin.json`
- Traffic bridge & privacy boundaries: top banner linking to the official website and a disclaimer modal when configuring custom AI API keys
