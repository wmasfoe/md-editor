<p align="center">
  <a href="#inkpoint">
    <img width="180" alt="Inkpoint" src="apps/desktop/public/logo.png">
  </a>
</p>

# Inkpoint

<p align="center">
  A modern, sleek cross-platform Markdown & MDX editor — bringing <b>Typora-like WYSIWYG</b> editing, <b>native MDX interactive components</b>, and <b>cross-device synergy</b>.
</p>

<p align="center">
  <a href="./README.md">简体中文</a> · <b>English</b>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#installation--downloads">Installation & Downloads</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#tech-stack">Tech Stack</a> ·
  <a href="#documentation">Docs</a> ·
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
    <img src="https://img.shields.io/badge/desktop-v0.10.2-brightgreen?style=flat-square" alt="Desktop Version">
  </a>
  <a href="https://github.com/wmasfoe/md-editor/releases">
    <img src="https://img.shields.io/badge/android-v0.1.1-brightgreen?style=flat-square" alt="Android Version">
  </a>
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
</p>

---

## Features

### 🎨 Typora-like WYSIWYG Editing
- **Instant Rendering**: Powered by CodeMirror 6's deep projection layer, Markdown syntax markers disappear as you type and render as clean formatting while retaining 100% pure Markdown truth.
- **Single-Editor Homomorphism**: Both WYSIWYG and source modes share a single CodeMirror 6 `EditorView` instance, delivering zero-latency switching with preserved selection and undo history.
- **Intuitive Interactions**: Features line-level fold toggles, block drag handles, quick slash commands (`/` to insert elements), and floating selection formatting toolbars.

### 🧩 Native MDX & Interactive Components
- **Deep MDX Compatibility**: Seamlessly mix standard Markdown content with React / JSX interactive components.
- **Out-of-the-Box Official Extensions**:
  - 💬 **Alert / Callout**: Multi-style informational callouts (Note, Tip, Important, Warning, Caution).
  - 📊 **Mermaid Diagrams**: Live rendering of flowcharts, sequence diagrams, class diagrams, and state diagrams.
  - 🧮 **LaTeX Mathematics**: High-speed mathematical typesetting for inline and block equations via KaTeX.
  - 💻 **Code Sandbox & Highlighting**: Multi-language syntax highlighting with CodeSandbox embedding support.
  - 📑 **Tabs Component**: Easily organize multi-language code snippets or comparison views.
- **Component Registry**: Modular protocol (`@md-editor/mdx-component-registry`) enabling custom component extension with ease.

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
- **Decoupled AI Engine**: Independent AI layer (`@md-editor/ai`) ready to connect with OpenAI, Claude, DeepSeek, or local models via Ollama (SLM).
- **Intelligent Augmentation**: Inline ghost text completions, grammatical polishing, document context distillation, and content expansion.

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

# Mobile release: bump version and push android-v* tag to trigger automated CI/CD & R2 distribution
git tag android-v0.1.1
git push origin android-v0.1.1
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
│   └── web/                     # Web online Playground editor application (Vite + React 19)
├── site/                        # Inkpoint official website and dynamic download center (Next.js App Router)
├── infra/
│   └── distribution-worker/     # Cloudflare Worker global edge download gateway & dynamic proxy (R2 + Fallback)
├── packages/
│   ├── editor-core/             # Editor core (document state stream, ordered save scheduler, mode switching)
│   ├── renderer-codemirror/     # CodeMirror 6 rendering layer (isomorphic WYSIWYG projection, decorations, tables)
│   ├── editor-ui/               # Editor React UI components, floating toolbars, file tree, and live outline
│   ├── compiler/                # Headless static Markdown compiler & HTML emitter (QuickLook / Worker)
│   ├── syntax-plugins/          # Markdown syntax plugins (highlighting, strikethrough, footnotes, KaTeX, Mermaid)
│   ├── mdx-component-registry/  # MDX component protocol specifications and runtime static metadata registry
│   ├── mdx-plugins/             # Built-in official interactive MDX components (Callout, Alert cards, etc.)
│   ├── markdown-fidelity/       # Markdown / MDX lossless fidelity conversion and AST bi-directional mapping
│   ├── file-system/             # Cross-platform abstract file I/O, persistence, and local image asset management
│   ├── i18n/                    # Global i18n system (type-safe bilingual localization dictionaries & locale switcher)
│   ├── ai/                      # AI provider abstraction, streaming suggestion parser, and context distillation
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
| **Headless Compiler** | `@md-editor/compiler` | Pure zero-DOM static Markdown compiler supporting macOS QuickLook and Worker |
| **Edge Distribution** | [Cloudflare Workers](https://workers.cloudflare.com/) + [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) | Global multi-tier fallback download gateway with instant cache invalidation |
| **Styling & UI** | [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/) | Utility-first styling framework and modern icon library |
| **Monorepo Build** | [Vite 6](https://vitejs.dev/) + [pnpm Workspace](https://pnpm.io/) | Lightning-fast HMR development and efficient dependency sharing |
| **Testing & Standards** | [Vitest](https://vitest.dev/) + [Oxlint](https://oxc.rs/) + [Prettier](https://prettier.io/) | Ultra-fast unit testing, oxlint static analysis, and code formatting toolchain |

---

## Documentation

Comprehensive architecture proposals and design guidelines are located in [`docs/`](docs/):

- 📘 [Technical Design Plan](docs/agent/architecture/markdown_editor_technical_plan.md) — Architecture design, state flow, and implementation details
- 📱 [Mobile Architecture Plan](docs/agent/architecture/mobile_support_architecture.md) — Mobile Webview core and native bridge design
- 📐 [Capability Boundary Design Principles](docs/agent/architecture/capability_boundary_design_principles.md) — Module boundaries and decoupling rules
- 🚀 [Automated Release Workflow](docs/agent/release/release_workflow.md) — CI/CD, GitHub Releases, and Homebrew Tap synchronization
- 💡 [Project Background & Origins](docs/human/project.md) — Insights, reflections, and design philosophies

---

## Contributing & Guidelines

For code conventions and Git workflows, please refer to [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md).

---

## License

This project is open source under the [MIT License](LICENSE).

---

<p align="center">
  Copyright © 2026 Inkpoint. All rights reserved.
</p>
