# Changelog - uTools Plugin

All notable changes to the Inkpoint uTools plugin will be documented in this file.

## 0.2.0 - 2026-11-18

- Enable live Markdown linting in editor settings. Issues are underlined, with explanations and quick fixes for supported rules available on hover.
- Smart paste converts rich text copied from web pages into Markdown while preserving headings, lists, tables, and code blocks. Hold Shift to paste plain text. Paste a URL over selected text to turn it into a Markdown link.
- Edit HTML block source in place and continue writing below a table, HTML block, or horizontal rule at the end of a document.
- Configure an AI provider to trigger inline writing suggestions and grammar checks with keyboard shortcuts.
- Settings are grouped by editor, appearance, AI assistance, and shortcut reference. Appearance can follow the system or use light or dark mode.
- Improved local image insertion and save error messages. Image insertion can replace the selection and be undone, with a retry prompt if the document changes during processing.
- Improved callout and GFM Alert rendering and fixed the invisible editing caret in table cells.
- Local file access is limited to documents and workspaces selected through uTools or a system dialog. Pasted images are saved in the document's neighboring `assets` folder. Reopen a file or workspace after restarting the plugin.

## 0.1.1 - 2026-09-18

- Fix critical issue where saving documents or pasting/dropping local images caused unexpected viewport jumps to top, selection loss, and undo history disruption (#90)
- Adopt checkpoint-and-settlement protocol (`beginSave` / `settleSave`) for document saves, ensuring generation stability without resetting scroll position
- Route programmatic image insertions through the editor atomic transaction port (`applyExternalEdit`), keeping scroll position intact
- Suppress redundant success toast notifications across saving, image pasting, mode toggle, and file management to provide a distraction-free writing experience

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
