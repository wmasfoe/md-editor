<p align="center">
  <a href="#inkpoint">
    <img width="180" alt="Inkpoint" src="apps/desktop/public/logo.png">
  </a>
</p>

# Inkpoint

<p align="center">
  适用于 macOS、Windows 和 Linux 的 Markdown / MDX 编辑器。像 Typora 一样就地编辑，在文档里直接渲染 MDX 组件，文件在磁盘上始终是纯 Markdown。
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

## 特性

### 所见即所得编辑
- **就地编辑**：输入 Markdown 标记后，标记自动隐去，文字按排版渲染。磁盘上的文件仍是纯 Markdown。
- **两种模式共用一个编辑器**：所见即所得与源码模式共用同一个 CodeMirror 6 `EditorView`，切换时选区、滚动位置和撤销历史都保留。
- **编辑辅助**：行折叠、块拖拽手柄、`/` 斜杠命令，选中文字后弹出格式工具栏。
- **专注与打字机模式**：专注模式只突出当前块，其余淡化；打字机模式让光标保持在垂直居中位置。

### 草稿与历史
- **草稿恢复**：窗口关闭或应用意外退出时，未保存的修改会被暂存。下次启动时横幅提示，可以还原，也可以丢弃。
- **文档历史**：侧边抽屉保存本地快照，显示版本之间的行级 Diff，支持键盘切换，一键回滚。

### 检查与导出
- **Markdown Lint**：内置 markdownlint，用波浪线和浮窗提示问题。`Alt+Shift+L` 开关诊断面板，`Alt+Shift+F` 一次修复常见问题。
- **链接检查**：检查文档里的相对文件路径和标题锚点（`[标题](#锚点)`），发布前就能发现错链。
- **HTML 导出**：生成单个自包含文件，内联主题样式、KaTeX 公式、Mermaid 图表和代码高亮。
- **PDF 导出**：矢量分页 PDF，带可点击的目录。
- **复制为富文本**：把排版后的 HTML 复制到剪贴板，可直接粘到邮件、Notion 或博客编辑器。

### 中日文排版
- **标点旁的强调语法**：`**加粗**`、`*斜体*`、`~~删除线~~`、`==高亮==` 紧贴中日文标点时仍能识别。
- **Tab 跳出**：光标在括号或链接内时，按 `Tab` 跳到右边界；空光标不会自动补全括号。
- **空格与标点整理**：本地端侧模型可以规范中英文之间的空格，以及全角、半角标点。

### MDX 与插件
- **文档里直接写 MDX**：同一个文件里混排 Markdown 与 React / JSX 组件。
- **内置功能**：`Callout`（info、warning、success、danger）、可点击放大的 Mermaid 图表、KaTeX 公式、`:::note` 一类的指令语法、`==高亮==`。
- **组件注册表**：自定义 MDX 组件通过 `@md-editor/plugin-sdk/mdx` 注册。
- **外部插件**：无需重新编译应用，从 GitHub Release 安装插件。基于 [`@md-editor/plugin-sdk`](https://www.npmjs.com/package/@md-editor/plugin-sdk) 开发，也可以 Fork [inkpoint-plugin-starter](https://github.com/wmasfoe/inkpoint-plugin-starter) 作为可运行的起点。

### 本地优先
- **原生外壳**：基于 Tauri 2 和 Rust，启动快，内存占用比 Electron 应用低。
- **文件在你自己的目录里**：直接读写本地文件，完全离线可用，没有账号，也没有云同步。
- **往返不丢内容**：YAML Front Matter、原生 HTML 和自定义元数据原样保留。

### 运行环境
- **桌面端（macOS / Windows / Linux）**：大纲树、文件监听、应用内更新。macOS 上窗口使用系统毛玻璃效果。
- **Web Playground**：在浏览器里使用完整编辑器。Chromium 内核的浏览器可以直接打开本地文件夹，草稿保存在 `localStorage`。
- **uTools 插件**：提供随手记模式和完整工作区模式。
- **macOS QuickLook**：在 Finder 里选中 `.md` 或 `.mdx` 文件按空格即可预览，由无头的 `@md-editor/compiler` 渲染。

### AI 写作
- **接入的模型**：`@md-editor/ai` 可连接 OpenAI 兼容服务、Anthropic Claude、Google Gemini 或本地模型。
- **端侧模型**：Apple Silicon 的 Mac 上，随应用打包的 llama 运行时用 Metal 加速，不联网即可推理。
- **建议类型**：行内幽灵文本补全、语法纠错、上下文摘要，以及可以接受或拒绝的改写建议。

---

## 安装与下载

按系统选择安装包：

| 平台 | 架构 | 格式 | 说明 |
| :--- | :--- | :--- | :--- |
| macOS | Apple Silicon、Intel | `.dmg` | 用 Homebrew 或安装脚本 |
| Windows | x64、ARM64 | `.exe`（NSIS） | 安装脚本或安装向导 |
| Linux | x86_64、aarch64 | `.AppImage`、`.deb` | AppImage 或系统软件包 |
| uTools | uTools 桌面应用 | `.upxs` | 在 uTools 插件中心搜索「Inkpoint」 |
| Web | 主流浏览器 | 无 | 打开 [Web Playground](https://editor.jiaqi.im/playground) |

### 安装脚本

- **macOS / Linux**：
  ```bash
  curl -fsSL https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.sh | sh
  ```

- **Windows (PowerShell)**：
  ```powershell
  irm https://raw.githubusercontent.com/wmasfoe/homebrew-tap/main/install-md-editor.ps1 | iex
  ```

### Homebrew（macOS）

```bash
brew install --cask wmasfoe/tap/md-editor
```

### 手动下载

从[下载页](https://editor.jiaqi.im/#download)或 [GitHub Releases](https://github.com/wmasfoe/md-editor/releases) 获取安装包。

> [!TIP]
> 安装脚本和 Homebrew 会帮你清除 Gatekeeper 隔离标记。如果是手动下载的 `.dmg`，打开时提示“App 已损坏”或“无法验证开发者”，在终端执行：
> ```bash
> xattr -dr com.apple.quarantine /Applications/Inkpoint.app
> ```

---

## 快速开始

### 前置要求

- **Node.js**：`.node-version` 里指定的版本
- **pnpm**：11.6.0 及以上（`corepack enable`）
- **Rust**：最新稳定版，用于编译 Tauri 桌面端

### 本地开发

```bash
# 1. 克隆仓库
git clone https://github.com/wmasfoe/md-editor.git
cd md-editor

# 2. 安装依赖
pnpm install

# 3. 运行桌面端（启动 Vite 并打开 Tauri 窗口）
pnpm tauri dev

# 仅前端，在浏览器里运行
pnpm dev:desktop

# 4. 运行 Web Playground
pnpm dev:web

# 5. 运行 uTools 插件
pnpm dev:utools

# 6. 运行官网
pnpm dev:site

# 7. 运行分发 Worker
pnpm dev:worker

# 8. 测试与检查
pnpm test        # 单元测试
pnpm typecheck   # TypeScript 类型检查
pnpm lint        # Oxlint、Prettier、Cargo Clippy
```

### 生产构建

```bash
# 桌面端
pnpm build:macos    # .dmg（更新包由 build:macos:release 生成）
pnpm build:linux    # .AppImage 与 .deb
pnpm build:windows  # NSIS 安装包

# Web Playground、uTools 插件、官网
pnpm build:web
pnpm build:utools
pnpm build:site
```

### 发布

```bash
pnpm release:desktop   # 升版本号，写中英文 Changelog，打 v* 标签
pnpm release:web       # 本地构建并部署到 Vercel
pnpm release:site      # 部署官网
pnpm deploy:worker     # 部署 Cloudflare Worker
```

---

## 项目架构

基于 pnpm workspace 的 monorepo：

```
md-editor/
├── apps/
│   ├── desktop/                 # Tauri 2 桌面端 (Rust + React 19)
│   ├── utools/                  # uTools 插件
│   ├── web/                     # Web Playground (Vite + React 19)
│   └── site/                    # 官网与下载中心 (Next.js)
├── infra/
│   └── distribution-worker/     # Cloudflare Worker 下载网关 (R2，带兜底)
├── packages/
│   ├── core/                    # 文档状态、命令、快捷键与无头运行时
│   ├── editor/                  # 框架无关的浏览器编辑器：CodeMirror 6、事务与交互
│   │   └── src/react/          # 可选 @md-editor/editor/react 子入口
│   ├── app-ui/                  # 应用 UI：编辑器接线、大纲、工具栏、设置与主题
│   ├── compiler/                # 无头 Markdown 编译器与 HTML 导出
│   ├── syntax-plugins/          # 语法插件：高亮、KaTeX、Mermaid、指令
│   ├── plugin-sdk/              # 面向外部作者的插件 API (npm：@md-editor/plugin-sdk)
│   ├── plugin-host/             # 插件宿主：加载、生命周期、注册表、GitHub Release 客户端
│   ├── mdx-plugins/             # 内置 MDX 组件 (Callout)
│   ├── markdown-fidelity/       # Markdown 与 MDX 的无损往返
│   ├── file-system/             # 文件 I/O、草稿恢复、版本历史、链接检查
│   ├── i18n/                    # 多语言 (en、zh、zh-Hant、ja)
│   ├── ai/                      # AI 接入层与流式建议解析
│   └── shared/                  # 通用工具与类型
├── docs/                        # 设计文档与发版指南
└── scripts/                     # 发版脚本 (release:*) 与质量门禁脚本
```

多数包和应用目录下有自己的 `README.md`。

---

## 技术栈

| 领域 | 技术 | 用途 |
| :--- | :--- | :--- |
| **桌面运行时** | [Tauri 2](https://v2.tauri.app/) + [Rust](https://www.rust-lang.org/) | 桌面外壳 |
| **前端架构** | [React 19](https://react.dev/) + [TypeScript](https://www.typescriptlang.org/) | 界面与类型检查 |
| **编辑器内核** | [CodeMirror 6](https://codemirror.net/) | 在同一个 `EditorView` 上做所见即所得与源码编辑 |
| **无头编译器** | `@md-editor/compiler` | 不依赖 DOM 的 Markdown 转 HTML，用于 QuickLook 和导出 |
| **边缘分发** | [Cloudflare Workers](https://workers.cloudflare.com/) + [Cloudflare R2](https://www.cloudflare.com/developer-platform/r2/) | 带多级兜底的下载网关 |
| **样式** | [Tailwind CSS](https://tailwindcss.com/) + [Heroicons](https://heroicons.com/) | 样式与图标 |
| **工程构建** | [Vite 6](https://vitejs.dev/) + [pnpm Workspace](https://pnpm.io/) | 开发服务器与工作区依赖 |
| **代码质量** | [Vitest](https://vitest.dev/) + [Oxlint](https://oxc.rs/) + [Prettier](https://prettier.io/) | 测试、静态检查、格式化 |

---

## 文档导航

设计文档和指南在 [`docs/`](docs/)：

- [文档索引](docs/agent/index.md)：架构、状态、规范与路线
- [能力边界设计原则](docs/agent/architecture/capability_boundary_design_principles.md)：模块职责划分与解耦
- [草稿恢复、历史、Lint 与导出](docs/agent/architecture/vmark_remaining_features_technical_plan.md)
- [发布流程](docs/agent/release/release_workflow.md)：CI、GitHub Releases 与分发
- [项目背景](docs/human/project.md)

---

## 贡献规范

代码结构、分支命名和提交规范见 [AGENTS.md](AGENTS.md)，目录与命名规则见[仓库结构与命名规范](docs/agent/architecture/repo_structure_and_naming_conventions.md)。

---

## License

Inkpoint 以 [GNU General Public License v3.0 or later](LICENSE) 发布，版权声明见 [NOTICE](NOTICE)。

---

<p align="center">
  Copyright © 2026 Inkpoint. All rights reserved.
</p>
