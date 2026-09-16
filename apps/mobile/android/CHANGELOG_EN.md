# Changelog - Inkpoint Android

All notable changes to the Inkpoint Android application will be documented in this file.

## 0.1.0 - 2026-09-16 (#69)

- **Initial release of the native Android client**: Modern Material Design 3 mobile client built with Jetpack Compose and AndroidX WebView.
- **Material You dynamic theming & edge-to-edge immersion**: Support for system light/dark theme switching, dynamic palette adaptation, and native haptic feedback.
- **CodeMirror 6 fast mobile editing**: Specialized mobile touch selection and spring-physics keyboard accessory bar delivering responsive Markdown and MDX editing.
- **Seamless mode switching**: Zero-delay transition between WYSIWYG rich-preview and live source editing modes.
- **Full Markdown / MDX plugin ecosystem**:
  - Offline support for syntax highlighting, GFM tables, KaTeX math formulas, Mermaid diagrams, Callout alert blocks, and custom container directives.
  - Optimized GFM task lists (checklist) with aligned inline checkboxes, hanging indentation, and clean formatting.
  - Mermaid hydration race condition resolution for instantaneous rendering on document load and view mode toggle.
- **Native keyboard accessory toolbar**: Quick insertion for common Markdown syntax, MDX components, and undo/redo controls.
- **Local persistence & lifecycle protection**: Robust draft storage and configuration persistence across configuration changes and backgrounding.
- **Interactive document outline drawer**: Real-time table of contents extraction with drawer navigation.
