# AI Markdown 编辑器需求沟通记录

## 1. 项目背景

用户希望开发一个面向技术写作者、程序员、博客作者的 Markdown 编辑器。产品整体方向类似 Typora，强调单视图、所见即所得的 Markdown 编辑体验，但相比 Typora 需要具备两个核心增强能力：

1. 支持 MDX 自定义组件。
2. 后续支持 AI 写作辅助能力，例如语法检查、语气检查、智能纠错、AI 续写等。

项目优先适配平台为：

1. macOS
2. Web
3. Windows

桌面端优先，后续再考虑 Web 和 Windows。

---

## 2. 编辑器内核选型讨论

### 2.1 初始候选方案

讨论过的开源编辑器方案包括：

- MDXEditor
- Milkdown
- Crepe
- Tiptap
- Lexical
- CodeMirror 6

### 2.2 MDXEditor 的判断

MDXEditor 天然适合 MDX 场景，支持 JSX 组件编辑和 Markdown / MDX 文档编辑。但是它的所见即所得体验更接近 Google Docs / Notion 式富文本编辑，而不是 Typora / Milkdown 那种 Markdown 语法实时渲染体验。

结论：

- MDXEditor 适合做 MDX 文档编辑器。
- 但如果目标是 Typora-like / Milkdown-like 的 Markdown 实时渲染编辑体验，MDXEditor 不是最优选择。
- 将 MDXEditor 改造成 Milkdown-like 成本较高，可能接近重写编辑器体验。

### 2.3 Milkdown 的判断

Milkdown 的定位更接近 Typora-like Markdown WYSIWYG 编辑器，底层基于 ProseMirror 和 remark，插件化能力强，适合做 Markdown 编辑器内核。

结论：

- 如果核心诉求是类似 Typora 的单视图 Markdown 实时渲染体验，应优先选择 Milkdown。
- MDX 自定义组件可以通过扩展 Milkdown schema、parser、serializer、node view 等方式逐步支持。
- 使用 Milkdown 兼容有限 MDX 组件的成本可控，优于把 MDXEditor 改造成 Milkdown-like。

---

## 3. Crepe 与 Milkdown Core 的讨论

### 3.1 Crepe 是什么

Crepe 是基于 Milkdown 封装的一套开箱即用编辑器产品层，包含很多常用功能和 UI 封装，例如：

- Toolbar
- Slash menu
- Link tooltip
- Image block
- CodeMirror 代码块
- Table
- Placeholder
- Block edit
- Latex 等

### 3.2 直接使用 Milkdown Core 的区别

Milkdown Core 更底层、更 headless，提供核心编辑器能力、插件系统、schema、parser、serializer 和 ProseMirror 集成，但 UI 和功能组合需要自行实现。

对比：

| 方案 | 优点 | 缺点 |
|---|---|---|
| Crepe | 开箱即用、启动快、内置常用功能 | 深度定制可能受限制 |
| Milkdown Core | 完全可控、适合长期产品化、自定义插件体系更灵活 | 初期开发成本更高 |

### 3.3 最终决策

用户明确决定：

> 直接使用 Milkdown Core，不使用 Crepe，但实现时可以参考 Crepe 的写法。

原因：

- 项目需要长期可控。
- 需要自定义 MDX 组件体系。
- 需要后续扩展 AI、导出、图片存储、插件系统。
- 不希望被 Crepe 的产品层封装限制。

---

## 4. 基础编辑功能范围

用户明确希望先完成基础编辑功能，AI 能力作为锦上添花，后续再做。

基础功能包括：

1. Markdown WYSIWYG 编辑
2. 文件打开 / 保存
3. 大纲目录
4. 代码块高亮
5. 图片粘贴和本地保存
6. 源码模式
7. 导出 PDF / HTML
8. Frontmatter
9. MDX 自定义组件支持

这些功能构成第一阶段的核心产品价值。

---

## 5. 图片资源管理讨论

用户明确：

> 图片默认复制到 assets 目录，后期需要支持自定义目录，并且需要支持上传自定义云端。我们给 interface，让用户实现自定义服务。

最终设计方向：

### 5.1 默认图片策略

当用户粘贴或拖拽图片时：

- 默认复制到当前 Markdown 文件同级的 `assets` 目录。
- Markdown 中插入相对路径。
- 例如：

```md
![image](./assets/image-20260606-153000.png)
```

### 5.2 后续扩展能力

后续需要支持：

- 自定义资源目录
- 自定义文件命名规则
- 上传到自定义云端
- 用户通过 interface 实现自己的图片存储服务

建议抽象：

```ts
interface ImageStorageProvider {
  save(file: File, context: ImageSaveContext): Promise<ImageSaveResult>
}
```

---

## 6. 导出模块讨论

用户明确：

> 导出功能作为一个独立的模块，后期不只有导出 PDF、HTML。

最终方向：

- 导出功能不耦合编辑器核心。
- 独立为 Export Module。
- 初期支持 HTML / PDF。
- 后续支持更多格式，例如 DOCX、EPUB、图片、静态站点片段、自定义格式等。

建议抽象：

```ts
interface Exporter {
  format: string
  export(input: ExportInput, options?: ExportOptions): Promise<ExportResult>
}
```

---

## 7. 源码模式讨论

用户明确：

> 源码模式直接全局切换，但要注意文章过长时的编辑器性能问题。

最终方向：

- 不做双视图。
- 源码模式通过全局切换进入。
- WYSIWYG 模式和 Source Mode 是两种编辑模式。
- 源码模式建议使用 CodeMirror 6。
- 需要关注长文档性能，包括 Markdown 序列化、编辑器重建、滚动位置恢复、光标位置映射等问题。

---

## 8. MDX 自定义组件讨论

用户提出：

> MDX 自定义组件现阶段可以先官方内置一些组件，后续可以通过插件的形式允许第三方贡献者开发自己的 MDX 组件并接入到编辑器中。

最终方向：

### 8.1 第一阶段

官方内置一批常用 MDX 组件，例如：

- Callout / Alert
- LinkCard
- Video
- FileTree
- Steps

### 8.2 后续阶段

提供插件注册机制，让第三方贡献者可以注册自己的 MDX 组件。

组件插件需要描述：

- 组件名称
- block / inline 类型
- props schema
- children 类型
- 编辑器内展示组件
- 导出 / 预览组件
- 序列化逻辑

### 8.3 重要边界

不建议第一阶段支持完整 MDX runtime，例如：

- 任意 import/export 执行
- 任意 JS expression props
- 动态数据组件
- 复杂嵌套 JSX

未知组件应保真显示为 raw block，避免丢失源码。

---

## 9. AI 功能讨论

AI 功能被定义为后续增强能力，不作为基础编辑器 MVP 的首要目标。

讨论过的 AI 能力包括：

### 9.1 静默检查

用户停止输入一段时间后，后台静默检查当前文本，发现语法、语气、错别字等问题后，以类似 Cursor 的方式提示：

- 不弹窗
- 不打断输入
- 高置信度时显示轻量提示
- 用户按 Tab 一键修复

### 9.2 显式续写

AI 续写需要用户显式调用，避免干扰输入。

可能交互：

- 快捷键唤起 AI 入口
- 生成 ghost text
- Tab 接受
- Esc 取消
- 支持重新生成

### 9.3 用户风格学习

后续可以结合用户历史文章，学习用户的：

- 写作习惯
- 语气
- 常用表达
- 格式偏好
- 技术写作风格

AI 根据这些信息提供更贴合用户风格的纠错、润色和续写。

---

## 10. 当前阶段共识

最终形成的阶段性共识：

1. 项目定位为面向技术写作者、程序员、博客作者的开源 Markdown / MDX 编辑器。
2. 基础体验对标 Typora。
3. 单视图 WYSIWYG 是核心，不考虑双视图模式。
4. 编辑器内核使用 Milkdown Core。
5. 不使用 Crepe，但参考 Crepe 的功能拆分和实现方式。
6. 第一阶段优先实现基础编辑功能。
7. MDX 自定义组件作为基础差异化能力纳入规划。
8. AI 功能作为后续增强，不影响基础编辑器主线。
9. 图片、导出、MDX 组件都需要模块化和可扩展。
10. 后续要重点讨论 Milkdown Core 的插件架构设计和 Crepe 可参考的实现方式。
