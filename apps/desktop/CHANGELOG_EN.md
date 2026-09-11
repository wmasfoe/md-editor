# Changelog

All notable changes to the Inkpoint desktop application will be documented in this file.

## 0.10.1 - 2026-09-10 (#56, #57, #58)

- Fixed an underlying DOM structure defect in WYSIWYG mode where the first header cell and first column cell in newly created tables could not be focused or edited, decoupling cell edit containers from atomic control handles.
- Fixed an issue where uncommitted content was lost when switching focus between multiple cells within a table, refining blur save granularity to individual cell boundaries.
- Added a flushPendingEdits synchronization mechanism to proactively flush uncommitted table edit data before switching render modes, saving documents, or dispatching commands, preventing any data loss.
- Fixed a noop error when AI continuation was in progress or when rapidly switching render modes, introducing concurrency re-entrancy protection and automatically aborting active AI streams upon mode switches.
- Fixed inconsistent modifier key labels across platforms and resolved an issue on macOS where Cmd+Option+T failed to bring up the insert table dialog, aligning cross-platform standards and adding native app menu items.

## 0.10.0 - 2026-09-10 (#54, #55)

- Added support for custom relative image storage paths (./ and ../) with ${filename} variable placeholders, improving cross-platform path adaptation and prompting for confirmation to create missing directories.
- Added keyboard shortcut (Cmd+Option+T / Ctrl+Alt+T) to bring up the insert table dialog, generating standard GFM Markdown tables at the cursor with one click.
- Added Rust native file system watchers with two-tier real-time file tree synchronization, achieving 0ms instant response for in-app actions and 300ms debounced hot-reloads for external changes while preserving directory expansion states.
- Optimized local AI model version updates with component-level SHA256 diffing and physical hard link reuse, saving over 90% of download bandwidth, and enhanced remote description sanitization.

## 0.9.0 - 2026-09-09 (#53)

- Added full internationalization (i18n) support, providing seamless switching between Chinese and English, automatic system locale detection, and reactive state management.
- Refactored native application menus (macOS / Windows) for dynamic internationalization, applying language changes instantly.
- Localized the settings modal and multi-platform UI, supporting bilingual titles and descriptions for official plugins.
- Fixed cursor asymmetry and jumping when clicking inline math formulas, calibrating widget coordinate mapping and fallback handling.
- Fixed potential text selection artifacts after switching documents, enforcing DOM selection isolation at renderer document boundaries.

## 0.8.3 - 2026-09-07

- Added desktop MDX component insert dialog and programmatic cursor insertion support.
- Removed redundant native Win32 menu bars on Windows and Linux windows, maintaining a clean unified design.
- Integrated official syntax plugins (highlight, Callout, math, Mermaid) into the official website Showcase editor.
- Decoupled showcase header copy on the official website and refined visual presentation.

## 0.8.2 - 2026-09-07 (#52)

- Added official text highlight plugin (==highlight==) with native rendering:
  - Powered by Lezer @lezer/markdown delimiter pairing algorithm, following Obsidian and Typora de facto standards.
  - Accurately supports punctuation and whitespace lookaround rules, triple-equal sign isolation, and nested bold/italic formatting.
  - Supports Mod-Shift-h shortcut for in-place wrapping and unwrapping, integrating naturally with formatting commands.
  - Added highlight rendering support to static export and macOS Quick Look preview.
  - Enabled by default on Desktop and Web (defaultEnabled: true).
  - Added dedicated high-precision vector SVG highlighter icon in desktop settings, supporting live hot-reload without restarts.

## 0.8.1 - 2026-09-07 (#51, #50)

- Added modular plugin enable/disable management:
  - Toggle LaTeX math, Mermaid diagrams, and container directives on demand in settings.
  - Powered by CodeMirror 6 Compartments for runtime hot-reloads without DOM destruction, preserving cursor position and undo history.
  - Safely falls back to CommonMark standard code presentation when plugins are disabled.
- Refined plugin settings UI and visual interactions:
  - Adopted OpenDesign & Claude Design compact aesthetic with cleaner information hierarchy.
  - Official badges styled with emerald micro-capsule indicators and vector shield icons.
  - Custom switch toggles with subtle drop shadows, smooth transitions, and full accessibility (a11y) support.
  - Added "More plugins in development" teaser cards at the bottom for upcoming mind maps and flowcharts.
- Optimized website changelog presentation and PR linkage:
  - Supported nested lists and direct links to associated Pull Requests in website release notes.
  - Enhanced SSR rendering and fallback error boundaries for model update logs.

## 0.8.0 - 2026-09-07 (#49)

- Added native LaTeX math formula support:
  - Fast typesetting and rendering of inline formulas (`$E=mc^2$`) and block formulas (`$$...$$`) via KaTeX.
  - Supported standard code block syntax (```math and ```latex).
  - Implemented false-positive avoidance rules to prevent currency symbols (e.g. `$100 and $200`) from being incorrectly parsed.
  - In-place click-to-edit in WYSIWYG mode to inspect and edit formula source at any time.
- Added Mermaid diagram visualization support:
  - Native rendering of flowcharts, sequence diagrams, state diagrams, and other standard Mermaid charts.
  - On-demand asynchronous loading with zero initial bundle overhead; isolated error fallback cards for syntax errors.
- Optimized composite layout nesting:
  - Seamlessly supported math formulas and diagrams nested within blockquotes and list items with clean border alignment.

## 0.7.2 - 2026-09-07 (#48)

- Enhanced macOS Quick Look extension association and seamless activation:
  - Declared standard Markdown UTI mappings (net.daringfireball.markdown, etc.) in file associations so macOS automatically routes Markdown documents to the Quick Look extension.
  - Added silent background registration and fallback activation upon application startup, ready immediately after updates without manual system settings toggling.

## 0.7.1 - 2026-09-07 (#48)

- Added macOS native Quick Look preview support:
  - Select Markdown files (.md / .markdown) in Finder and press Space for instant, high-quality offline previews aligned with the Inkpoint editor.
  - Built as a pure native App Extension (InkpointQuickLook.appex) with a lightweight standalone renderer, opening in milliseconds with 2MB protection limits.
  - Visual styling strictly matches Inkpoint WYSIWYG formatting: light inline syntax markers, vector callout cards, and syntax highlighting.
- Decoupled and unified core rendering infrastructure:
  - Extracted @md-editor/renderer-codemirror/static subpath for Quick Look and future document static exports (PDF/images).
  - Extracted callout vector icons and language mappings into DOM-independent pure data modules for Headless, JSC, and Node.js environments.

## 0.7.0 - 2026-09-06 (#46)

- Added Web Playground: experience Inkpoint WYSIWYG Markdown editing and themes directly in the browser without installing desktop clients, featuring identical keyboard shortcuts and settings panels.
- New syntax plugin architecture: decoupled custom syntax extensions (e.g. ::: tip container directives) into @md-editor/syntax-plugins, supporting runtime installation with smart separation between visual decorations and AST syntax plugins.
- Complete official website refresh with interactive demos:
  - In-memory lightweight Live Editor on the homepage for visitors to test formatting and typing directly.
  - Interactive local AI showcase demonstrating Tab completion and Esc rejection.
  - Streamlined download hub and visual storytelling.
- Cursor navigation improvements for blockquotes and GFM alerts:
  - Fixed cursor jumping when pressing ArrowUp from below a blockquote, landing accurately on the last line.
  - Fixed callout headers to prevent expanding into raw syntax markers during editing.
  - Fully concealed > quote markers in WYSIWYG mode for cleaner visual presentation.
- Open-source governance improvements:
  - Structured GitHub Issue templates (Bug reports, feature requests, RFC architecture proposals, documentation improvements).
  - Added Pull Request template with semantic color-coded labels.
  - Enforced Conventional Commits and automated pre-push verification hooks.

## 0.6.3 - 2026-09-04 (#44)

- Improved symbol auto-pairing experience: no longer forcibly inserts duplicate closing symbols when typing backticks or parentheses; consecutive triple backticks can now be typed directly. Selected text can still be wrapped with one keystroke.
- Fixed code block deletion: selecting text across code blocks cleanly selects the entire block; pressing Delete cleanly removes the block without freezing.
- Aligned code block selection styling: selecting all text within a code block aligns highlight backgrounds neatly across lines, removing unwanted blue bars at the bottom.
- Fixed mouse drag selection offset: resolved vertical cursor drift during drag selection for pixel-accurate text highlighting.

## 0.6.2 - 2026-09-04 (#43)

- Optimized text selection highlights: background highlights fit font size and line height accurately without unwanted vertical padding.
- Fixed multi-line selection overflow: drag-selecting text across lines restricts highlights to the text container without spilling into left/right margins.
- Tidier paragraph typography: removed leading paragraph icons to ensure clean, aligned text margins.

## 0.6.1 - 2026-09-04 (#42)

- Upgraded local AI writing model: integrated latest Qwen3 local models for more accurate grammar correction, inline continuation, and summarization.
- Eliminated unwanted thinking traces: disabled chain-of-thought outputs, removing <think> tags for faster, lower-power ghost text generation.
- Resolved typing conflicts: typing immediately cancels ongoing AI requests for smoother keystroke responsiveness.
- Fixed duplicate summarization on document open: optimized background scheduling to prevent sending two duplicate distillation requests when opening files.
- Fixed intermittent "AI request failed" errors: bundled missing runtime dynamic link libraries for reliable offline startup.

## 0.6.0 - 2026-09-02 (#41)

- Added progressive rolling refine distillation for long documents, enabling local models to generate rolling contextual summaries based on headings and notes for more coherent text continuations.
- Supported zero-block keystroke FIM injection: distillation runs completely asynchronously without interrupting active writing flows.
- Implemented three-state GEC grammar error correction routing (<|task_gec_mixed|>, <|task_gec_zh|>, <|task_gec_en|>) based on text language.
- Aligned GEC prompt formats with model pre-training: removed System Prompt injection for GEC tasks to prevent topic drift.
- Introduced GBNF grammar-constrained sampling, strictly restricting SLM outputs to compact tuple JSON Diffs.
- Implemented atomic model replacement pipeline with staging files and SHA256 checksums, ensuring previous models remain available upon cancellation or failure.

## 0.5.1 - 2026-09-01 (#40)

- Integrated edge-customized small language models (md-editor-models v1.0.0: Lite 0.5B and Standard 1.5B) for fully offline, fast local inference.
- Supported ChatML prompt templates and custom task control tokens.
- Implemented compact tuple JSON Diff parser with Unicode Code Point absolute coordinate conversions.
- Established three-tier positioning correction (exact match -> sliding window fuzzy anchor -> silent drop) to filter out redundant identity replacements.
- Implemented concurrent Diff rendering with sequential Tab accept / Esc reject interactions, automatically shifting coordinates for subsequent pending items.
- Isolated AI request triggers during interaction and tuned debounce delays (local 650ms, cloud 1000ms).
- Fixed occasional sync failure dialogs on multi-tab accepts or no-op edits.
- Hardened CodeMirror 6 floating widget event bubbling and accessibility attributes.

## 0.5.0 - 2026-08-31 (#39)

- Added offline local AI writing assistance: built-in Lite (0.5B), Standard (1.5B), and Pro placeholder model tiers for completely disconnected execution.
- Added automatic hardware spec detection (CPU architecture, core count, physical RAM) with intelligent model tier recommendations.
- Added discrete switch toggles for each model card with exclusive activation semantics.
- Provided discrete local model lifecycle management: on-demand single model downloads, SHA256 verification, deletion, and read-only update checks.
- Implemented two-stage input proofreading pipeline: prioritization of grammar/polishing diffs on typing pauses, followed by low-saturation gray Ghost Text continuations when error-free.
- Supported resident llama.cpp runtime with 5-minute idle memory cleanup, balancing responsiveness with system resources.

## 0.4.6 - 2026-08-31

- Added common Markdown formatting shortcuts (Mod-B bold, Mod-I italic, Mod-D strikethrough, Mod-E inline code, Mod-Shift-U/O lists, Mod-Shift-Q quotes).
- Supported Smart Link Paste (pasting URLs onto selected text creates Markdown links) and selection bracket wrapping.
- Supported Smart Pairs (auto-closing symbols, step-over closing brackets, backspace pair deletion).
- Added Apple Liquid Glass styled floating find & replace panel (Mod-F, supporting case/whole-word/regex matching and replace all).
- Supported cursor-aware clipboard image pasting onto the active line.
- Optimized WYSIWYG interaction flows: double enter on empty lists/quotes exits blocks, Tab on the last table cell inserts a new row.
- Calibrated heading hierarchy scaling and ATX marker clarity, removing redundant H1-H6 badges.
- Introduced Apple Liquid Glass segmented controls and interactive animations on the website.
- Fixed desktop favicon SVG assets and smart pair step-over boundary checks.

## 0.4.5 - 2026-08-28

- Fixed Chinese font LXGW WenKai rendering issue on the official website.
- Added English and Chinese language switching on the website with browser locale auto-detection.
- Redesigned official website with Apple-grade 3D immersive parallax scrolling and desktop editor showcase.
- Redesigned desktop file tree UI: Apple HIG floating pill nodes, classic folded paper/tab folder icons, and active file highlight indicators.

## 0.4.4 - 2026-08-27 (#37)

- Fixed Ctrl+S file saving shortcut on Windows.
- Fixed Windows in-app updater failure where only curl commands were shown, now offering PowerShell fallback commands.
- Fixed "Copy Absolute Path" in file tree context menu on Windows.

## 0.4.3 - 2026-08-27 (#36)

- Fixed console window popup on Windows startup.
- Fixed file open/save errors caused by Tauri v2 Scope state anomalies on Windows.

## 0.4.2 - 2026-08-27 (#35)

- Added Linux (x86_64 / aarch64) support with AppImage and DEB packages.
- Added Windows (x64 / arm64) support with NSIS Setup installers.
- Added one-line terminal install scripts (macOS/Linux curl and Windows PowerShell irm).
- Added multi-platform download and architecture navigation to website and install docs.
- Established automated multi-platform CI build, verification, and Release publishing workflows.

## 0.4.1 - 2026-08-27 (#34)

- Fixed in-place source editing for empty images ![]() in WYSIWYG mode.
- Fixed single-bracket text like [1] being misidentified as reference links.

## 0.4.0 - 2026-08-27 (#32)

- Migrated to new in-house CodeMirror 6 editor engine, unifying around a single Document stream model and single View architecture.
- Supported sub-millisecond lossless switching between WYSIWYG and Markdown Source modes.
- Full CommonMark and GFM specification support (tables, code block line numbers, folds, quotes, task lists).
- Supported official MDX syntax and custom component placeholder rendering.
- Added block-level gutter controls (folding, heading level switcher, floating block menu, drag reorder handles) with paper-like typography.
- AI writing assistant and proofreading (native Ghost Text inline completions, Tab acceptance, Diff previews).
- Bidirectional outline navigation (header dropdown and sidebar TOC with smooth scrolling and cursor synchronization).

## 0.3.19 - 2026-07-15

- Added inline syntax markers in WYSIWYG mode.
- Optimized default theme colors.
- Optimized file structure.

## 0.3.18 - 2026-07-12

- Fixed dark mode bugs; fixed settings menu persistence issue.

## 0.3.17 - 2026-07-11

- Improved blank space clicking and horizontal divider interactions in WYSIWYG editing.

## 0.3.16 - 2026-07-10

- Decoupled AI capabilities into a standalone subpackage to reduce editor coupling.
- Disabled smart quote replacement in the macOS shell.

## 0.3.15 - 2026-07-09

- Split editor component structure and fixed test path references.

## 0.3.14 - 2026-07-09

- Replaced complex bridge with React Context to resolve known issues.

## 0.3.13 - 2026-07-09

- Refactored dependency hierarchy and improved performance.
- Introduced Zustand, breaking large controllers into composable stores and autonomous components.
- Consolidated cross-platform editor state into editor-ui.

## 0.3.12 - 2026-07-07

- Added background silent update capabilities for desktop app.

## 0.3.11 - 2026-07-07

- Supported lightweight status text display in window title bar.

## 0.3.10 - 2026-07-06

- Preserved scroll position when switching edit modes.
- Optimized fonts, font sizes, line height, and paragraph margins in WYSIWYG mode.

## 0.3.9 - 2026-07-06

- Optimized editing and reading experience in Source mode.
- Refined typography and code block styles; fixed select-all behavior in code blocks.

## 0.3.8 - 2026-07-04

- Correctly persisted editor display preferences such as code block line numbers.
- Code block line numbers disabled by default; adjusted default built-in theme.
- Fixed native window button positioning upon macOS window resizing.
- Replaced static sidebar toggle with left-hover disclosure arrow.

## 0.3.7 - 2026-07-02

- Fixed text wrap styles for AI suggestions.
- Optimized title bar height for settings window.
- Corrected default behaviors for settings persistence and folder opening.
- Converted settings into a standalone window; refined minimal diff feedback for AI previews.

## 0.3.6 - 2026-06-30

- Refreshed sidebar styling and added animations.

## 0.3.5 - 2026-06-30

- Separated DMG and updater package build pipelines.

## 0.3.4 - 2026-06-30

- Generated in-app updater packages and optimized CI workflows.
- Prevented Vue components in code snippets from being misclassified as MDX raw blocks.

## 0.3.3 - 2026-06-30

- Updated in-app updater signing keys.
- Supported in-app updates.

## 0.3.2 - 2026-06-30

- Fixed editor loading animation flash during saving.

## 0.3.1 - 2026-06-30

- Fixed editor loading animation flash during saving.

## 0.3.0 - 2026-06-30

- Supported LLMs for syntax diagnostics and AI continuation; enhanced editing experience.
- Supported public installation and release update checks.

## 0.2.8 - 2026-06-27

- Integrated local large language models.
- Unified editor sidebar and theme background margins.
- Improved theme system and custom app title bar; transitioned settings modal to a full page.

## 0.2.7 - 2026-06-25

- Added AI suggestions and enhanced AI prompting experience.
- Fixed Chinese IME line wrapping and active line spacing expansion.
- Adopted native macOS menus; updated application icon.

## 0.2.6 - 2026-06-24

- Fixed folder switching issues when editing sub-files.
- Improved hyperlink interactions; switched error alerts to toast notifications.
- Refactored subpackage modularization and built in Callout components.
- Prevented cross-block selections from being collapsed by blank-area logic.

## 0.2.5 - 2026-06-22

- Fixed known bugs and stability issues.

## 0.2.4 - 2026-06-22

- Optimized loading feedback when opening documents.
- Fixed file rename synchronization logic.
- Optimized code block rendering and syntax highlighting.
- Refreshed sidebar and DocumentBar styling.

## 0.2.3 - 2026-06-22

- Added settings page and refreshed overall UI.
- Supported customizing keyboard shortcuts in settings.

## 0.2.2 - 2026-06-18

- Optimized image editing interactions and resolved known issues.
- Updated release workflows and scripts.

## 0.2.1 - 2026-06-18

- Dynamically updated recent files menu.
- Fixed issue where clicking a recent file immediately after startup failed to open.
- Fixed file system keyboard shortcuts.

## 0.2.0 - 2026-06-18

- Expanded code block language support (Java, Go, C/C++, C#, Python, Ruby, Rust, Swift, etc.) and refined language selector.
- Added Markdown formatting and heading shortcuts.
- Added Recent Files feature with dynamic menu updates and persistence.
- Refined editor interactions: blank-area focus, sidebar selection prevention, and localized Cmd+A selection within code blocks.
- Improved documentation and refactored editor-ui directory structure.

## 0.1.12 - 2026-06-18

- Optimized code block components and outline highlights.

## 0.1.11 - 2026-06-18

- Optimized file tree.

## 0.1.10 - 2026-06-17

- Replaced window.prompt with inline inputs for creating and renaming files.

## 0.1.9 - 2026-06-17

- Optimized sidebar styles.
- Fixed tsconfig issues.

## 0.1.8 - 2026-06-17

- Decoupled reusable editor UI from desktop platform code.

## 0.1.7 - 2026-06-17

- Fixed editor canvas width issues.
- Fixed image preview failure.

## 0.1.6 - 2026-06-17

- Used real Homebrew release asset URLs.

## 0.1.5 - 2026-06-17

- Supported Homebrew installation when the source repository is private.

## 0.1.4 - 2026-06-16

- Updated release scripts.

## 0.1.3 - 2026-06-16

- Updated documentation.
- Published macOS DMG to Homebrew tap.

## 0.1.2 - 2026-06-16

- Added context menu support.

## 0.1.1 - 2026-06-16

- Synchronized application version configuration.

## 0.1.0 - 2026-06-16

- Initial public release; updated build scripts.
