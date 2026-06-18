# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## 项目概述

一个基于 Tauri 的跨平台 Markdown/MDX 桌面编辑器，提供 Typora-like 的所见即所得编辑体验。

核心特性:
- 基于 Milkdown 的 WYSIWYG 编辑器
- 支持 Markdown 和 MDX 组件
- 源码模式和预览模式切换
- Frontmatter 保真处理
- 文件树和大纲面板
- 图片粘贴到 assets 目录

技术栈: React 19 + TypeScript + Tauri 2 + Milkdown + pnpm monorepo

## 常用命令

### 开发
```bash
# 启动开发服务器 (Vite + Tauri)
pnpm dev

# 类型检查 (所有包)
pnpm typecheck

# 运行测试 (所有包)
pnpm test

# Lint 检查
pnpm lint

# 构建所有包
pnpm build
```

### Tauri 相关
```bash
# Tauri CLI 命令
pnpm tauri [command]

# macOS 构建 (生成 .dmg)
pnpm build:macos

# 版本发布
pnpm release:version
```

### 单包开发
```bash
# 在特定包中运行命令
pnpm --filter @md-editor/editor-core test
pnpm --filter @md-editor/desktop dev
```

### 冒烟测试
```bash
# editor-core 快速验证
pnpm smoke:editor-core
```

## 架构和代码结构

### Monorepo 结构
```
apps/
  desktop/              # Tauri 桌面应用
    src/                # React 前端代码
    src-tauri/          # Rust 后端代码
    
packages/
  editor-core/          # 编辑器核心逻辑和状态管理
  editor-ui/            # React UI 组件 (MilkdownEditor, SourceEditor, OutlinePanel 等)
  file-system/          # 文件服务抽象层
  markdown-fidelity/    # Markdown 保真处理 (frontmatter, MDX blocks, 图片路径等)
  mdx-registry/         # MDX 组件注册表
  shared/               # 共享类型和工具函数
```

### 关键架构边界

**editor-core**: 编辑器运行时核心
- `DocumentState`: 文档状态管理 (markdown, savedMarkdown, filePath, mode, isDirty)
- `EditorRuntime`: 编辑器运行时 (commands, keymaps, features, mdxComponents)
- `CommandRegistry` / `KeymapRegistry` / `FeatureRegistry`: 命令和功能注册系统
- 模式切换: `switchEditorModeSafely()` 处理 wysiwyg ↔ source 切换

**markdown-fidelity**: Markdown 内容保真
- Frontmatter 解析和重组 (作为 raw block 保留，不重排)
- 图片路径解析和重写 (支持 Tauri `convertFileSrc`)
- MDX 块识别和预览转换 (用 fenced code block 包装)
- 大纲提取 (`extractHeadingOutline`)

**file-system**: 文件系统抽象
- `FileServiceAdapter`: 平台适配接口
- `createFileService()`: 跨平台文件服务
- 图片粘贴: `planImagePasteTarget()` 计算 assets 路径

**Tauri 后端** (apps/desktop/src-tauri/src/lib.rs):
- Rust 作为薄层桌面能力: 菜单、对话框、文件访问
- Markdown 编辑语义在 TypeScript 中实现
- 通过 `#[tauri::command]` 暴露文件操作给前端

### 数据流

文档生命周期:
1. 用户操作 → `EditorRuntime.commands.dispatch()`
2. Command handler 调用 `DocumentState.updateMarkdown()` / `markSaved()`
3. `DocumentState` 更新 snapshot
4. React 组件订阅 snapshot 变化重新渲染

模式切换:
1. 用户触发 `toggleSourceMode` 或 `showWysiwygMode`
2. `switchEditorModeSafely()` 调用 `adapter.beforeSwitch` 序列化当前模式内容
3. 切换 mode 标记
4. 调用 `adapter.afterSwitch` 初始化新模式

图片粘贴:
1. 前端监听 paste 事件
2. 调用 `planImagePasteTarget()` 计算路径
3. Tauri `save_pasted_image` command 写文件
4. 追加 `![](assets/filename.ext)` 到 markdown

### MDX 组件处理

v0.1 策略: MDX 组件作为 raw block 保留，不执行
- `isLikelyMdxBlock()` 识别大写 JSX 标签
- `rewriteRawBlocksForPreview()` 将 `<Component>` 包装为 fenced code block
- `restoreRawBlocksFromPreview()` 编辑后还原原始格式
- `MDXComponentRegistry` 预留未来运行时接口

### 测试策略

每个包都有独立测试:
- `packages/*/tests/*.test.ts` 或 `packages/*/src/*.test.ts`
- 使用 Vitest
- 运行单包测试: `pnpm --filter <package-name> test`
- 运行所有测试: `pnpm test`

### 约定和注意事项

**Markdown 保真原则**:
- Frontmatter 作为 raw string 保留，不解析 YAML 对象
- 行尾和文件末尾换行统一为 LF
- MDX 块在编辑时用 fenced code block 包装，保存时还原
- 图片路径在预览时重写 (Tauri `convertFileSrc`), 保存时还原

**命令系统**:
- 内置命令 ID: `file.new`, `file.open`, `file.save`, `view.toggleSource` 等
- 快捷键通过 `KeymapRegistry` 绑定
- 命令冲突在注册时就抛错 (避免静默覆盖)

**文件路径处理**:
- 统一使用 `/` 分隔符 (内部规范化)
- Windows 路径在必要时转换
- 相对图片路径相对于文档所在目录

**状态管理**:
- 单一 Markdown 字符串作为跨模式事实源
- 不在 WYSIWYG 和 Source 模式中各自持有副本
- dirty 状态通过 `markdown !== savedMarkdown` 计算

## 详细文档

项目完整文档位于 `docs/` 目录:
- `docs/human/` - 面向人类的项目背景和发布流程
- `docs/agent/` - 面向 AI Agent 的技术方案和实现细节
- `docs/index.md` - 文档导航入口

关键文档:
- [技术方案](docs/agent/markdown_editor_technical_plan.md) - 架构设计和技术选型
- [发布流程](docs/agent/release_workflow.md) - 版本发布和自动化
- [项目背景](docs/human/project.md) - 为什么做这个项目
