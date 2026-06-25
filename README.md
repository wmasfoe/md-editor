# Markdown Editor

一个基于 Tauri 的跨平台 Markdown/MDX 桌面编辑器，提供 Typora-like 的所见即所得编辑体验。

## 特性

- 🎨 **WYSIWYG 编辑** - 基于 Milkdown 的所见即所得编辑体验
- 📝 **Markdown & MDX** - 支持标准 Markdown 和 MDX 自定义组件
- 🔄 **源码模式** - 随时切换到源码编辑模式
- 📁 **文件管理** - 内置文件树和大纲导航
- 🖼️ **图片支持** - 粘贴图片自动保存到 assets 目录
- 📋 **Frontmatter** - 完整保留 YAML frontmatter

## 安装

推荐使用 [Homebrew](https://brew.sh/) 包管理器。

```
brew install --cask wmasfoe/tap/md-editor
```

> 等 macos 功能稳定之后会提供 Windows 以及 Linux 版本。

## 快速开始

### 前置要求

- Node.js 18+
- pnpm 8+
- Rust (用于 Tauri)

### 开发

```bash
# 安装依赖
pnpm install

# 启动开发服务器
pnpm dev

# 运行测试
pnpm test

# 类型检查
pnpm typecheck
```

### 构建

```bash
# macOS 构建 (生成 .dmg)
pnpm build:macos
```

## 项目结构

```
apps/
  desktop/              # Tauri 桌面应用
packages/
  editor-core/          # 编辑器核心逻辑
  editor-ui/            # React UI 组件
  file-system/          # 文件系统抽象
  markdown-fidelity/    # Markdown 保真处理
  mdx-component-registry/ # MDX 组件协议和注册表
  mdx-plugins/          # 官方 MDX React 组件和 metadata
  shared/               # 共享工具
```

## 技术栈

- **前端**: React 19 + TypeScript + Vite
- **桌面**: Tauri 2
- **编辑器**: Milkdown + ProseMirror + CodeMirror 6
- **样式**: Tailwind CSS
- **包管理**: pnpm workspace

## 文档

完整文档请查看 [`docs/`](docs/) 目录:

- [技术方案](docs/agent/markdown_editor_technical_plan.md) - 架构设计和实现细节
- [发布流程](docs/agent/release_workflow.md) - 版本发布说明
- [项目背景](docs/human/project.md) - 项目起源和目标

## 开发指南

详细的开发指南请查看 [CLAUDE.md](CLAUDE.md)，包含:
- 常用命令
- 架构说明
- 代码约定
- 测试策略

## License

MIT
