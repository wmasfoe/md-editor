# AI Markdown 编辑器需求文档

## 1. 产品概述

本项目是一个面向技术写作者、程序员、博客作者的开源 Markdown / MDX 编辑器。

产品基础体验对标 Typora，提供单视图、所见即所得的 Markdown 编辑能力。同时支持 MDX 自定义组件，并在后续加入 AI 写作辅助能力，例如语法检查、语气检查、智能纠错、AI 续写和基于用户历史文章的风格学习。

## 2. 产品定位

### 2.1 一句话定位

一个面向技术写作者的开源 Typora 替代品，支持 MDX 自定义组件，并逐步加入 Cursor-like AI 写作辅助能力。

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
| MDXEditor | MDX 支持较好 | 不够 Typora / Milkdown-like |
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
Milkdown Core
```

不使用 Crepe，但参考 Crepe 的功能拆分和实现方式。

### 4.2 选择 Milkdown Core 的原因

- 更接近 Typora-like Markdown WYSIWYG 编辑体验。
- 基于 ProseMirror 和 remark，适合扩展 Markdown / MDX 语法。
- 插件化能力强。
- 方便自研 MDX 组件系统。
- 方便后续加入 AI suggestion 插件。
- 长期产品化可控性更高。

---

## 5. 核心功能需求

### 5.1 Markdown WYSIWYG 编辑

优先级：P0

需求：

- 支持常见 Markdown 语法实时渲染。
- 支持标题、段落、列表、引用、粗体、斜体、链接、图片、分割线等基础语法。
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

优先级：P1

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
- 源码模式使用 CodeMirror 6。
- 切换时保留文档内容。
- 尽量恢复切换前的滚动位置和光标位置。
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
- 在 WYSIWYG 模式下显示为 metadata block。
- 在源码模式下显示原始 YAML。
- 第一阶段可以先支持 raw YAML 编辑。
- 后续可支持表单化编辑。

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

### 5.9 MDX 自定义组件

优先级：P0

需求：

- 支持 MDX 自定义组件的接入接口和源码保真。
- v0.1 先保证未知 MDX / JSX 不丢源码，并预留组件注册接口。
- 支持在文档中插入和编辑内部 / 官方 MDX 组件。
- 第一阶段先支持官方内置组件的最小可用接入，并以 `Callout` 作为 M0 / v0.1 技术尖刺验证对象。
- v0.2 再将官方 `Callout` 组件产品化：卡片化展示 + 源码编辑。
- 后续允许第三方通过插件接入自定义 MDX 组件。
- 未知组件必须保真，不应丢失源码。

后续推荐内置组件：

- Callout / Alert
- LinkCard
- Video
- FileTree
- Steps

建议接口：

```ts
interface MDXComponentDescriptor {
  name: string
  kind: 'flow' | 'text'
  props: MDXPropSchema[]
  children?: MDXChildrenSchema
  Editor: ComponentType<MDXComponentEditorProps>
  Preview?: ComponentType<any>
}
```

暂不支持：

- 任意 import/export 执行
- 任意 JS expression props
- 复杂动态数据组件
- 完整 MDX runtime
- 复杂嵌套 JSX 的结构化编辑
- v0.1 / v0.2 不做 `Callout` props 的结构化表单编辑

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

- Milkdown Core 接入
- Markdown WYSIWYG 编辑
- 文件打开 / 保存
- 源码模式
- dirty 状态和关闭提示
- Frontmatter raw 保真
- 大纲目录
- 图片粘贴保存到 assets
- Markdown round-trip 保真测试
- 插件化 feature 接口
- MDX 接入接口和 raw 保真
- 内部 / 官方 MDX 组件最小接入验证
- 未知 MDX raw block fallback
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
- 组件卡片编辑
- 第三方组件注册接口

### v0.5：AI 写作辅助与第三方插件

- 显式 AI 续写
- 静默语法检查
- Tab 一键修复
- 用户风格画像
- 历史文章检索增强
- 第三方插件运行时
- 本地插件目录 / 插件市场
