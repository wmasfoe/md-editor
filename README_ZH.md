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
  <a href="./README.md">English</a> · <b>简体中文</b>
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

## 特性

### 🎨 Typora-like 所见即所得编辑
- **即打即显**：基于 CodeMirror 6 投影层深度打造，输入 Markdown 标记即时隐去并渲染为精美排版，保持 100% 纯粹 Markdown 文本事实。
- **单编辑器同构**：所见即所得与源码编辑共享同一个 CodeMirror 6 `EditorView` 实例，模式切换零开销、零延迟，选区、滚动位置与撤销历史无缝保持。
- **直观交互**：行首折叠（Fold Toggle）、块级拖拽手柄、斜杠快捷命令（`/` 快捷插入）、选区悬浮格式化菜单，专注沉浸式输入。
- **专注与打字机模式**：支持当前块高亮/背景淡化（Focus Mode）与光标居中平滑缓动（Typewriter Mode）。

### 🛡️ 信任基石：草稿恢复与历史快照
- **自动草稿恢复 (Hot Exit)**：未保存修改在应用关闭或意外退出时自动暂存；下次启动时展示恢复提示横幅，支持一键还原或安全丢弃，写作无需担忧内容丢失。
- **文档历史版本抽屉**：侧边抽屉自动记录编辑快照，支持直观查看版本间的行级 Diff 差异高亮，支持键盘快速切换历史节点并一键回滚。

### 🔍 专业排版：Markdown 规范检查与导出
- **Markdown Lint 实时检查**：集成 markdownlint 规则引擎，提供波浪下划线标记与浮窗诊断，支持按下 `⌥⇧L` / `Alt+Shift+L` 呼出底部诊断 Dock 面板，支持 `⌥⇧F` / `Alt+Shift+F` 一键批量自动修复。
- **相对链接探针检查**：自动检测文档内相对文件路径与标题锚点（`[标题](#锚点)`）的可达性，避免错链。
- **高质量 HTML 与 PDF 导出**：标题栏直观提供导出入口，一键导出独立自包含的 HTML 文件（完整内联样式、公式、代码高亮与 Mermaid 图表）、原生矢量分页 PDF（带可点击目录大纲），并支持直接复制富文本 HTML 至剪贴板。

### 🔤 CJK 友好与排版增强
- **中文标点与强调兼容**：中文标点紧贴的 `**加粗**`、`*斜体*`、`~~删除线~~`、`==高亮==` 准确识别，不退化为字面字符，不跨段误匹配。
- **智能配对与 Tab 跳出**：光标位于括号或链接内时支持按 `Tab` 智能跳出右边界，空光标不乱闭合干扰手感。
- **本地 SLM 盘古之白与标点**：支持本地端侧小模型一键执行中英文空格与全半角标点智能规范化。

### 🧩 原生 MDX 与交互式组件
- **MDX 深度支持**：无缝混排标准 Markdown 内容与 React / JSX 交互组件。
- **开箱即用官方扩展**：
  - 💬 **Alert / Callout**：多形态信息提示块（Note, Tip, Important, Warning, Caution）。
  - 📊 **Mermaid 图表**：流程图、时序图、类图与状态图实时渲染，单击支持全屏放大、拖拽缩放。
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

### 🤖 模块化 AI 写作助手
- **解耦整洁架构**：独立的 AI 接入层（`@md-editor/ai`），支持统一接入 OpenAI 兼容服务、Anthropic Claude、Google Gemini 或本地端侧模型。
- **端侧小模型 (SLM)**：macOS 原生动态库集成，支持零网络离线端侧推理与 Metal 硬件加速。
- **智能增强**：行内幽灵文本补全（Ghost Text）、语法纠错润色、上下文紧凑蒸馏与审批式内联改写建议。

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

# 4. 启动 Web 在线体验场开发模式
pnpm dev:web

# 5. 启动 uTools 插件开发模式
pnpm dev:utools

# 6. 启动移动端开发模式 (Android / iOS)
pnpm android   # Android 模拟器或真实连接设备
pnpm ios       # iOS 模拟器 (仅限 macOS)

# 7. 启动官网站点开发模式
pnpm dev:site

# 8. 启动边缘分发 Worker 开发模式
pnpm dev:worker

# 9. 运行全仓测试与代码质量验证
pnpm test        # 运行单元测试
pnpm typecheck   # TypeScript 类型检查
pnpm lint        # Oxlint + Prettier + Cargo Clippy
```

### 生产构建

```bash
# 桌面端全平台构建
pnpm build:macos    # macOS (.dmg 与更新包)
pnpm build:linux    # Linux (.AppImage 与 .deb)
pnpm build:windows  # Windows (NSIS 安装包)

# Web 在线体验场构建
pnpm build:web

# 移动端离线 Webview 包构建与同步至原生工程
pnpm build:mobile

# uTools 插件构建
pnpm build:utools

# 官网站点 Next.js 生产构建
pnpm build:site
```

### 多平台发布

所有发布流程收敛于 `release:*` 命令集：

```bash
# 桌面端跨平台发布 (版本自动升级、双语 Changelog、v* 标签推送)
pnpm release:desktop

# Web 体验场发布 (本地预构建并直接部署至 Vercel)
pnpm release:web

# 官网站点部署
pnpm release:site

# Cloudflare Worker 全球分发网关部署
pnpm deploy:worker
```

---

## 项目架构

Inkpoint 采用基于 `pnpm workspace` 的现代化 Monorepo 架构，职责边界严格清晰：

```
md-editor/
├── apps/
│   ├── desktop/                 # Tauri 2 跨平台桌面客户端 (Rust + React 19 Shell)
│   ├── mobile/                  # 移动端多平台套件 (Hybrid Webview + Android Compose + iOS SwiftUI)
│   │   ├── core/                # @md-editor/mobile-core: 移动端离线 Webview 内核与 Bridge
│   │   ├── android/             # Android 原生工程 (Kotlin + Jetpack Compose + SAF)
│   │   └── ios/                 # iOS 原生工程 (Swift 6 + SwiftUI + 分享扩展)
│   ├── utools/                  # uTools 平台沉浸式轻记插件
│   ├── web/                     # Web 在线体验场应用 (Vite + React 19)
│   └── site/                    # Inkpoint 官方网站与动态分发中心 (Next.js App Router)
├── infra/
│   └── distribution-worker/     # Cloudflare Worker 全球边缘分发网关与代理
├── packages/
│   ├── editor-core/             # 编辑器核心 (不可变状态流、有序保存调度、模式切换)
│   ├── renderer-codemirror/     # CodeMirror 6 渲染层 (同构 WYSIWYG 投影、装饰系统、表格、MarkdownLint)
│   ├── editor-ui/               # 编辑器 React UI 组件、浮动栏、历史版本抽屉、文件树、大纲与设置
│   ├── compiler/                # Headless 静态 Markdown 编译器与 HTML/PDF 导出支持
│   ├── syntax-plugins/          # Markdown 语法插件 (高亮、删除线、脚注、KaTeX、Mermaid)
│   ├── mdx-component-registry/  # MDX 组件协议规范与运行时静态元数据注册表
│   ├── mdx-plugins/             # 内置官方交互式 MDX 组件库 (Callout, Alert 卡片等)
│   ├── markdown-fidelity/       # Markdown / MDX 无损保真转换与 AST 双向映射
│   ├── file-system/             # 跨平台抽象文件 I/O、会话草稿 (Hot Exit)、版本历史与链接探针
│   ├── i18n/                    # 全局国际化系统 (Type-Safe 多语言字典与动态语言切换)
│   ├── ai/                      # AI Provider 抽象、流式建议解析与整洁架构多协议 Harness
│   └── shared/                  # 通用 TypeScript 工具库与跨包核心类型
├── docs/                        # 项目设计规范、技术方案、实施状态与发版指南
└── scripts/                     # 自动化发版脚本 (release:*)、移动端同步工具与质量门禁脚本
```

> 💡 每个子包与应用目录下均配有独立的 `README.md`，可前往对应目录查看详尽的技术实现与 API 规范。

---

## 技术栈

| 领域 | 核心技术 | 说明 |
| :--- | :--- | :--- |
| **桌面运行时** | [Tauri 2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/) | 轻量、高安全、极低资源占用的跨平台桌面底座 |
| **移动端原生** | [Jetpack Compose](https://developer.android.com/compose) + [SwiftUI](https://developer.apple.com/xcode/swiftui/) | 原生 Android & iOS 界面、系统级触感反馈与软键盘辅助栏 |
| **前端架构** | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | 现代声明式 UI 与严谨的类型系统保障 |
| **编辑器内核** | [CodeMirror 6](https://codemirror.net/) | 单一 EditorView 承载的同构所见即所得与源码编辑内核 |
| **无头编译器** | `@md-editor/compiler` | 纯静态零 DOM Markdown 编译器，支持 QuickLook 与离线 HTML/PDF 导出 |
| **边缘分发** | [Cloudflare Workers](https://workers.cloudflare.com/) + [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) | 全球多级容灾下载网关与即时缓存失效机制 |
| **样式与图标** | [Tailwind CSS](https://tailwindcss.com/) + [Lucide Icons](https://lucide.dev/) | 原子化样式体系与现代图标库 |
| **工程构建** | [Vite 6](https://vitejs.dev/) + [pnpm Workspace](https://pnpm.io/) | 秒级模块热重载 (HMR) 与高效的 monorepo 依赖共享 |
| **代码质量** | [Vitest](https://vitest.dev/) + [Oxlint](https://oxc.rs/) + [Prettier](https://prettier.io/) | 极速单元测试、静态分析检查与自动化代码格式化 |

---

## 文档导航

详尽的架构方案与设计规范收录于 [`docs/`](docs/) 目录：

- 📘 [Agent 知识库第一层导航](docs/agent/index.md) — 统一架构、状态、规范与路线指南
- 📐 [架构能力边界设计原则](docs/agent/architecture/capability_boundary_design_principles.md) — 模块职责划分与解耦原则
- 🛠️ [VMark 剩余核心能力技术方案](docs/agent/architecture/vmark_remaining_features_technical_plan.md) — Hot Exit、文档历史、Lint 检查与导出方案
- 🚀 [跨平台多端发布流程](docs/agent/release/release_workflow.md) — CI/CD 自动化流水线、版本升级与多渠道分发
- 💡 [项目背景与设计哲学](docs/human/project.md) — 产品定位与思考记录

---

## 贡献规范

参与代码编写与提交请遵守 [AGENTS.md](AGENTS.md) 中的代码结构、分支命名与 Conventional Commit 规范，以及 [仓库结构与命名规范](docs/agent/architecture/repo_structure_and_naming_conventions.md)。

---

## License

Inkpoint 基于 [GNU General Public License v3.0 or later (GPL-3.0-or-later)](LICENSE) 开源许可协议发布。许可证文本详见 [LICENSE](LICENSE)，版权声明见 [NOTICE](NOTICE)。

---

<p align="center">
  Copyright © 2026 Inkpoint. All rights reserved.
</p>
