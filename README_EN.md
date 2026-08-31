<p align="center">
  <a href="#inkpoint">
    <img width="180" alt="Inkpoint" src="apps/desktop/public/logo.png">
  </a>
</p>

# Inkpoint

<p align="center">
  A modern, sleek cross-platform Markdown & MDX desktop editor — bringing <b>Typora-like WYSIWYG</b> editing and <b>native MDX interactive component</b> support.
</p>

<p align="center">
  <a href="./README.md">简体中文</a> · <b>English</b>
</p>

<p align="center">
  <a href="#features">Features</a> ·
  <a href="#installation">Installation</a> ·
  <a href="#quick-start">Quick Start</a> ·
  <a href="#architecture">Architecture</a> ·
  <a href="#tech-stack">Tech Stack</a> ·
  <a href="#documentation">Docs</a> ·
  <a href="#license">License</a>
</p>

<p align="center">
  <a href="https://github.com/wmasfoe/homebrew-tap/releases">
    <img src="https://img.shields.io/badge/platform-macOS_%7C_Windows_%7C_Linux-blue?style=flat-square" alt="Platforms">
  </a>
  <a href="https://github.com/wmasfoe/md-editor">
    <img src="https://img.shields.io/badge/built_with-Tauri_2_%2B_React_19-orange?style=flat-square&logo=tauri&logoColor=white" alt="Built with Tauri 2 + React 19">
  </a>
  <a href="https://github.com/wmasfoe/md-editor">
    <img src="https://img.shields.io/badge/editor-Milkdown_%2B_CodeMirror_6-8A2BE2?style=flat-square" alt="Editor">
  </a>
  <a href="https://github.com/wmasfoe/md-editor/releases">
    <img src="https://img.shields.io/badge/version-v0.4.6-brightgreen?style=flat-square" alt="Version">
  </a>
  <img src="https://img.shields.io/badge/license-MIT-green?style=flat-square" alt="License">
</p>

---

## Features

### 🎨 Typora-like WYSIWYG Editing

- **Instant Rendering**: Powered by Milkdown and ProseMirror, Markdown syntax markers disappear as you type and instantly render as formatted rich text.
- **Intuitive Interactions**: Features block drag handles, quick slash commands (`/` to insert elements), and floating formatting toolbars.
- **Seamless Dual Modes**: Switch instantly to source mode powered by CodeMirror 6 with bidirectional, lossless real-time synchronization.

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

### 📂 Workspace & Intelligent Asset Management

- **Workspace Navigation**: Built-in multi-document tree view, tabbed editing, and live Outline heading navigation.
- **Smart Image Assets**: Paste or drop images directly into documents; automatically saved to relative paths (e.g. `./assets`) with standard Markdown links.
- **High Formatting Fidelity**: Full preservation of YAML Frontmatter, raw HTML tags, and custom metadata without AST formatting destruction.

### 🤖 Modular AI Writing Assistant

- **Decoupled AI Engine**: Independent AI layer (`@md-editor/ai`) ready to connect with OpenAI, Claude, DeepSeek, or local models via Ollama.
- **Intelligent Augmentation**: Inline ghost text completions, grammatical polishing, smart summarization, and content expansion.

---

## Installation

Choose the installation method that best fits your operating system:

| Platform | Architecture | Package Format | Notes |
| :--- | :--- | :--- | :--- |
| **macOS** | Apple Silicon (`aarch64`) / Intel (`x86_64`) | `.dmg` | Recommended: Homebrew or one-line script |
| **Windows** | x64 / ARM64 | `.exe` (NSIS Setup) | Silent install script or manual installer |
| **Linux** | x86_64 / aarch64 | `.AppImage` / `.deb` | Standalone AppImage or system package |

### Option 1: One-Line Install Script (Recommended)

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

Download the latest release package directly from [GitHub Releases](https://github.com/wmasfoe/homebrew-tap/releases).

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

# 4. Start documentation website (Optional)
pnpm dev:site

# 5. Run tests and code linters
pnpm test        # Run unit tests
pnpm typecheck   # TypeScript type checks
pnpm lint        # Oxlint + Prettier + Cargo Clippy
```

### Production Build

```bash
# macOS build (Generates .dmg and updater package)
pnpm build:macos

# Linux build (Generates .AppImage and .deb)
pnpm build:linux

# Windows build (Generates NSIS installer)
pnpm build:windows
```

---

## Architecture

This project is organized as a modular Monorepo using `pnpm workspace`:

```
md-editor/
├── apps/
│   ├── desktop/                 # Tauri 2 desktop application (Rust + React Shell)
│   └── site/                    # Inkpoint official website and web documentation
├── packages/
│   ├── editor-core/             # Core editor engine (Milkdown + ProseMirror state/plugins/parsers)
│   ├── editor-ui/               # Editor UI components, floating toolbars, file tree & outline
│   ├── mdx-component-registry/  # MDX component protocol specifications & runtime registry
│   ├── mdx-plugins/             # Built-in MDX components (Alert, Mermaid, KaTeX, Tabs, etc.)
│   ├── markdown-fidelity/       # Markdown / MDX fidelity serializer & AST bidirectional mapping
│   ├── file-system/             # Cross-platform local file system and asset management abstraction
│   ├── ai/                      # AI provider abstraction, streaming parser & prompt protocols
│   └── shared/                  # Common utilities and cross-package type definitions
├── docs/                        # Technical proposals, design docs, and release guidelines
└── scripts/                     # Release automation, Homebrew Cask generator & CI scripts
```

---

## Tech Stack

| Domain | Selected Stack | Description |
| :--- | :--- | :--- |
| **Desktop Runtime** | [Tauri 2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/) | Lightweight, secure, low-resource cross-platform desktop framework |
| **Frontend Architecture**| [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | Modern declarative UI and robust static typing |
| **WYSIWYG Engine** | [Milkdown](https://milkdown.dev/) + [ProseMirror](https://prosemirror.net/) | Extensible plugin-driven rich-text engine with syntax AST flow |
| **Source Code Editor** | [CodeMirror 6](https://codemirror.net/) | High-performance next-generation code and Markdown source engine |
| **Styling & Icons** | [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/) | Modern utility-first CSS framework and crisp icon set |
| **Monorepo Tooling** | [Vite 6](https://vitejs.dev/) + [pnpm Workspace](https://pnpm.io/) | Lightning-fast HMR and efficient workspace dependency sharing |
| **Testing & Quality** | [Vitest](https://vitest.dev/) + [Oxlint](https://oxc.rs/) + [Prettier](https://prettier.io/) | Comprehensive test runner and ultra-fast code quality linter |

---

## Documentation

Full architectural and technical design documents are available in the [`docs/`](docs/) directory:

- 📘 [Technical Plan](docs/agent/architecture/markdown_editor_technical_plan.md) — Architecture design, state transitions, and implementation specs
- 📐 [Boundary Design Principles](docs/agent/architecture/capability_boundary_design_principles.md) — Module boundaries and domain responsibilities
- 🚀 [Release Workflow](docs/agent/release/release_workflow.md) — CI/CD, GitHub Release, and Homebrew Tap automation
- 💡 [Project Background](docs/human/project.md) — Motivations and vision behind Inkpoint

---

## Development Guide

For detailed coding standards and workflows, please see [CLAUDE.md](CLAUDE.md) and [AGENTS.md](AGENTS.md).

---

## License

Released under the [MIT License](LICENSE).

---

<p align="center">
  Copyright © 2026 Inkpoint. All rights reserved.
</p>
