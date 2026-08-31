<p align="center">
  <a href="#inkpoint">
    <img width="180" alt="Inkpoint" src="apps/desktop/public/logo.png">
  </a>
</p>

# Inkpoint

<p align="center">
  现代化的跨平台 Markdown & MDX 桌面编辑器 —— 提供 <b>Typora-like 所见即所得</b> 编辑体验与 <b>原生 MDX 交互组件</b> 支持。
</p>

<p align="center">
  <b>简体中文</b> · <a href="./README_EN.md">English</a>
</p>

<p align="center">
  <a href="#特性">特性</a> ·
  <a href="#安装指南">安装指南</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#项目架构">项目架构</a> ·
  <a href="#技术栈">技术栈</a> ·
  <a href="#文档导航">文档导航</a> ·
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

## 特性

### 🎨 Typora-like 所见即所得

- **即打即显**：基于 Milkdown 与 ProseMirror 打造，输入 Markdown 标记即时隐去并渲染为富文本排版。
- **直观交互**：提供块级拖拽手柄（Block Handle）、斜杠快捷命令（`/` 快捷插入）及悬浮格式化菜单。
- **双模秒切**：内置高性能源码编辑模式（CodeMirror 6 驱动），支持富文本与源码实时无损双向同步。

### 🧩 原生 MDX 与交互式组件

- **MDX 深度支持**：无缝混排标准 Markdown 内容与 React / JSX 交互组件。
- **开箱即用官方扩展**：
  - 💬 **Alert / Callout**：多形态信息提示块（Note, Tip, Important, Warning, Caution）。
  - 📊 **Mermaid 图表**：流程图、时序图、类图与状态图实时渲染。
  - 🧮 **LaTeX 数学公式**：基于 KaTeX 极速排版行内公式与独立公式块。
  - 💻 **代码沙盒与高亮**：支持 CodeSandbox 嵌入与多语言语法高亮代码块。
  - 📑 **Tabs 多标签页**：方便呈现多语言代码或对照内容。
- **组件注册表机制**：模块化组件协议（`@md-editor/mdx-component-registry`），支持灵活扩展自定义业务组件。

### ⚡ 极速轻量与本地优先

- **原生性能**：基于 Tauri 2 + Rust 原生底层构建，冷启动毫秒级响应，内存占用远低于传统 Electron 应用。
- **本地优先（Local-First）**：直读直写本地目录，无私有云端绑定，100% 支持完全离线使用，保障数据安全与隐私。

### 📂 智能资源与工作区管理

- **工作区导航**：内置多文档目录树、多标签页快速切换以及实时大纲（Outline）目录导航。
- **智能图片归档**：从剪贴板粘贴或拖拽外部图片，自动保存至相对路径（如 `./assets`）并生成标准 Markdown 引用链接。
- **格式高度保真**：完好保留 YAML Frontmatter、原生 HTML 标签及自定义元数据，避免格式破坏。

### 🤖 模块化 AI 辅助写作

- **解耦设计**：独立的 AI 接入层（`@md-editor/ai`），支持无缝接入 OpenAI、Claude、DeepSeek 或 Ollama 本地模型。
- **智能增强**：支持行内幽灵文本补全（Ghost Text）、语法纠错润色与文本摘要扩展。

---

## 安装指南

你可以根据操作系统选择最适合的安装方式：

| 平台 | 架构 | 安装包产物 / 格式 | 说明 |
| :--- | :--- | :--- | :--- |
| **macOS** | Apple Silicon (`aarch64`) / Intel (`x86_64`) | `.dmg` | 推荐使用 Homebrew 或一键脚本安装 |
| **Windows** | x64 / ARM64 | `.exe` (NSIS 安装包) | 一键静默安装或手动安装向导 |
| **Linux** | x86_64 / aarch64 | `.AppImage` / `.deb` | 免安装 AppImage 或系统软件包 |

### 方式一：一键脚本安装（推荐）

- **macOS / Linux**：
  ```bash
  curl -fsSL https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.sh | sh
  ```

- **Windows (PowerShell)**：
  ```powershell
  irm https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.ps1 | iex
  ```

### 方式二：包管理器 (macOS)

使用 [Homebrew](https://brew.sh/) 一键安装：

```bash
brew install --cask wmasfoe/tap/md-editor
```

### 方式三：手动下载

前往 [GitHub Releases](https://github.com/wmasfoe/homebrew-tap/releases) 页面下载对应系统的最新发布包。

> [!TIP]
> **macOS 隔离标记说明**：一键安装脚本与 Homebrew 会自动处理 Gatekeeper 隔离标记。若是手动下载 `.dmg` 安装并在打开时提示“App 已损坏”或“无法验证开发者”，可以在终端中执行以下命令解除隔离：
> ```bash
> xattr -dr com.apple.quarantine /Applications/Inkpoint.app
> ```

---

## 快速开始

### 前置要求

- **Node.js**：18+（推荐使用仓库中的 `.node-version`）
- **pnpm**：11.6.0+（可通过 `corepack enable` 启用）
- **Rust**：最新稳定版工具链（用于 Tauri 桌面端编译）

### 本地开发

```bash
# 1. 克隆项目仓库
git clone https://github.com/wmasfoe/md-editor.git
cd md-editor

# 2. 安装项目依赖
pnpm install

# 3. 启动桌面端开发模式 (Vite + Tauri)
pnpm dev

# 4. 启动官网开发模式 (可选)
pnpm dev:site

# 5. 执行测试与代码检查
pnpm test        # 运行单元测试
pnpm typecheck   # 类型检查
pnpm lint        # Oxlint + Prettier + Cargo Clippy 检查
```

### 生产构建

```bash
# macOS 构建（生成 .dmg 与 updater 更新包）
pnpm build:macos

# Linux 构建（生成 .AppImage 与 .deb）
pnpm build:linux

# Windows 构建（生成 NSIS 安装包）
pnpm build:windows
```

---

## 项目架构

本项目采用基于 `pnpm workspace` 的现代 Monorepo 架构，职责边界清晰：

```
md-editor/
├── apps/
│   ├── desktop/                 # Tauri 2 桌面应用主工程 (Rust + React Shell)
│   └── site/                    # Inkpoint 官方网站与在线文档
├── packages/
│   ├── editor-core/             # 编辑器核心（Milkdown + ProseMirror 状态/插件/解析）
│   ├── editor-ui/               # 编辑器 UI 视图组件、悬浮工具栏、文件树与大纲
│   ├── mdx-component-registry/  # MDX 组件协议规范与运行时注册表
│   ├── mdx-plugins/             # 官方内置 MDX 组件（Alert, Mermaid, KaTeX, Tabs 等）
│   ├── markdown-fidelity/       # Markdown / MDX 格式保真转换与 AST 双向映射
│   ├── file-system/             # 跨平台本地文件系统读写与图片资产管理抽象
│   ├── ai/                      # AI Provider 抽象、写作建议流式解析与提示词协议
│   └── shared/                  # 通用工具函数库与跨包共享类型定义
├── docs/                        # 项目设计、技术方案与发版说明文档
└── scripts/                     # 自动化发版、Homebrew Cask 生成与 CI 辅助脚本
```

---

## 技术栈

| 领域 | 核心选型 | 说明 |
| :--- | :--- | :--- |
| **桌面运行时** | [Tauri 2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/) | 轻量、安全、低资源消耗的跨平台桌面应用方案 |
| **前端架构** | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | 现代化声明式 UI 开发与严谨的类型系统 |
| **所见即所得核心** | [Milkdown](https://milkdown.dev/) + [ProseMirror](https://prosemirror.net/) | 可扩展的插件化富文本引擎与语法树状态流 |
| **源码编辑器** | [CodeMirror 6](https://codemirror.net/) | 高性能的下一代代码与 Markdown 源码编辑引擎 |
| **样式与视觉** | [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/) | 实用原子化样式与现代化图标库 |
| **Monorepo 构建** | [Vite 6](https://vitejs.dev/) + [pnpm Workspace](https://pnpm.io/) | 极速热重载开发体验与高效依赖复用 |
| **测试与规范** | [Vitest](https://vitest.dev/) + [Oxlint](https://oxc.rs/) + [Prettier](https://prettier.io/) | 极速单测运行与代码质量保障工具链 |

---

## 文档导航

完整的技术方案与设计规范收录在 [`docs/`](docs/) 目录：

- 📘 [技术设计方案](docs/agent/architecture/markdown_editor_technical_plan.md) — 架构设计、状态流转与实现细节
- 📐 [架构能力边界设计原则](docs/agent/architecture/capability_boundary_design_principles.md) — 各核心模块职责划分与设计规范
- 🚀 [自动化发版流程](docs/agent/release/release_workflow.md) — CI/CD、GitHub Release 与 Homebrew Tap 同步机制
- 💡 [项目背景与起源](docs/human/project.md) — 项目背后的思考与设计初衷

---

## 开发指南

详细的代码规范与工作流说明请参考 [CLAUDE.md](CLAUDE.md) 与 [AGENTS.md](AGENTS.md)。

---

## License

本项目遵循 [MIT License](LICENSE) 开源协议。

---

<p align="center">
  Copyright © 2026 Inkpoint. All rights reserved.
</p>
