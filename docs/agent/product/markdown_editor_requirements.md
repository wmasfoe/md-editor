# AI Markdown 编辑器需求文档

> 当前技术目标以 [`custom_markdown_renderer_architecture.md`](../architecture/custom_markdown_renderer_architecture.md) 为准。仓库现状仍是 Milkdown / CodeMirror 双表面，CM6 单编辑器迁移尚未开始；迁移中的 beta 能力和缺口以 [`codemirror_renderer_migration_status.md`](../status/codemirror_renderer_migration_status.md) 为准。

## 1. 产品概述

本项目是一个面向技术写作者、程序员、博客作者的开源 Markdown / MDX 编辑器。

产品基础体验对标 Typora，提供单视图、所见即所得的 Markdown 编辑能力。同时支持官方内置 MDX 组件，并逐步加入 AI 写作辅助能力，例如语法检查、语气检查、智能纠错、AI 续写和基于用户历史文章的风格学习。

## 2. 产品定位

### 2.1 一句话定位

一个面向技术写作者的开源 Typora 替代品，支持官方内置 MDX 组件，并逐步加入 Cursor-like AI 写作辅助能力。

### 2.2 目标用户

第一阶段主要面向：

- 技术写作者
- 程序员
- 博客作者
- 开源项目文档维护者
- 使用 Markdown / MDX 写作的内容创作者

### 2.3 产品差异

| 产品 | 特点 | 不足 |
|---|---|---|
| Typora | Markdown WYSIWYG 体验优秀 | 不支持 MDX 自定义组件，AI 能力弱 |
| Obsidian | 知识库能力强，插件丰富 | 写作编辑体验和 Typora 不同 |
| MDXEditor | MDX 支持较好 | 不够 Typora-like |
| 本项目 | Typora-like 编辑体验 + MDX 组件 + AI 写作辅助 | 初期需要自研较多基础能力 |

---

## 3. 平台优先级

平台适配优先级：

1. macOS
2. Web
3. Windows

第一阶段优先实现 macOS 桌面端，后续复用核心编辑器能力适配 Web 和 Windows。

---

## 4. 技术选型

### 4.1 编辑器内核

使用：

```txt
CodeMirror 6
```

Markdown 源文本是编辑状态和保存事实源；WYSIWYG 与源码模式复用同一个 CM6 `EditorView`、撤销历史、选区和滚动状态。

### 4.2 选择 CodeMirror 6 的原因

- Markdown 定界符保持为真实文本，不依赖树模型序列化重建。
- Lezer 语法树用于结构识别和增量更新，不替代 Markdown 文本事实源。
- 两种模式只切换 decoration 和交互策略，不维护两个编辑器实例。
- 标题、链接、图片、HTML 和其他源码显隐能够映射到同一选区与 history。
- AI suggestion、IME、表格和 Widget 交互可以集中在同一编辑器状态模型中。

迁移不维护 Milkdown / CM6 双运行时或用户可见切换开关。需要回退时使用 Git 分支或历史版本；功能未齐全阶段可以发布如实标注缺口的 beta。

---

## 5. 核心功能需求

### 5.1 Markdown WYSIWYG 编辑

优先级：P0

需求：

- 支持常见 Markdown 语法实时渲染。
- WYSIWYG 默认可视化渲染解析器识别的标准 CommonMark / GFM 语法。
- 支持标题、段落、列表、引用、任务项、粗体、斜体、删除线、行内代码、链接、图片、分割线、代码块和 GFM 表格。
- 没有专用 WYSIWYG 编辑契约的语法仍自动渲染，但必须切换到全局源码模式修改。
- 可视化表格只支持标准 GFM 管道表格；其他表格方言保留源码，不做有损转换。
- 支持单视图编辑，不采用左右双栏预览模式。
- 编辑体验应尽量保持简洁、低干扰。

### 5.2 文件打开 / 保存

优先级：P0

需求：

- 打开 `.md` 文件。
- 后续支持打开 `.mdx` 文件。
- 保存当前文件。
- 另存为新文件。
- 展示未保存状态。
- 关闭窗口或切换文件时提示未保存变更。
- 最近打开文件列表后续支持。

### 5.3 大纲目录

优先级：P0

需求：

- 自动识别 `h1` 到 `h6`。
- 生成层级目录。
- 点击目录项跳转到对应位置。
- 当前所在标题高亮、滚动同步和性能优化后续增强。
- v0.1 只要求文档变更后能更新目录。

### 5.4 代码块高亮

优先级：P0

需求：

- v0.1 只要求 fenced code block 的源码保真，包括语言标识、meta、缩进和内容。
- 后续支持语法高亮。
- 后续支持代码块内 Tab 缩进。
- 后续支持复制代码按钮。
- 后续可支持语言选择器、行号、代码折叠等能力。

### 5.5 图片粘贴和本地保存

优先级：P0

需求：

- 粘贴图片时自动保存图片并插入 Markdown 图片语法。
- 图片默认复制到当前文档同级的 `assets` 目录。
- Markdown 中插入相对路径。
- 后续支持拖拽图片、自定义目录和自定义云端上传。

默认示例：

```md
![image](./assets/image-20260606-153000.png)
```

建议接口：

```ts
interface ImageStorageProvider {
  save(file: File, context: ImageSaveContext): Promise<ImageSaveResult>
}

interface ImageSaveContext {
  documentPath?: string
  defaultAssetsDir: string
}

interface ImageSaveResult {
  src: string
  storageType: 'local' | 'remote'
}
```

### 5.6 源码模式

优先级：P1

需求：

- WYSIWYG 模式和源码模式全局切换。
- 不采用双视图模式。
- 两种模式使用同一个 CodeMirror 6 实例。
- 切换时保持同一文档、撤销历史、选区和滚动位置。
- 注意长文档性能问题。

### 5.7 导出功能

优先级：P1

需求：

- 导出 HTML。
- 导出 PDF。
- 导出时处理图片路径。
- 导出时应用主题样式。
- 导出模块与编辑器核心解耦。
- 后续扩展 DOCX、EPUB、PNG、静态站点 HTML、自定义格式等。

建议接口：

```ts
interface Exporter {
  name: string
  format: string
  export(input: ExportInput, options?: ExportOptions): Promise<ExportResult>
}
```

### 5.8 Frontmatter

优先级：P0

需求：

- 识别文档顶部 Frontmatter。
- 在 WYSIWYG 模式下显示带标题的可编辑 YAML 元数据面板，隐藏外层 `---` 分隔符并提供 YAML 高亮。
- 在源码模式下显示完整原始 YAML 和分隔符。
- 面板直接编辑 YAML，不转换成 title、date、tags 等表单字段。
- 未编辑时保持注释、字段顺序、引号和日期格式；解析错误时仍保留可编辑原文。

示例：

```md
---
title: Hello
date: 2026-06-06
tags:
  - markdown
  - editor
---

# Hello
```

### 5.9 MDX 官方组件

优先级：P0

需求：

- 仅支持应用内置并注册的官方 MDX 组件，同时保证未知 MDX / JSX 源码不丢失。
- 支持通过现有 registry 和插入面板插入官方 MDX 组件。
- 第一阶段先支持官方内置组件的最小可用接入，并以 `Callout` 作为 M0 / v0.1 技术尖刺验证对象。
- WYSIWYG 中真实渲染官方组件；点击任意位置都选中整个组件并显示描边。
- 组件内部链接、按钮、输入框和其他交互统一拦截，不执行组件自身行为。
- `Backspace` / `Delete` 删除整个 MDX 源码范围；修改 props 或 children 时切换到全局源码模式。
- 未注册组件、语法错误和渲染错误显示安全占位块，并保留原始源码。

后续推荐内置组件：

- Callout / Alert
- LinkCard
- Video
- FileTree
- Steps

暂不支持：

- 任意 import/export 执行
- 任意 JS expression props
- 复杂动态数据组件
- 完整 MDX runtime
- 复杂嵌套 JSX 的结构化编辑
- `Callout` props 的结构化表单编辑
- 用户导入或第三方 MDX 组件

---

## 6. AI 增强功能

AI 功能作为后续增强能力，不阻塞基础编辑功能。

### 6.1 静默检查

用户停止输入一段时间后，后台检查当前段落，发现问题后以 Cursor-like 形式提示，用户可按 Tab 一键修复。

能力包括：

- 错别字检查
- 语法检查
- 语气检查
- 表达自然度检查
- 用户风格一致性检查

### 6.2 显式续写

用户通过快捷键显式调用 AI 续写。

交互建议：

- Ghost text 展示结果。
- Tab 接受。
- Esc 取消。
- 支持重新生成。

### 6.3 用户风格学习

后续支持基于用户历史文章建立写作风格画像，并用于纠错、润色和续写。

---

## 7. 版本规划

### v0.1：可日常写作的 Markdown 最小产品

- CodeMirror 6 单编辑器接入
- Markdown WYSIWYG 编辑
- 文件打开 / 保存
- 源码模式
- dirty 状态和关闭提示
- Frontmatter raw 保真
- 大纲目录
- 图片粘贴保存到 assets
- Markdown round-trip 保真测试
- 内置 feature 接口
- MDX 官方组件 registry 和 raw 保真
- 内部 / 官方 MDX 组件最小接入验证
- 未知 MDX raw block 安全降级
- 基础主题和快捷键

### v0.2：技术写作基础能力

- 代码块高亮
- 最近文件
- 基础错误提示
- 图片拖拽与图片处理增强
- 大纲当前标题高亮与滚动同步
- 一个官方 MDX 组件最小切片

### v0.3：导出模块

- HTML 导出
- PDF 导出
- 图片路径处理
- 主题样式导出

### v0.4：MDX 组件增强

- `.mdx` 文件支持
- 更多官方内置组件
- MDX component registry
- 官方组件真实渲染、原子选择和错误占位

### v0.5：AI 写作辅助

- 显式 AI 续写
- 静默语法检查
- Tab 一键修复
- 用户风格画像
- 历史文章检索增强

版本号表示目标能力分组，不代表当前实现状态。CM6 迁移期间可以发布部分功能 beta，但必须在状态文档中逐项记录已实现能力、缺口、降级和验证证据；只有全部迁移门槛通过后才能标记稳定完成。
