<p align="center">
  <a href="#inkpoint">
    <img width="180" alt="Inkpoint" src="apps/desktop/public/logo.png">
  </a>
</p>

# Inkpoint

<p align="center">
  A Markdown and MDX editor for macOS, Windows and Linux. It edits in place like Typora, renders MDX components inline, and keeps your files as plain Markdown on disk.
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
  <a href="https://editor.jiaqi.im/#download">
    <img src="https://img.shields.io/badge/platform-macOS_%7C_Windows_%7C_Linux_%7C_Web_%7C_uTools-blue?style=flat-square" alt="Platforms">
  </a>
  <a href="https://github.com/wmasfoe/md-editor">
    <img src="https://img.shields.io/badge/built_with-Tauri_2_%2B_React_19-orange?style=flat-square&logo=tauri&logoColor=white" alt="Built with Tauri 2 + React 19">
  </a>
  <a href="https://github.com/wmasfoe/md-editor">
    <img src="https://img.shields.io/badge/editor-CodeMirror_6-8A2BE2?style=flat-square" alt="Editor">
  </a>
  <a href="https://github.com/wmasfoe/md-editor/releases">
    <img src="https://img.shields.io/github/v/release/wmasfoe/md-editor?label=desktop&style=flat-square&color=brightgreen" alt="Desktop Version">
  </a>
  <a href="#license">
    <img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square" alt="License">
  </a>
</p>

---

## Features

### WYSIWYG editing
- **Edit in place**: Markdown markers hide as you type and the text renders formatted. The file on disk stays plain Markdown.
- **One editor for both modes**: WYSIWYG and source mode share a single CodeMirror 6 `EditorView`, so switching keeps your selection, scroll position and undo history.
- **Editing aids**: line folding, block drag handles, `/` slash commands and a floating format toolbar on selection.
- **Focus and typewriter modes**: focus mode dims everything but the current block; typewriter mode keeps the cursor vertically centered.

### Drafts and history
- **Draft recovery**: unsaved edits are kept when the window closes or the app quits unexpectedly. On the next launch a banner offers to restore or discard them.
- **Document history**: a side drawer keeps local snapshots, shows line-level diffs between versions, supports keyboard navigation and rolls back in one click.

### Checks and export
- **Markdown lint**: markdownlint runs as you type, with wavy underlines and tooltips. `Alt+Shift+L` toggles the diagnostics panel and `Alt+Shift+F` fixes common issues in one pass.
- **Link checks**: relative file paths and in-page heading anchors (`[Title](#heading)`) are checked, so broken links show up before you publish.
- **HTML export**: one self-contained file with the theme CSS, KaTeX formulas, Mermaid diagrams and code highlighting inlined.
- **PDF export**: paginated vector PDF with a clickable outline.
- **Copy as rich text**: copies formatted HTML to the clipboard for email, Notion or a blog editor.

### CJK typography
- **Emphasis next to CJK punctuation**: `**bold**`, `*italic*`, `~~strikethrough~~` and `==highlight==` are recognized when they sit against Chinese or Japanese punctuation.
- **Tab to step out**: `Tab` moves the cursor past a closing bracket or link, and an empty cursor does not auto-close brackets.
- **Spacing and punctuation cleanup**: a local on-device model normalizes spaces between CJK and Latin text and full-width and half-width punctuation.

### MDX and plugins
- **MDX in the document**: mix Markdown with React and JSX components in one file.
- **Built in**: `Callout` (info, warning, success, danger), Mermaid diagrams with click-to-zoom, KaTeX formulas, `:::note` style directives and `==highlight==`.
- **Component registry**: custom MDX components register through `@md-editor/plugin-sdk/mdx`.
- **External plugins**: install plugins from GitHub Releases without rebuilding the app. Write them against [`@md-editor/plugin-sdk`](https://www.npmjs.com/package/@md-editor/plugin-sdk), or fork [inkpoint-plugin-starter](https://github.com/wmasfoe/inkpoint-plugin-starter) for a working example.

### Local first
- **Native shell**: built on Tauri 2 and Rust, so it starts fast and uses less memory than an Electron app.
- **Your files, your folder**: Inkpoint reads and writes files directly and works fully offline. There is no account and no cloud sync.
- **Lossless round trips**: YAML front matter, raw HTML and custom metadata are kept as written.

### Where it runs
- **Desktop (macOS, Windows, Linux)**: outline tree, file watching and in-app updates. On macOS the window uses native vibrancy.
- **Web Playground**: the full editor in a browser. In Chromium browsers it can open a real folder; the draft is kept in `localStorage`.
- **uTools plugin**: a quick-note mode and a full workspace mode.
- **macOS QuickLook**: press Space on a `.md` or `.mdx` file in Finder to preview it, rendered by the headless `@md-editor/compiler`.

### AI writing
- **Providers**: the `@md-editor/ai` layer connects to OpenAI-compatible services, Anthropic Claude, Google Gemini or a local model.
- **On-device model**: on Apple Silicon Macs, a bundled llama runtime runs a local model with Metal acceleration and no network.
- **Suggestions**: inline ghost-text completion, grammar fixes, context summarizing, and rewrite suggestions you accept or reject.

---

## Installation & Downloads

Pick the package for your system:

| Platform | Architecture | Format | Notes |
| :--- | :--- | :--- | :--- |
| macOS | Apple Silicon, Intel | `.dmg` | Homebrew or the install script |
| Windows | x64, ARM64 | `.exe` (NSIS) | Install script or the installer |
| Linux | x86_64, aarch64 | `.AppImage`, `.deb` | AppImage or system package |
| uTools | uTools desktop app | `.upxs` | Search "Inkpoint" in the uTools store |
| Web | Any modern browser | none | Open the [Web Playground](https://editor.jiaqi.im/playground) |

### Install script

- **macOS / Linux**:
  ```bash
  curl -fsSL https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.sh | sh
  ```

- **Windows (PowerShell)**:
  ```powershell
  irm https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.ps1 | iex
  ```

### Homebrew (macOS)

```bash
brew install --cask wmasfoe/tap/md-editor
```

### Manual download

Get the installer from the [download page](https://editor.jiaqi.im/#download) or [GitHub Releases](https://github.com/wmasfoe/md-editor/releases).

> [!TIP]
> The install script and Homebrew clear the Gatekeeper quarantine flag for you. If you download the `.dmg` by hand and macOS says the app is damaged or the developer cannot be verified, run:
> ```bash
> xattr -dr com.apple.quarantine /Applications/Inkpoint.app
> ```

---

## Quick Start

### Prerequisites

- **Node.js**: the version in `.node-version`
- **pnpm**: 11.6.0 or later (`corepack enable`)
- **Rust**: latest stable toolchain, for the Tauri desktop build

### Local Development

```bash
# 1. Clone the repository
git clone https://github.com/wmasfoe/md-editor.git
cd md-editor

# 2. Install workspace dependencies
pnpm install

# 3. Run the desktop app (starts Vite and opens the Tauri window)
pnpm tauri dev

# Front end only, in a browser
pnpm dev:desktop

# 4. Run the Web Playground
pnpm dev:web

# 5. Run the uTools plugin
pnpm dev:utools

# 6. Run the website
pnpm dev:site

# 7. Run the distribution worker
pnpm dev:worker

# 8. Tests and checks
pnpm test        # unit tests
pnpm typecheck   # TypeScript
pnpm lint        # Oxlint, Prettier, Cargo Clippy
```

### Production Build

```bash
# Desktop
pnpm build:macos    # .dmg (the updater package comes from build:macos:release)
pnpm build:linux    # .AppImage and .deb
pnpm build:windows  # NSIS installer

# Web Playground, uTools plugin, website
pnpm build:web
pnpm build:utools
pnpm build:site
```

### Releases

```bash
pnpm release:desktop   # bump version, write both changelogs, tag v*
pnpm release:web       # build locally and deploy to Vercel
pnpm release:site      # deploy the website
pnpm deploy:worker     # deploy the Cloudflare Worker
```

---

## Architecture

A pnpm workspace monorepo:

```
md-editor/
├── apps/
│   ├── desktop/                 # Tauri 2 desktop app (Rust + React 19)
│   ├── utools/                  # uTools plugin
│   ├── web/                     # Web Playground (Vite + React 19)
│   └── site/                    # Website and download center (Next.js)
├── infra/
│   └── distribution-worker/     # Cloudflare Worker download gateway (R2 with fallback)
├── packages/
│   ├── editor-core/             # Document state, ordered saves, mode switching
│   ├── renderer-codemirror/     # CodeMirror 6 layer: WYSIWYG projection, decorations, tables, lint
│   ├── editor-ui/               # React UI: toolbars, history drawer, file tree, settings
│   ├── compiler/                # Headless Markdown compiler and HTML exporter
│   ├── syntax-plugins/          # Syntax plugins: highlight, KaTeX, Mermaid, directives
│   ├── plugin-sdk/              # Plugin API for external authors (npm: @md-editor/plugin-sdk)
│   ├── plugin-host/             # Plugin host: loading, lifecycle, registries, GitHub release client
│   ├── mdx-plugins/             # Built-in MDX components (Callout)
│   ├── markdown-fidelity/       # Lossless Markdown and MDX round trips
│   ├── file-system/             # File I/O, draft recovery, history, link checks
│   ├── i18n/                    # Localization (en, zh, zh-Hant, ja)
│   ├── ai/                      # AI providers and streaming suggestion parser
│   └── shared/                  # Shared utilities and types
├── docs/                        # Design notes and release guides
└── scripts/                     # Release scripts (release:*) and CI helpers
```

Most packages and apps have their own `README.md`.

---

## Tech Stack

| Area | Technology | Used for |
| :--- | :--- | :--- |
| **Desktop Runtime** | [Tauri 2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/) | Desktop shell |
| **Frontend Architecture** | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | UI and type checking |
| **Editor Core** | [CodeMirror 6](https://codemirror.net/) | WYSIWYG and source editing on one `EditorView` |
| **Headless Compiler** | `@md-editor/compiler` | Markdown to HTML without a DOM, for QuickLook and export |
| **Edge Distribution** | [Cloudflare Workers](https://workers.cloudflare.com/) + [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) | Download gateway with fallback tiers |
| **Styling** | [Tailwind CSS](https://tailwindcss.com/) + [Heroicons](https://heroicons.com/) | Styles and icons |
| **Monorepo Build** | [Vite 6](https://vitejs.dev/) + [pnpm Workspace](https://pnpm.io/) | Dev server and workspace dependencies |
| **Testing & Standards** | [Vitest](https://vitest.dev/) + [Oxlint](https://oxc.rs/) + [Prettier](https://prettier.io/) | Tests, linting and formatting |

---

## Documentation

Design notes and guides are in [`docs/`](docs/):

- [Docs index](docs/agent/index.md): architecture, status, specs and roadmaps
- [Capability boundaries](docs/agent/architecture/capability_boundary_design_principles.md): module boundaries and decoupling rules
- [Draft recovery, history, lint and export](docs/agent/architecture/vmark_remaining_features_technical_plan.md)
- [Release workflow](docs/agent/release/release_workflow.md): CI, GitHub Releases and distribution
- [Project background](docs/human/project.md)

---

## Contributing

Code conventions and the Git workflow are in [AGENTS.md](AGENTS.md) and the [repository structure and naming rules](docs/agent/architecture/repo_structure_and_naming_conventions.md).

---

## License

Inkpoint is released under the [GNU General Public License v3.0 or later](LICENSE). The copyright notice is in [NOTICE](NOTICE).

---

<p align="center">
  Copyright © 2026 Inkpoint. All rights reserved.
</p>
