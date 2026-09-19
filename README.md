<p align="center">
  <a href="#inkpoint">
    <img width="180" alt="Inkpoint" src="apps/desktop/public/logo.png">
  </a>
</p>

# Inkpoint

<p align="center">
  一个现代化、跨平台的 Markdown & MDX 编辑器 —— 提供 <b>所见即所得</b> 的编辑体验、<b>原生 MDX 交互组件</b> 与 <b>全端全场景协同</b>。
</p>

<p align="center">
  <b>简体中文</b> · <a href="./README_EN.md">English</a>
</p>

<p align="center">
  <a href="#特性">特性</a> ·
  <a href="#安装与下载">安装与下载</a> ·
  <a href="#快速开始">快速开始</a> ·
  <a href="#项目架构">项目架构</a> ·
  <a href="#技术栈">技术栈</a> ·
  <a href="#文档导航">文档导航</a> ·
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
  <a href="#license">
    <img src="https://img.shields.io/badge/license-GPL--3.0-blue?style=flat-square" alt="License">
  </a>
</p>

---

## 特性

### 🎨 Typora-like 所见即所得
- **即打即显**：基于 CodeMirror 6 投影层深度打造，输入 Markdown 标记即时隐去并渲染为精美排版，保持 100% 纯粹 Markdown 文本事实。
- **单编辑器同构**：所见即所得与源码编辑共享同一个 CodeMirror 6 `EditorView` 实例，模式切换零开销、零延迟、选区与撤销历史无缝保持。
- **直观交互**：提供行首折叠（Fold Toggle）、块级拖拽手柄、斜杠快捷命令（`/` 快捷插入）及选区悬浮格式化菜单。

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
- **格式高度保真**：完好保留 YAML Frontmatter、原生 HTML 标签及自定义元数据，避免格式被格式化工具破坏。

### 📱 全场景与多端协同
- **桌面客户端 (macOS / Windows / Linux)**：原生窗口质感（macOS Liquid Glass 毛玻璃效果）、多标签页、大纲树、文件监听与差量自动更新。
- **移动端套件 (Android / iOS)**：即览（Jilan）产品哲学，离线 Webview 渲染内核结合原生软键盘工具栏（`KeyboardAccessoryBar`）与系统级触感反馈。
- **Web 在线体验场 (Playground)**：基于虚拟内存文件系统，零安装在浏览器中体验完整编辑器功能。
- **uTools 效率插件**：双模式设计（无干扰随手记模式与完整工作区模式），物理隔离零技术债。
- **macOS QuickLook 快速预览**：内置 Headless 静态编译器（`@md-editor/compiler`），在 Finder 中按空格键秒级渲染 Markdown / MDX。

### 🤖 模块化 AI 辅助写作
- **解耦设计**：独立的 AI 接入层（`@md-editor/ai`），支持无缝接入 OpenAI、Claude、DeepSeek 或 Ollama 本地小模型（SLM）。
- **智能增强**：支持行内幽灵文本补全（Ghost Text）、语法纠错润色、上下文紧凑蒸馏与文本摘要扩展。

---

## 安装与下载

你可以根据设备与平台选择最适合的安装方式：

| 平台 | 架构 / 环境 | 安装包产物 / 格式 | 说明 |
| :--- | :--- | :--- | :--- |
| **macOS** | Apple Silicon (`aarch64`) / Intel (`x86_64`) | `.dmg` | 推荐使用 Homebrew 或一键脚本安装 |
| **Windows** | x64 / ARM64 | `.exe` (NSIS 安装包) | 一键静默安装或手动安装向导 |
| **Linux** | x86_64 / aarch64 | `.AppImage` / `.deb` | 免安装 AppImage 或系统软件包 |
| **Android** | ARM64 / x86_64 (Android 8.0+) | `.apk` (安装包) | 移动端即览阅读与随手记（支持官网直链高速下载） |
| **uTools** | 跨平台桌面应用环境 | `.upxs` (插件离线包) | uTools 插件中心搜索「Inkpoint」或一键呼出速记 |
| **Web** | 现代化 Web 浏览器 | 在线即用 (SPA) | 零安装直接访问 [Web Playground](https://editor.justdev.cn) |

### 方式一：一键脚本安装 (桌面端推荐)

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

前往 [官方下载中心](https://editor.justdev.cn/download) 或 [GitHub Releases](https://github.com/wmasfoe/md-editor/releases) 页面下载对应系统与移动端的最新安装包。

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

# 2. 安装依赖
pnpm install

# 3. 启动桌面端开发模式 (Vite + Tauri)
pnpm dev

# 4. 启动 Web 在线 Playground 开发模式
pnpm dev:web

# 5. 启动 uTools 插件开发模式
pnpm dev:utools

# 6. 启动移动端开发 (Android / iOS)
pnpm android   # Android 模拟器/真机
pnpm ios       # iOS 模拟器 (macOS 专属)

# 7. 启动官网开发模式
pnpm dev:site

# 8. 启动边缘分发 Worker 开发模式
pnpm dev:worker

# 9. 执行全局测试与代码规范检查
pnpm test        # 运行单元测试
pnpm typecheck   # 类型检查
pnpm lint        # Oxlint + Prettier + Cargo Clippy 检查
```

### 生产构建

```bash
# 跨平台桌面端构建
pnpm build:macos    # macOS (.dmg 与 updater 更新包)
pnpm build:linux    # Linux (.AppImage 与 .deb)
pnpm build:windows  # Windows (NSIS 安装包)

# Web 在线端静态构建
pnpm build:web

# 移动端离线 Webview 内核构建并自动同步至 iOS / Android 原生工程
pnpm build:mobile

# uTools 插件打包构建 (生成 dist/ 离线包产物)
pnpm build:utools

# 官网 Next.js 生产构建
pnpm build:site
```

### 多端发版与发布

所有发版命令收敛于统一的 `release:*` 命名空间：

```bash
# 桌面端跨平台发版（交互式更新版本、双 Changelog 写入并创建 v* tag）
pnpm release:desktop

# Web 在线版部署（本地构建并一键发布至 Vercel 生产环境）
pnpm release:web

# 官网部署上线
pnpm release:site

# 边缘分发网关部署上线 (Cloudflare Worker)
pnpm deploy:worker

# 移动端发版：更新版本后推送 android-v* 标签触发全自动 CI/CD 构建与 R2 分发
git tag android-v0.1.1
git push origin android-v0.1.1
```

---

## 项目架构

本项目采用基于 `pnpm workspace` 的现代 Monorepo 架构，职责边界清晰：

```
md-editor/
├── apps/
│   ├── desktop/                 # Tauri 2 跨平台桌面客户端 (Rust + React 19 Shell)
│   ├── mobile/                  # 移动端跨平台套件 (Hybrid Webview + Android Compose + iOS SwiftUI)
│   │   ├── core/                # @md-editor/mobile-core: 移动端离线 Webview 内核与通信 Bridge
│   │   ├── android/             # Android 原生工程 (Kotlin + Jetpack Compose + SAF)
│   │   └── ios/                 # iOS 原生工程 (Swift 6 + SwiftUI + Share Extension)
│   ├── utools/                  # uTools 平台快速呼出沉浸式轻量插件 (物理隔离零技术债设计)
│   └── web/                     # Web 在线 Playground 编辑器应用 (Vite + React 19)
├── site/                        # Inkpoint 官方展示网站与动态版本下载中心 (Next.js App Router)
├── infra/
│   └── distribution-worker/     # Cloudflare Worker 全球边缘分发网关与安装包动态代理服务 (R2 + Fallback)
├── packages/
│   ├── editor-core/             # 编辑器核心（文档状态流、并发保序保存调度器、模式切换契约）
│   ├── renderer-codemirror/     # CodeMirror 6 渲染层（单实例 WYSIWYG 投影、装饰器、表格、代码块）
│   ├── editor-ui/               # 编辑器 React UI 视图组件、悬浮工具栏、文件树与实时大纲导航
│   ├── compiler/                # Headless 极速静态 Markdown 编译器与 HTML 渲染器 (QuickLook / Worker)
│   ├── syntax-plugins/          # Markdown 语法扩展插件（高亮、删除线、脚注、公式 KaTeX、图表 Mermaid）
│   ├── mdx-component-registry/  # MDX 组件协议规范与运行时静态元数据注册表
│   ├── mdx-plugins/             # 官方内置 MDX 交互组件（Callout 提示卡片等）
│   ├── markdown-fidelity/       # Markdown / MDX 格式保真转换与 AST 双向映射
│   ├── file-system/             # 跨平台本地文件系统读写、持久化与图片资产管理抽象
│   ├── i18n/                    # 多语言国际化系统（中/英类型安全本地化词典与切换协议）
│   ├── ai/                      # AI Provider 抽象、写作建议流式解析与上下文紧凑蒸馏
│   └── shared/                  # 通用工具函数库与跨包共享核心类型定义
├── docs/                        # 项目设计、技术方案与发版说明文档
└── scripts/                     # 自动化发版（release:*）、移动端产物同步与 CI 辅助脚本
```

> 💡 每个子包与应用目录下均配有独立的 `README.md`，可前往对应目录查看详尽的技术实现与 API 规范。

---

## 技术栈

| 领域 | 核心选型 | 说明 |
| :--- | :--- | :--- |
| **桌面运行时** | [Tauri 2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/) | 轻量、安全、低资源消耗的跨平台桌面应用方案 |
| **移动端原生** | [Jetpack Compose](https://developer.android.com/compose) + [SwiftUI](https://developer.apple.com/xcode/swiftui/) | Android 与 iOS 原生 UI、系统触感、快捷工具栏与分享扩展 |
| **前端架构** | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | 现代化声明式 UI 开发与严谨的类型系统 |
| **编辑器核心** | [CodeMirror 6](https://codemirror.net/) | 基于单 EditorView 的高性能下一代所见即所得与源码统一编辑器 |
| **Headless 编译** | `@md-editor/compiler` | 纯逻辑零 DOM 静态 Markdown 编译，支持 macOS QuickLook 与 Worker |
| **边缘分发** | [Cloudflare Workers](https://workers.cloudflare.com/) + [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) | 全球多级容灾下载网关与动态版本缓存即时生效 |
| **样式与视觉** | [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/) | 实用原子化样式与现代化图标库 |
| **Monorepo 构建** | [Vite 6](https://vitejs.dev/) + [pnpm Workspace](https://pnpm.io/) | 极速热重载开发体验与高效依赖复用 |
| **测试与规范** | [Vitest](https://vitest.dev/) + [Oxlint](https://oxc.rs/) + [Prettier](https://prettier.io/) | 极速单测运行与代码质量保障工具链 |

---

## 文档导航

完整的技术方案与设计规范收录在 [`docs/`](docs/) 目录：

- 📘 [技术设计方案](docs/agent/architecture/markdown_editor_technical_plan.md) — 架构设计、状态流转与实现细节
- 📱 [移动端架构方案](docs/agent/architecture/mobile_support_architecture.md) — 移动端 Webview 内核与原生通信桥接设计
- 📐 [架构能力边界设计原则](docs/agent/architecture/capability_boundary_design_principles.md) — 各核心模块职责划分与设计规范
- 🚀 [自动化发版流程](docs/agent/release/release_workflow.md) — CI/CD、GitHub Release 与 Homebrew Tap 同步机制
- 💡 [项目背景与起源](docs/human/project.md) — 项目背后的思考与设计初衷

---

## 开发指南

详细的代码规范与工作流说明请参考 [CLAUDE.md](CLAUDE.md) 与 [AGENTS.md](AGENTS.md)。

---

## License

本项目遵循 [GNU General Public License v3.0 (GPL-3.0)](LICENSE) 开源协议（针对 iOS 客户端包含 [Apple App Store 豁免条款](LICENSE)）。严格防止第三方闭源套壳、恶意改名与商业转售，保障开源社区与用户的长久自由。

详见根目录完整 [LICENSE](LICENSE) 协议文件。

---

<p align="center">
  Copyright © 2026 Inkpoint. All rights reserved.
</p>
