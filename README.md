<p align="center">
  <a href="#inkpoint">
    <img width="180" alt="Inkpoint" src="apps/desktop/public/logo.png">
  </a>
</p>

# Inkpoint

<p align="center">
  A modern, sleek, cross-platform Markdown & MDX editor — bringing <b>Typora-like WYSIWYG</b> editing, <b>native interactive MDX components</b>, and <b>frictionless cross-device synergy</b>.
</p>

<p align="center">
  <b>English</b> · <a href="./README_ZH.md">简体中文</a>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#installation--downloads">Installation & Downloads</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#tech-stack">Tech Stack</a> ·
  <a href="#documentation">Documentation</a> ·
  <a href="#license">License</a>
</p>

<p align="center">
  <a href="https://editor.justdev.cn/download">
    <img src="https://img.shields.io/badge/platform-macOS_%7C_Windows_%7C_Linux_%7C_Web_%7C_Android_%7C_uTools-blue?style=flat-square" alt="Platforms">
  </a>
  <a href="https://github.com/wmasfoe/md-editor">
    <img src="https://img.shields.io/badge/built_with-Tauri_2_%2B_React_19-orange?style=flat-square&logo=tauri&logoColor=white" alt="Built with Tauri 2 + React 19">
  </a>
  <a href="https://github.com/wmasfoe/md-editor">
    <img src="https://img.shields.io/badge/editor-CodeMirror_6-8A2BE2?style=flat-square" alt="Editor">
  </a>
  <a href="https://github.com/wmasfoe/md-editor/releases">
    <img src="https://img.shields.io/badge/desktop-v0.18.0-brightgreen?style=flat-square" alt="Desktop Version">
  </a>
  <a href="https://github.com/wmasfoe/md-editor/releases">
    <img src="https://img.shields.io/badge/android-v0.1.1-brightgreen?style=flat-square" alt="Android Version">
  </a>
  <a href="#license">
    <img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square" alt="License">
  </a>
</p>

---

## Features

### 🎨 Typora-like WYSIWYG Editing
- **Instant Rendering**: Powered by CodeMirror 6's deep projection layer, Markdown syntax markers gracefully tuck away as you type, rendering formatted text while preserving 100% pure Markdown truth.
- **Single-Editor Homomorphism**: Both WYSIWYG and Source modes share a single CodeMirror 6 `EditorView` instance, delivering zero-latency switching with fully preserved selection, scroll position, and undo history.
- **Intuitive Interactions**: Features line-level fold toggles, block drag handles, quick slash commands (`/` to insert elements), and contextual selection formatting toolbars.
- **Distraction-Free Modes**: Toggle **Focus Mode** (highlights current block, softly dims others) and **Typewriter Mode** (smoothly keeps active cursor vertically centered).

### 🛡️ Trust Foundation: Draft Recovery & Revision Snapshots
- **Automatic Draft Recovery (Hot Exit)**: Unsaved edits are automatically buffered on window close or unexpected quit. A clean recovery banner prompts at next launch to restore drafts with one click or discard them safely.
- **Document History Drawer**: Built-in revision drawer tracks local document snapshots over time, complete with visual line-by-line Diff highlights (insertions/deletions), keyboard navigation, and one-click rollback.

### 🔍 Quality Assurance: Markdown Linting & Proactive Checks
- **Real-Time Markdown Linting**: Integrated markdownlint engine displaying wavy underlines and localized diagnostic tooltips. Press `⌥⇧L` (`Alt+Shift+L`) to toggle the bottom diagnostic dock, and `⌥⇧F` (`Alt+Shift+F`) to batch auto-fix common formatting issues.
- **Relative Link Validation**: Proactively validates relative image/document file paths and in-page heading anchors (`[Title](#heading)`), preventing broken links before publication.
- **Multi-Language Localization**: Diagnostic rules and UI tooltips dynamically switch across English, Chinese, Japanese, and Traditional Chinese.

### 📤 High-Fidelity Standalone Export
- **Self-Contained HTML**: Export standalone single-file HTML embedding inlined CSS themes, KaTeX formulas, Mermaid diagrams, and syntax highlighting.
- **Native Vector PDF**: High-quality paginated vector PDF generation with clickable heading outlines, respecting editor typography and print break guards.
- **Copy as Rich Text HTML**: Direct clipboard export for pasting formatted content into email, Notion, or blog platforms.

### 🔤 East Asian (CJK) Typography & Delimiters
- **Punctuation-Adjacent Emphasis**: Recognizes bold (`**text**`), italic (`*text*`), strikethrough (`~~text~~`), and highlight (`==text==`) adjacent to CJK punctuation without escaping or syntax breakdown.
- **Smart Pairing & Tab Out**: Automatically steps outside brackets and links when pressing `Tab`, maintaining natural typing rhythm without intrusive auto-closing on empty cursors.
- **Local SLM Spacing & Punctuation**: Dedicated on-device SLM task for standardizing CJK-Latin spacing and punctuation normalization.

### 🧩 Native MDX & Interactive Components
- **Deep MDX Compatibility**: Seamlessly mix standard Markdown content with React / JSX interactive components.
- **Out-of-the-Box Official Extensions**:
  - 💬 **Alert / Callout**: Multi-style informational callouts (Note, Tip, Important, Warning, Caution).
  - 📊 **Mermaid Diagrams**: Live rendering of flowcharts, sequence diagrams, class diagrams, and state diagrams with click-to-zoom modals.
  - 🧮 **LaTeX Mathematics**: High-speed mathematical typesetting for inline and block equations via KaTeX.
  - 💻 **Code Sandbox & Highlighting**: Multi-language syntax highlighting with CodeSandbox embedding support.
  - 📑 **Tabs Component**: Easily organize multi-language code snippets or comparison views.
- **Component Registry**: Modular protocol (`@md-editor/mdx-component-registry`) enabling custom component extensions.

### ⚡ Lightweight, High Performance & Local-First
- **Native Speed**: Built with Tauri 2 + Rust for native core performance, instant cold startup, and remarkably lower memory footprint than Electron.
- **Local-First Architecture**: Direct file system reads/writes with zero proprietary cloud locks. 100% offline-capable, keeping your data private and secure.
- **High Formatting Fidelity**: Full preservation of YAML Frontmatter, raw HTML tags, and custom metadata without AST formatting destruction.

### 📱 Multi-Platform & Multi-Form Synergy
- **Desktop Clients (macOS / Windows / Linux)**: Native window chrome (macOS Liquid Glass vibrancy), tabbed editing, outline trees, file watching, and differential updates.
- **Mobile Suite (Android / iOS)**: "Jilan" (即览) philosophy combining an offline Webview core with native soft-keyboard accessory bars (`KeyboardAccessoryBar`) and haptic feedback.
- **Web Playground**: Zero-install in-browser full editor experience powered by an in-memory virtual file system with IndexedDB persistence.
- **uTools Productivity Plugin**: Dual-mode design (distraction-free quick-note mode & full workspace mode) with zero-pollution physical isolation.
- **macOS QuickLook Preview**: Built-in headless compiler (`@md-editor/compiler`) enabling instant spacebar previews for `.md` / `.mdx` files in Finder.

### 🤖 Modular AI Writing Assistant
- **Decoupled Architecture**: Clean-architecture AI harness (`@md-editor/ai`) ready to connect with OpenAI, Anthropic Claude, Google Gemini, or local models.
- **On-Device SLM**: Native macOS dynamic library integration for zero-network local inference powered by Apple Silicon Metal acceleration.
- **Intelligent Augmentation**: Inline ghost text completions, grammatical polishing, document context distillation, and reviewable stream suggestions.

---

## Installation & Downloads

Choose the installation method that best fits your operating system and device:

| Platform | Architecture / Environment | Package Format | Notes |
| :--- | :--- | :--- | :--- |
| **macOS** | Apple Silicon (`aarch64`) / Intel (`x86_64`) | `.dmg` | Recommended: Homebrew or one-line script |
| **Windows** | x64 / ARM64 | `.exe` (NSIS Setup) | Silent install script or manual installer |
| **Linux** | x86_64 / aarch64 | `.AppImage` / `.deb` | Standalone AppImage or system package |
| **Android** | ARM64 / x86_64 (Android 8.0+) | `.apk` (Package) | Mobile instant reading & note-taking (High-speed direct download) |
| **uTools** | Desktop application environment | `.upxs` (Plugin package) | Search "Inkpoint" in uTools store or trigger via shortcut |
| **Web** | Modern Web Browsers | Online (SPA) | Zero-install direct access via [Web Playground](https://editor.justdev.cn) |

### Option 1: One-Line Install Script (Desktop Recommended)

- **macOS / Linux**:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.sh | sh
  ```

- **Windows (PowerShell)**:
  ```powershell
  irm https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.ps1 | iex
  ```

### Option 2: Package Manager (macOS)

Install via [Homebrew](https://brew.sh/):

```bash
brew install --cask wmasfoe/tap/md-editor
```

### Option 3: Manual Download

Visit the [Official Download Portal](https://editor.justdev.cn/download) or [GitHub Releases](https://github.com/wmasfoe/md-editor/releases) to download packages for your operating system.

> [!TIP]
> **macOS Quarantine Notice**: The one-line install script and Homebrew handle Gatekeeper quarantine automatically. If you manually download the `.dmg` and macOS reports "App is damaged" or "Cannot verify developer", run:
> ```bash
> xattr -dr com.apple.quarantine /Applications/Inkpoint.app
> ```

---

## Quick Start

### Prerequisites

- **Node.js**: 18+ (Refer to `.node-version`)
- **pnpm**: 11.6.0+ (Enable via `corepack enable`)
- **Rust**: Latest stable toolchain (for Tauri desktop compilation)

### Local Development

```bash
# 1. Clone the repository
git clone https://github.com/wmasfoe/md-editor.git
cd md-editor

# 2. Install workspace dependencies
pnpm install

# 3. Start desktop development server (Vite + Tauri)
pnpm dev

# 4. Start Web online playground development server
pnpm dev:web

# 5. Start uTools plugin development server
pnpm dev:utools

# 6. Start mobile development (Android / iOS)
pnpm android   # Android emulator or connected device
pnpm ios       # iOS simulator (macOS only)

# 7. Start official website development server
pnpm dev:site

# 8. Start edge distribution worker development server
pnpm dev:worker

# 9. Run workspace tests and code quality checks
pnpm test        # Run unit tests
pnpm typecheck   # TypeScript type checks
pnpm lint        # Oxlint + Prettier + Cargo Clippy
```

### Production Build

```bash
# Cross-platform desktop builds
pnpm build:macos    # macOS (.dmg and updater package)
pnpm build:linux    # Linux (.AppImage and .deb)
pnpm build:windows  # Windows (NSIS installer)

# Web online playground build
pnpm build:web

# Mobile offline webview bundle build & sync to native Android / iOS projects
pnpm build:mobile

# uTools plugin build (generates dist/ bundle)
pnpm build:utools

# Official website Next.js production build
pnpm build:site
```

### Multi-Platform Releases

All release workflows are unified under the `release:*` namespace:

```bash
# Desktop cross-platform release (interactive version bump, dual changelogs, v* tag)
pnpm release:desktop

# Web online playground deployment (builds locally & deploys directly to Vercel)
pnpm release:web

# Official website deployment
pnpm release:site

# Cloudflare Worker global distribution gateway deployment
pnpm deploy:worker
```

---

## Architecture

Inkpoint adopts a modern Monorepo architecture managed by `pnpm workspace` with well-defined responsibility boundaries:

```
md-editor/
├── apps/
│   ├── desktop/                 # Tauri 2 cross-platform desktop app (Rust + React 19 Shell)
│   ├── mobile/                  # Mobile multi-platform suite (Hybrid Webview + Android Compose + iOS SwiftUI)
│   │   ├── core/                # @md-editor/mobile-core: Mobile offline Webview core and Bridge
│   │   ├── android/             # Android native project (Kotlin + Jetpack Compose + SAF)
│   │   └── ios/                 # iOS native project (Swift 6 + SwiftUI + Share Extension)
│   ├── utools/                  # uTools platform immersive lightweight quick-note plugin
│   ├── web/                     # Web online Playground editor application (Vite + React 19)
│   └── site/                    # Inkpoint official website and dynamic download center (Next.js App Router)
├── infra/
│   └── distribution-worker/     # Cloudflare Worker global edge download gateway & dynamic proxy (R2 + Fallback)
├── packages/
│   ├── editor-core/             # Editor core (document state stream, ordered save scheduler, mode switching)
│   ├── renderer-codemirror/     # CodeMirror 6 rendering layer (isomorphic WYSIWYG projection, decorations, tables, lint)
│   ├── editor-ui/               # Editor React UI components, toolbars, history drawer, file tree, and settings
│   ├── compiler/                # Headless static Markdown compiler & HTML/PDF exporter (QuickLook / Worker)
│   ├── syntax-plugins/          # Markdown syntax plugins (highlighting, strikethrough, footnotes, KaTeX, Mermaid)
│   ├── mdx-component-registry/  # MDX component protocol specifications and runtime static metadata registry
│   ├── mdx-plugins/             # Built-in official interactive MDX components (Callout, Alert cards, etc.)
│   ├── markdown-fidelity/       # Markdown / MDX lossless fidelity conversion and AST bi-directional mapping
│   ├── file-system/             # Cross-platform abstract file I/O, session drafts (Hot Exit), history, and link validator
│   ├── i18n/                    # Global i18n system (type-safe bilingual localization dictionaries & locale switcher)
│   ├── ai/                      # AI provider abstraction, streaming suggestion parser, and multi-protocol harness
│   └── shared/                  # Common TypeScript utility library and cross-package core types
├── docs/                        # Project design specifications, technical proposals, and release guidelines
└── scripts/                     # Automated release scripts (release:*), mobile asset sync, and CI helpers
```

> 💡 Each subpackage and application directory contains its own `README.md` with detailed technical documentation and API specifications.

---

## Tech Stack

| Domain | Core Technology | Description |
| :--- | :--- | :--- |
| **Desktop Runtime** | [Tauri 2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/) | Lightweight, secure, low-resource cross-platform desktop foundation |
| **Mobile Native** | [Jetpack Compose](https://developer.android.com/compose) + [SwiftUI](https://developer.apple.com/xcode/swiftui/) | Native Android & iOS UI, system haptics, keyboard accessory bar & share extensions |
| **Frontend Architecture** | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | Modern declarative UI development with a rigorous type system |
| **Editor Core** | [CodeMirror 6](https://codemirror.net/) | Next-generation unified WYSIWYG and source editor on a single EditorView |
| **Headless Compiler** | `@md-editor/compiler` | Pure zero-DOM static Markdown compiler supporting QuickLook and standalone export |
| **Edge Distribution** | [Cloudflare Workers](https://workers.cloudflare.com/) + [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) | Global multi-tier fallback download gateway with instant cache invalidation |
| **Styling & UI** | [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/) | Utility-first styling framework and modern icon library |
| **Monorepo Build** | [Vite 6](https://vitejs.dev/) + [pnpm Workspace](https://pnpm.io/) | Lightning-fast HMR development and efficient dependency sharing |
| **Testing & Standards** | [Vitest](https://vitest.dev/) + [Oxlint](https://oxc.rs/) + [Prettier](https://prettier.io/) | Ultra-fast unit testing, oxlint static analysis, and code formatting toolchain |

---

## Documentation

Comprehensive architecture proposals and design guidelines are located in [`docs/`](docs/):

- 📘 [Agent Knowledge Base Index](docs/agent/index.md) — Unified navigation across architecture, status, specs, and roadmaps
- 📐 [Capability Boundary Design Principles](docs/agent/architecture/capability_boundary_design_principles.md) — Module boundaries and decoupling rules
- 🛠️ [VMark Feature Technical Plan](docs/agent/architecture/vmark_remaining_features_technical_plan.md) — Hot Exit, Document History, Linting, and HTML/PDF export
- 📱 [Mobile Architecture Plan](docs/agent/architecture/mobile_support_architecture.md) — Mobile Webview core and native bridge design
- 🚀 [Automated Release Workflow](docs/agent/release/release_workflow.md) — CI/CD, GitHub Releases, and distribution automation
- 💡 [Project Background & Origins](docs/human/project.md) — Insights, reflections, and design philosophies

---

## Contributing & Guidelines

For code conventions and Git workflows, please refer to [AGENTS.md](AGENTS.md) (see the "Code structure & naming" section) and the [repository structure & naming convention](docs/agent/architecture/repo_structure_and_naming_conventions.md).

---

## License

Inkpoint is licensed under the [GNU General Public License v3.0 or later (GPL-3.0-or-later)](LICENSE). The license text is [LICENSE](LICENSE). The copyright notice is [NOTICE](NOTICE).

---

<p align="center">
  Copyright © 2026 Inkpoint. All rights reserved.
</p>
