# Changelog - Inkpoint iOS

All notable changes to the Inkpoint iOS application will be documented in this file.

## 0.1.0 - 2026-09-16 (#69)

- **Initial release of the native iOS client**: High-performance bidirectional hybrid architecture built with SwiftUI and WKWebView, tailored for iPhone and iPad.
- **Adaptive dark mode & native touch interactions**: Fully aligned with Apple Human Interface Guidelines (HIG), supporting seamless light/dark theme switching and haptic feedback.
- **CodeMirror 6 fast mobile editing**: Single-state-stack architecture optimized for mobile touch selection, delivering responsive Markdown and MDX editing.
- **Seamless mode switching**: Zero-delay transition between WYSIWYG rich-preview and live source editing modes.
- **Full Markdown / MDX plugin ecosystem**:
  - Offline support for syntax highlighting, GFM tables, KaTeX math formulas, Mermaid diagrams, Callout alert blocks, and custom container directives.
  - Optimized GFM task lists (checklist) with aligned inline checkboxes, hanging indentation, and clean formatting.
  - Mermaid hydration race condition resolution for instantaneous rendering on document load and view mode toggle.
- **Native floating keyboard accessory bar**: Quick insertion for bold, italic, lists, code blocks, math formulas, blockquotes, and directives.
- **Instant offline persistence & lifecycle restore**: Document contents automatically persist across app backgrounding, termination, and cold launch.
- **Interactive document outline drawer**: Real-time table of contents extraction with smooth drawer navigation.
