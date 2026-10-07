# Changelog

## 0.2.1 - 2026-10-07 (#149)

- **修复中文输入法组合输入异常**：编辑器区域不再被外壳设为不可选中，输入法的拼音不会再被当作正文写入文档，编辑时光标不再乱跳 (#149)
- **补齐全端 App 图标**：Android 接入 mipmap 与自适应图标，桌面图标不再缺失 (#147)
- **编辑器外观跟随系统深浅色**：系统主题切换时编辑器配色实时同步，不再出现深色外壳配白底正文 (#149)
- **输入法组合期间不再触发原生侧重排**：字数与大纲上报、视口重排推迟到候选词确认之后执行，提升中文输入稳定性 (#149)

# Changelog - Inkpoint Android

All notable changes to the Inkpoint Android application will be documented in this file.

## 0.2.0 - 2026-09-25 (#82, #84)

- **Edge distribution & releases archive**: Integrated with Cloudflare R2 automated multi-platform distribution system, supporting comprehensive historical release indexing and fast direct downloads (#82).
- **Documentation & engineering standard upgrade**: Enhanced mobile architecture contracts and workspace collaboration documentation, aligning with multi-platform release specifications (#84).
- **Editor engine & bridge performance**: Synchronized with the latest CodeMirror 6 core rendering mechanism, improving bidirectional event stream communication stability between WebView and Jetpack Compose.

## 0.1.1 - 2026-09-17 (#81)

- **Fix crash when entering editor state**: Resolved occasional crash when transitioning into the editing state on mobile, improving bridge communication stability between WebView and Compose (#81).

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
