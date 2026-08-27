# AI Markdown 编辑器技术方案

> 适用性说明：本文中的文件系统、文档状态、图片、大纲、导出、AI 边界和测试原则继续有效。Milkdown/ProseMirror 内核、独立 SourceEditor 切换、parser/serializer 往返、MDX 卡片源码编辑和第三方插件路线已经改为 CM6 单编辑器方案，相关章节按下文的新说明执行，最终以 [`custom_markdown_renderer_architecture.md`](./custom_markdown_renderer_architecture.md) 为准。

## 1. 技术目标

本技术方案用于指导开发一个面向技术写作者、程序员、博客作者的开源 Markdown / MDX 编辑器。

核心目标：

1. 使用 CodeMirror 6 实现基于 Markdown 源文本的 Typora-like WYSIWYG 编辑体验。
2. WYSIWYG 和源码模式复用同一个 `EditorView`、history、selection 和 scroll 状态。
3. 优先验证 `CM6 + Markdown 编辑 + 文件保存 + Frontmatter / MDX 保真 + 官方 MDX 组件` 主链路。
4. 支持本地文件打开 / 保存，并明确未保存文档、dirty 状态、关闭提示等文件生命周期。
5. 支持源码模式全局切换，模式切换不得重建编辑器实例或丢失交互状态。
6. 支持 Frontmatter raw metadata block，避免第一阶段对象化重写导致内容丢失。
7. 复用现有 MDX registry/plugins 包并保证未知 MDX raw block 保真；官方 Callout 组件作为真实渲染和原子选择的最小切片。
8. 支持图片复制到 assets 目录，并预留自定义存储接口。
9. 支持独立导出模块，但导出模块边界作为 P1，在核心编辑链路稳定后再进入；首期目标为 HTML / PDF。
10. 后续支持内置 AI 写作辅助能力。

优先级原则：

- 先验证核心技术风险，再扩展产品能力。
- MDX 是产品差异化能力，内部 / 官方组件最小接入进入 P0，但第一阶段不追求完整 MDX runtime。
- 源码模式是 CM6 单编辑器主链路的一部分；导出模块仍为后置能力。
- AI 是增强能力，不进入基础编辑器 MVP。
- 导出质量依赖 Markdown / MDX 解析、主题、图片路径和组件安全降级策略，因此在核心编辑链路稳定后再做。

---

## 2. 总体架构

建议采用 monorepo 结构：

```txt
apps/
  desktop/                 # Tauri 桌面端，优先 macOS
  web/                     # 后续 Web 端

packages/
  editor-core/             # 引擎无关文档与命令契约
  renderer-codemirror/     # CM6 编辑器实现与 Markdown 交互语义
  editor-ui/               # React UI 组件
  feature-outline/         # 大纲目录
  feature-source-mode/     # 源码模式
  feature-image/           # 图片粘贴、后续拖拽、资源存储
  feature-frontmatter/     # Frontmatter 支持
  feature-code-block/      # 代码块高亮
  feature-mdx/             # MDX 组件系统
  file-system/             # 文件打开、保存、路径处理
  shared/                  # 公共类型、工具函数
```

初期落地时可以先收敛包数量，避免在核心风险未验证前过早拆分：

```txt
packages/
  editor-core/             # 编辑器 runtime、内置 feature 和文档契约
  renderer-codemirror/     # CM6 parser adapter、decoration、Widget 和交互状态
  file-system/             # 文件服务抽象和桌面端实现
  shared/                  # 公共类型、fixtures、测试工具
```

当 feature 的接口稳定后，再逐步拆出 `feature-*` 包。

架构分层：

```txt
App Layer
  ├── Desktop App / Web App
  ├── Layout / Menu / Window / Settings
  └── File lifecycle

Editor Layer
  ├── CodeMirror 6
  ├── Lezer / Markdown parser adapters
  ├── Decorations / Widgets / StateFields
  └── Editor commands

Feature Layer
  ├── Outline
  ├── Source Mode
  ├── Image Storage
  ├── Frontmatter
  ├── MDX Components
  └── File Lifecycle

Service Layer
  ├── FileService
  ├── ImageStorageProvider
  ├── SettingsService
  └── FeatureRegistry
```

---

## 3. 技术栈建议

### 3.1 桌面端

```txt
Tauri
React
TypeScript
Vite
```

### 3.2 编辑器

```txt
CodeMirror 6
Lezer Markdown
remark / unified / remark-gfm / remark-mdx
```

### 3.3 Markdown / MDX 处理

```txt
remark
remark-gfm
remark-frontmatter
remark-mdx
gray-matter / yaml
rehype
```

### 3.4 导出

```txt
HTML: unified / remark / rehype pipeline
PDF: HTML render + print / WebView / headless pipeline
```

### 3.5 数据和配置

```txt
本地配置：Tauri store / JSON config
最近文件：local app data（v0.2）
后续索引：SQLite / 本地向量库
```

---

## 4. CM6 核心边界与可迁移能力

本节接口和 raw fragment 原则用于解释当前代码及可迁移能力；Milkdown / ProseMirror 生命周期、双编辑器切换和 parser/serializer 合成不再是目标实现。迁移时保留引擎无关的 runtime、command、keymap、feature 和文档状态契约，删除 Milkdown 专用字段与插件数组。

### 4.1 不直接暴露编辑器引擎

`packages/editor-core` 只定义引擎无关的 Runtime 契约，具体 CM6 生命周期由 `renderer-codemirror` 实现：

```ts
interface EditorRuntimeContract {
  getMode(): EditorMode
  setMode(mode: EditorMode): Promise<void>

  getContent(): EditorContent
  setContent(content: EditorContent): Promise<void>

  focus(): void
  insertMarkdown(markdown: string): void
  executeCommand(command: EditorCommand): void

  onContentChange(listener: (change: EditorContentChange) => void): () => void
  onSelectionChange(listener: (selection: EditorSelection) => void): () => void
  onInteractionChange(listener: (state: EditorInteractionState) => void): () => void
}

type EditorMode = 'wysiwyg' | 'source'

interface EditorContent {
  rawMarkdown: string
}
```

这样 App 层不直接依赖编辑器引擎细节，CM6 renderer 可以替换当前实现而不把平台能力下沉到编辑器层。

Runtime 职责边界：

- `editor-core` 只拥有契约、DocumentState、commands、keymaps 和纯领域算法，不依赖 CM6、DOM 或 React。
- `renderer-codemirror` 实现 Runtime 契约，负责单一 CM6 `EditorView` 的生命周期、模式切换、extensions、parser adapters 和 Widgets。
- Runtime 对外只暴露内容、命令、选区和交互状态，不把底层 `EditorView` 作为常规业务依赖。
- renderer 从 CM6 文本读取可保存的 `rawMarkdown`；raw fragment 只提供识别、保真和验证能力，不再合成两个编辑器模型。
- App 层负责文件生命周期、窗口菜单、最近文件、设置和全局 UI，不直接拼接 Markdown。
- `editor-core` 的内置 Feature 只注册 command、keymap 和 capability metadata；parser adapter 属于 renderer，React UI 属于 `editor-ui`，任何层都不能绕过 CM6 transaction 改写文档权威源。

### 4.2 插件组织方式

内置功能按领域 descriptor 与 renderer extension 分层：

```txt
editor-core
  ├── commands / keymaps
  ├── feature descriptors
  └── pure domain contracts

renderer-codemirror
  ├── createEditorView()
  ├── CM6 extensions / parser adapters
  └── interaction StateFields / Widgets
```

迁移前的 Feature 组合曾包含 Milkdown / ProseMirror 插件；迁移后由 core descriptor 声明命令，由 renderer adapter 提供 CM6 extension：

```txt
EditorFeatureDescriptor = command + keymap + capability metadata
RendererFeature = CM6 extension + renderer-owned interaction state
```

建议统一 Feature 接口：

```ts
interface EditorFeatureDescriptor {
  readonly name: string
  readonly commands?: Readonly<Record<string, EditorCommand>>
  readonly keymaps?: Readonly<Record<string, EditorCommand>>
}

// 定义在 renderer-codemirror，不进入 editor-core。
interface RendererFeature {
  readonly name: string
  readonly extensions: readonly Extension[]
}
```

### 4.3 内容状态流转

CM6 `EditorState.doc` 是活动编辑事实源，`DocumentState.rawMarkdown` 是持久化和 React 订阅镜像。

```txt
FileService 读取文件
  ↓
DocumentState.rawMarkdown
  ↓
创建 / 重置 CM6 EditorState
  ↓
Lezer / GFM / MDX parser 派生语法范围
  ↓
用户在 WYSIWYG 或源码模式编辑同一 CM6 doc
  ↓
CM6 transaction listener 同步 DocumentState.rawMarkdown
  ↓
FileService 读取 CM6 当前文本、规范化 LF 并保存
```

关键约束：

- CM6 doc 是活动编辑事实源；WYSIWYG decoration、Widget 和 parser AST 都是派生状态。
- `rawMarkdown` 是持久化镜像和 dirty 判断依据，不能形成反向 echo loop。
- 保存不经过结构树 serializer 重建全文。
- 结构化表格、任务项、代码语言和其他 UI 操作必须生成 CM6 transaction。

### 4.4 Raw Fragment 模型

为了支持源码保真，解析阶段需要记录 raw fragment：

```ts
interface RawFragment {
  id: string
  kind:
    | 'frontmatter'
    | 'html_block'
    | 'mdx_unknown_flow'
    | 'mdx_unknown_text'
    | 'mdx_esm'
    | 'mdx_expression'
    | 'raw_block'

  source: string
  range?: {
    start: number
    end: number
  }
  dirty: boolean
}
```

保真策略：

- 用户未主动编辑 raw fragment 时，CM6 文本本身保持 `source` 原文，不经过合成 serializer。
- 用户主动编辑结构化范围时，只允许 transaction 替换该源码范围。
- 已注册官方 MDX 组件也建议保留 `rawSource` / `rawProps` / `sourceRange`，避免未编辑时重排 props、引号、空白和 children。
- 如果无法可靠映射某段语法，第一阶段应降级为 raw block，而不是丢弃或格式化。
- M0 必须验证 raw fragment 范围映射、dirty 判断和保存闭环；Milkdown 专用 `serializeWithRawFragments()` 只保留为迁移前测试基线。

### 4.5 交互状态分层

CM6 相关状态需要按职责分层，避免所有状态挤进 React 全局 store。

```ts
interface EditorInteractionState {
  focused: boolean
  composing: boolean
  selection?: EditorSelection
  activeBlock?: ActiveBlock
  activeMarks?: ActiveMarks
  slashMenu?: SlashMenuState
  linkTooltip?: LinkTooltipState
  imageToolbar?: ImageToolbarState
  mdxComponentPanel?: MDXComponentPanelState
  aiSuggestion?: AISuggestionState
}
```

状态边界：

- `DocumentState`：文件路径、内容、dirty、保存快照、解析状态。
- `EditorRuntimeState`：Runtime 是否初始化，以及由 CM6 StateField 驱动的当前模式。
- `EditorInteractionState`：选区、焦点、输入法 composing、浮层、菜单、AI ghost text。
- `FeatureState`：大纲、官方 MDX registry、图片 storage provider、导出 registry 和内置 feature 配置。

交互原则：

- CM6 transaction、StateField 和 Facet 承担编辑器内部高频状态。
- React 只订阅需要渲染外部 UI 的低频状态，例如 toolbar、outline、侧栏和浮层。
- 输入法 composing 期间避免触发破坏输入连续性的自动格式化、AI 替换和模式切换。
- selection、floating menu、slash menu、link tooltip 需要由 Runtime 统一派发状态，避免多个 feature 争抢 DOM 事件。

### 4.6 第一阶段交互边界

第一阶段必须稳定：

- 基础 Markdown 输入、删除、粘贴、撤销、重做。
- 标题、列表、引用、代码块、链接、图片的基础快捷键和命令。
- Frontmatter 以可编辑 YAML 元数据面板显示；未知 MDX 和不支持的 HTML 以安全占位块或源码保真形式呈现。
- 官方 MDX 组件可以插入、真实渲染、原子选择、整块删除、保存并再次打开；源码修改通过全局源码模式完成。
- WYSIWYG / Source Mode 在同一个 `EditorView` 中切换，并保持 history、selection 和 scroll position。
- 编辑器 focus、selection、dirty 状态和关闭提示可靠。

第一阶段可以延后：

- 完整 toolbar 体验。
- 复杂 block handle / drag handle。
- AI 静默检查和 ghost text。
- 稳定发布所需的完整大文件性能优化；beta 必须如实记录已知限制。

---

## 5. 文件系统模块

### 5.1 FileService 接口

```ts
interface FileService {
  openFile(): Promise<OpenedFile | null>
  saveFile(path: string, content: string): Promise<void>
  saveFileAs(content: string): Promise<OpenedFile | null>
  readFile(path: string): Promise<string>
  writeFile(path: string, content: string): Promise<void>
}

interface OpenedFile {
  path: string
  name: string
  content: string
  ext: '.md' | '.mdx'
}
```

### 5.2 文件状态

需要维护：

```ts
interface DocumentState {
  path?: string
  filename?: string
  ext: '.md' | '.mdx'
  rawMarkdown: string
  savedRawMarkdown: string
  dirty: boolean
  parseStatus: 'clean' | 'warning' | 'error'
}
```

字段说明：

- 活动 `EditorState.doc` 是编辑事实源；`rawMarkdown` 是当前文档的持久化和 React 订阅镜像。
- `savedRawMarkdown` 是最近一次成功保存后的 raw 内容快照。
- raw fragment、AST 和源码范围都是从 CM6 文本派生的解析状态，不形成第二份可编辑文档。
- `dirty` 由 LF 规范化后的 `rawMarkdown !== savedRawMarkdown` 得出。
- 模式由 CM6 StateField 管理，不复制到 `DocumentState` 形成双向同步。

### 5.3 注意事项

- 保存始终读取同一个 CM6 `EditorState.doc`，不区分当前显示模式。
- 保存只统一换行为 LF，不通过结构树 serializer 重建全文。
- 结构化表格、代码语言选择和其他可视化操作必须先以 CM6 transaction 更新源码，再进入保存链路。
- 关闭窗口或打开新文件前检查 dirty 状态。
- `path` 为空表示新建未保存文档，保存时必须走 `saveFileAs`。
- 未保存文档粘贴图片时，第一版提示用户先保存文档，再写入同级 `assets` 目录。
- 文件写入优先采用原子写入策略，避免保存失败时破坏原文件。
- 最近文件属于 v0.2 增强，需要处理文件已移动、删除或无权限访问的情况。

### 5.4 Tauri 文件实现

桌面端建议提供 `TauriFileService`，实现 `FileService` 接口：

- 使用 Tauri dialog 获取用户授权路径。
- 使用 Tauri fs 或自定义 command 完成读写。
- 在 Tauri v2 capabilities 中显式声明文件读写权限和允许范围。
- 保存时采用临时文件 + rename 的原子写入策略。
- 写入失败时保留原文件，并返回可展示给用户的错误信息。
- 最近文件只保存路径和基础元数据，不缓存完整文件内容。

### 5.5 文档保真原则

文档保真是第一阶段的核心验收标准，不能只依赖“能渲染出来”判断成功。

需要优先保证：

- 打开、切换模式和保存不会导致非必要的源码改写。
- Frontmatter 在未被主动编辑时保持 raw YAML。
- 未知 MDX 组件、HTML block、raw block 不丢失。
- fenced code block 的语言、meta、缩进和内容不丢失。
- 源码模式和 WYSIWYG 模式来回切换时，共享同一文档、history、selection 和 scroll position。

实现原则：

- 对 Frontmatter、未知 MDX、HTML block、raw block 记录精确源码范围，视觉层不得替换文档事实源。
- 未主动编辑的范围保持原始文本；保存不触发 serializer 重排。
- 用户主动编辑结构化表格等范围后，只允许对应 transaction 规范化该明确范围。
- 每个保真 fixture 必须标注 `byte-equal` 或 `normalized-equal` 验收级别。
- 第一阶段宁可把不确定语法显示为 raw block，也不要丢弃或重写源码。

---

## 6. 源码模式技术方案

### 6.1 基本策略

源码模式为全局切换，不做双视图。

```txt
WYSIWYG Mode: CM6 + visual decorations/widgets
Source Mode: same CM6 EditorView + source decorations
```

切换规则：

- 通过 CM6 `StateEffect` / `StateField` 切换渲染策略，不卸载或重新初始化 `EditorView`。
- 两种模式共享 CM6 doc、undo history、selection 和 scroll position。
- `DocumentState.rawMarkdown` 作为持久化和订阅镜像，由 transaction listener 单向同步。
- dirty 判断以 `rawMarkdown` 和 `savedRawMarkdown` 为准。
- 模式切换不得产生文档 transaction，也不得改变 dirty 状态。
- history、光标、选区或滚动位置不能稳定保持时，CM6 单编辑器切换不得进入 beta。

### 6.2 长文档性能风险

重点关注：

- Lezer background parse 完整性和增量范围。
- selection 变化是否触发全量 decoration 重建。
- block widget 的 mount / unmount 与布局测量。
- WYSIWYG decoration 切换和快速滚动稳定性。
- 大量 decorations 导致更新慢。

### 6.3 优化策略

- 用 `ChangeDesc` 映射未变化范围，只重建受影响 block。
- selection 只更新旧、新活动节点。
- Mark decorations 按 visible ranges 计算；跨行 block decorations 使用 CM6 支持布局变化的直接来源。
- 删除 Milkdown 前固化大文件 fixture 和性能基准，迁移后持续对比。

---

## 7. 图片资源模块

### 7.1 默认行为

图片粘贴时：

1. 获取剪贴板中的 image file。
2. 调用 ImageStorageProvider 保存。
3. 返回 Markdown 可使用的 `src`。
4. 插入 Markdown 图片语法或图片节点，其中图片地址使用上一步返回的 `src`。

拖拽图片作为后续增强能力，不进入 v0.1 必做范围。

默认保存规则：

```txt
当前文档：/notes/post.md
图片目录：/notes/assets/
插入路径：./assets/image-20260606-153000.png
```

### 7.2 ImageStorageProvider 接口

```ts
interface ImageStorageProvider {
  name: string
  save(file: File, context: ImageSaveContext): Promise<ImageSaveResult>
}

interface ImageSaveContext {
  documentPath?: string
  documentDir?: string
  defaultAssetsDir: string
  preferredFileName?: string
}

interface ImageSaveResult {
  src: string
  absolutePath?: string
  storageType: 'local' | 'remote'
}
```

### 7.3 默认本地实现

```ts
class LocalAssetsStorageProvider implements ImageStorageProvider {
  name = 'local-assets'

  async save(file: File, context: ImageSaveContext): Promise<ImageSaveResult> {
    // 1. 计算 assets 目录
    // 2. 生成文件名
    // 3. 写入文件
    // 4. 返回相对路径
  }
}
```

### 7.4 后续云端实现

用户可以自定义：

```ts
class CustomCloudStorageProvider implements ImageStorageProvider {
  name = 'custom-cloud'

  async save(file: File, context: ImageSaveContext): Promise<ImageSaveResult> {
    // 上传到 S3 / OSS / R2 / 自定义 API
    return {
      src: 'https://cdn.example.com/image.png',
      storageType: 'remote',
    }
  }
}
```

---

## 8. 大纲目录技术方案

### 8.1 生成方式

监听 CM6 transaction 的变更范围，从 Lezer Markdown 语法树读取 heading 节点。纯 outline tree 构建可以下沉为引擎无关函数，但语法树和位置映射由 renderer 提供：

```ts
interface OutlineItem {
  id: string
  level: number
  text: string
  pos: number
  children: OutlineItem[]
}
```

### 8.2 功能

- 文档变更后更新 outline。
- 点击 outline 项时 dispatch selection 到对应 pos。
- 根据当前 selection 高亮当前 heading。

### 8.3 性能

- 不要每次 transaction 都全量扫描。
- 可 debounce。
- 后续可基于 changed range 增量更新。

---

## 9. 代码块高亮技术方案

代码块是 CM6 迁移完整验收能力。WYSIWYG 中必须直接编辑 fenced code block 内容，同时保留语言标识、meta、缩进和源码范围。

### 9.1 基础方案

使用 CM6 Markdown 语法树识别 fenced code block，以同一 `EditorView` 中的 block decoration、gutter 和浮层控件实现，不嵌套第二个编辑器实例。

### 9.2 功能

- fenced code block。
- language meta。
- syntax highlight。
- 语言选择器。
- 行号。
- code block 内 Tab 缩进。
- 复制代码按钮。
- 后续可支持折叠、搜索等增强。

### 9.3 注意事项

- 代码区继续使用主 CM6 selection、history 和 IME，不创建独立撤销栈。
- 语言选择器通过 CM6 transaction 只替换 opening fence 的 info string。
- 复制按钮不得获取持久焦点或改变文档 selection；复制内容只包含代码正文。
- 行号和高亮是派生视觉状态，不写入 Markdown。

---

## 10. Frontmatter 技术方案

### 10.1 解析

文档顶部 Frontmatter 使用 remark-frontmatter 或 gray-matter 识别。

第一阶段只把解析结果用于识别、展示和错误提示，不默认把 YAML 转为对象后重新序列化。

### 10.2 编辑表现

WYSIWYG：

```txt
显示带 Frontmatter 标题的可编辑 YAML 元数据面板
隐藏外层 --- 分隔符，YAML 内容直接编辑并高亮
```

源码模式：

```txt
在同一 EditorView 中显示完整原始 YAML 和 --- 分隔符
```

### 10.3 数据原则

- Frontmatter 是文档级 metadata。
- 不应被当作普通正文段落。
- 序列化时必须保持在文档顶部。
- 未被用户主动编辑时必须保留 raw YAML 文本，包括注释、字段顺序、引号和日期格式。
- 不把 title、date、tags 等字段转换成表单；面板编辑只更新 Frontmatter 源码范围。
- 若无法解析 YAML，应显示错误状态，但不丢失原始内容。

---

## 11. 导出模块技术方案

### 11.1 模块独立

导出功能独立为 `feature-export`，不耦合具体编辑器运行时。该模块属于 P1，在 P0 编辑和保存主链路稳定后进入。

```ts
interface Exporter {
  name: string
  format: string
  export(input: ExportInput, options?: ExportOptions): Promise<ExportResult>
}

interface ExportInput {
  markdown: string
  filePath?: string
  assetsBasePath?: string
  frontmatter?: Record<string, unknown>
}

interface ExportResult {
  type: 'file' | 'blob' | 'text'
  content: string | Blob | Uint8Array
  suggestedFileName?: string
}
```

### 11.2 HTML 导出

流程：

```txt
Markdown / MDX
  → remark parse
  → remark plugins
  → rehype
  → HTML template
  → 写入 .html
```

需要处理：

- 图片相对路径。
- 代码高亮 CSS。
- 主题 CSS。
- Frontmatter metadata。
- MDX 组件安全降级或预览渲染。

### 11.3 PDF 导出

初期建议：

```txt
Markdown → HTML → WebView 打印 / 系统打印
```

MVP 交付边界：

- HTML 导出是确定交付能力。
- PDF 初版优先复用 HTML 导出结果，通过桌面端 WebView 或系统打印生成。
- PDF 初版只承诺可用，不承诺复杂分页、页眉页脚、字体嵌入和跨平台完全一致。
- 高质量 PDF 排版作为后续独立增强，不阻塞编辑器主链路。

后续可以增强：

- 页眉页脚。
- 分页控制。
- 代码块分页。
- 目录。
- 自定义主题。
- 字体嵌入。

---

## 12. MDX 组件系统技术方案

### 12.1 目标

复用现有 MDX 接入接口，保证未知 MDX / JSX raw block 保真；registry 只装配应用内置的官方组件 metadata，不作为第三方插件接口。

v0.1 只做：

- 接入 `remark-mdx`。
- 未知 MDX 组件 raw block 保真。
- 内置 Component Registry 和 descriptor 类型。
- MDX import/export、expression、未知 JSX 节点全部 raw 保真展示，不执行、不格式化。
- 一个官方 Callout 组件的 AST range、React Widget、原子选择和插入命令，用于验证最小垂直切片。

CM6 迁移中将官方 `Callout` 组件产品化：

- Callout 真实渲染 + 原子选择；props 和 children 在全局源码模式编辑。
- 更完整的组件安全降级策略。

完整 MDX runtime、第三方组件加载和 npm 插件不在当前产品路线内。

### 12.2 Component Registry

```ts
interface MDXComponentRegistry {
  register(descriptor: MDXComponentDescriptor): void
  unregister(name: string): void
  get(name: string): MDXComponentDescriptor | undefined
  list(): MDXComponentDescriptor[]
}
```

### 12.3 Component Descriptor

```ts
interface MDXComponentDescriptor {
  name: string
  kind: 'flow' | 'text'
  displayName?: string
  description?: string
  props: MDXPropSchema[]
  children?: MDXChildrenSchema
}

type MDXPropSchema =
  | { name: string; type: 'string'; required?: boolean; defaultValue?: string }
  | { name: string; type: 'number'; required?: boolean; defaultValue?: number }
  | { name: string; type: 'boolean'; required?: boolean; defaultValue?: boolean }
  | { name: string; type: 'enum'; options: string[]; required?: boolean; defaultValue?: string }

interface MDXChildrenSchema {
  allowed: boolean
  kind?: 'markdown' | 'plainText' | 'none'
}
```

### 12.4 CM6 接入点

迁移需要实现：

1. remark-mdx 解析 MDX。
2. 未知组件、语法错误和渲染异常使用 source-preserving placeholder。
3. Component Registry 只提供官方 metadata 和 descriptor。
4. `editor-ui` 通过 typed map 注入 `officialMdxComponents`，renderer 不直接依赖 `mdx-plugins`。
5. parser 生成精确 MDX AST source range，CM6 Widget 真实渲染官方组件。
6. 捕获 pointer、click、focus、input 和 keyboard 事件，统一选中整个组件。
7. `Backspace` / `Delete` 通过一个 CM6 transaction 删除完整源码范围。
8. 快捷面板插入官方组件源码模板。

MDX AST 处理边界：

- 已注册的官方组件可以生成原子 Widget 和精确源码范围。
- 未注册的 `mdxJsxFlowElement` 和 `mdxJsxTextElement` 保留为 raw 节点。
- `mdxjsEsm`、`mdxFlowExpression`、`mdxTextExpression` 只做 raw 保真。
- 第一阶段不执行 MDX 代码，也不解析 JS expression props 的运行时值。

### 12.5 官方组件建议

第一批垂直切片：

- Callout / Alert

后续第一批：

- LinkCard
- Video
- FileTree
- Steps

第二批：

- Tabs
- GitHubRepo
- NpmPackage
- DemoBlock
- APIReference

### 12.6 边界

v0.1 / v0.2 不支持：

- 执行任意 import/export。
- 任意 JS expression props 的结构化编辑。
- 任意动态组件运行。
- 完整 MDX runtime。
- 复杂嵌套 JSX 的完全可视化编辑。
- `Callout` props 的结构化表单编辑。
- 用户导入或第三方 MDX 组件。

这些语法在第一阶段仍应可打开、显示、保存，并尽量保持原始源码不变。

---

## 13. AI 写作辅助技术方案

AI 功能后置，不阻塞基础编辑器。

### 13.1 AI Suggestion Plugin

基于 `renderer-codemirror` 的 StateField、StateEffect 和 decorations 实现。AI 层只返回纯 suggestion；renderer 独立负责展示、接受、取消、失效、选区映射和 history：

```ts
type AISuggestion =
  | {
      kind: 'fix'
      from: number
      to: number
      original: string
      replacement: string
      confidence: number
      reason?: string
    }
  | {
      kind: 'completion'
      pos: number
      text: string
      confidence: number
    }
```

### 13.2 静默检查流程

```txt
用户输入
  → transaction
  → debounce
  → 获取当前段落和上下文
  → 调用 AI checker
  → 返回 patch
  → decoration 显示 ghost hint
  → Tab 接受
```

### 13.3 显式续写流程

```txt
用户按快捷键
  → 获取光标上下文
  → 调用 AI completion
  → ghost text 显示
  → Tab 接受 / Esc 取消
```

### 13.4 隐私原则

- 默认用户自带 API Key。
- 支持 OpenAI-compatible endpoint。
- 支持本地模型，例如 Ollama。
- 历史文章默认本地索引。
- 静默检查需要用户主动开启。
- 后续支持 `.aiignore`。

---

## 14. 内置 Feature 系统

### 14.1 Feature Plugin

Feature 系统只作为编译期内置能力注册机制使用，不设计第三方运行时加载。

```ts
interface AppPlugin {
  name: string
  version: string
  setup(ctx: PluginContext): void | Promise<void>
}

interface PluginContext {
  editor: EditorRuntime
  commands: CommandRegistry
  mdxComponents: MDXComponentRegistry
  imageStorage: ImageStorageRegistry
}
```

### 14.2 注册中心

需要维护：

- CommandRegistry
- MDXComponentRegistry
- ImageStorageRegistry
- KeymapRegistry

### 14.3 加载边界

只加载随应用编译和测试的内置 Feature。npm 包插件、本地插件目录、插件市场和用户代码执行均不在当前产品路线内；`MDXComponentRegistry.registerMany()` 同样只用于装配官方 metadata。

---

## 15. 迁移前历史里程碑

本节记录当前 Milkdown 代码和既有能力的形成过程，不再作为后续执行清单。CM6 M0-M6、beta 和稳定完成门槛以 [`custom_markdown_renderer_architecture.md`](./custom_markdown_renderer_architecture.md#10-迁移里程碑) 为准，实时状态以 [`codemirror_renderer_migration_status.md`](../status/codemirror_renderer_migration_status.md) 为准。

### Milestone 0：核心技术尖刺

- EditorRuntime 内容接口验证
- Milkdown parser / serializer 扩展验证
- raw fragment collector / dirty 标记 / 合成 serializer 验证
- Markdown round-trip fixture 验证
- Frontmatter raw block 保真验证
- remark-mdx 接入验证
- 未知 MDX raw node 保真验证
- 官方 Callout 的最小 AST 映射验证

### Milestone 1（v0.1）：项目骨架与可保存的 Markdown 编辑闭环

- Tauri + React + TypeScript 项目初始化
- Milkdown Core 接入
- EditorRuntime 封装
- 基础 Markdown WYSIWYG 编辑
- 文件生命周期
- 文档状态管理
- dirty 状态
- 原子保存
- selection / focus / composing 等基础交互状态派发

### Milestone 2（v0.1）：源码模式与内容一致性

- CodeMirror 6 接入
- WYSIWYG / Source Mode 全局切换
- `DocumentState.markdown` 内容同步模型
- 切换前后内容一致
- 模式切换失败保护
- 光标和滚动恢复初版
- 长文档切换性能提示
- Markdown round-trip 验收标准

### Milestone 3（v0.1）：文档保真、接口骨架与 P0 MDX 基础

- Frontmatter raw metadata block
- 打开 Markdown 文件
- 保存文件
- 另存为
- 关闭前 dirty 提示
- 新建未保存文档的保存策略
- 内部 / 官方 Callout 组件
- Callout parser / serializer / node view / 插入命令
- 未知 MDX 组件 raw block 保真
- 大纲目录
- FeatureRegistry
- CommandRegistry
- KeymapRegistry
- MDXComponentRegistry
- MDX component descriptor
- parser / serializer 接入点
- 未知 MDX / JSX raw 保真
- v0.1 不支持第三方插件运行时

### Milestone 4（v0.1）：图片粘贴与最低错误反馈

- 粘贴图片
- 默认保存到 assets
- ImageStorageProvider 接口，本地 provider 优先
- 基础主题
- 最低可恢复错误反馈：保存失败、模式切换失败、Frontmatter 解析错误、未保存文档粘贴图片、图片写入失败

### Milestone 5（v0.2）：技术写作增强

- 最近文件
- 代码块高亮
- 语言标识
- 代码块内 Tab 缩进
- 复制代码按钮
- 大纲当前标题高亮与滚动同步
- 图片拖拽
- 图片自定义命名和重复文件处理
- 通用错误提示体验

### Milestone 5：MDX 组件增强

- mdx_component / mdx_raw schema 完善
- 扩展 LinkCard / Video / FileTree / Steps 等官方组件
- 不支持任意 import/export、任意 JS expression props、完整 MDX runtime

### Milestone 6（v0.2）：官方 MDX 组件产品化与导出模块边界

- 官方 Callout 组件 Level 2
- Callout parser / serializer / node view / 插入命令
- 组件 fallback 策略
- 该卡片化路线已被“真实渲染 + 原子选择 + 全局源码模式编辑”替代
- 不支持任意 import/export、任意 JS expression props、完整 MDX runtime

### Milestone 7（v0.3+）：产品化增强

- 设置
- 快捷键
- 菜单
- 长文档性能优化
- 图片自定义目录和云端上传接口
- 扩展 LinkCard / Video / FileTree / Steps 等官方 MDX 组件
- 导出模块
- AI 插件接口
- 显式续写
- 静默检查
- 用户自带 API Key
- OpenAI-compatible endpoint
- 静默检查默认关闭
- 本地模型、历史文章风格学习、`.aiignore`

---

## 16. 技术风险

### 16.1 历史 Milkdown 自研 UI 成本

风险：

- 不使用 Crepe 会增加初期开发工作量。

应对：

- 参考 Crepe 的 feature 设计。
- 优先实现必要功能。
- UI 与 editor plugin 解耦。

### 16.2 长文档性能

风险：

- 大量 decoration、Widget 和语法范围可能使 CM6 更新变慢。
- selection 变化或模式切换若触发全量 decoration 重建，长文档会明显卡顿。

应对：

- 基于 `ChangeDesc` 和活动选区增量更新范围。
- 固化迁移前性能基线，并记录 beta 限制。
- 后续评估 Worker 解析和分块优化。

### 16.3 MDX 复杂度

风险：

- 完整 MDX runtime 复杂度很高。
- MDX 是产品差异化能力，如果太晚验证，可能导致前期架构返工。

应对：

- 复用现有 MDX registry/plugins 接口并保证 raw 保真。
- CM6 迁移中用官方 Callout 做最小垂直切片。
- 只支持有限 MDX 子集。
- Callout 真实渲染并作为原子块选择，源码修改进入全局源码模式。
- 未知组件 raw block 保真。
- 不执行任意 JS。

### 16.4 PDF 导出质量

风险：

- 高质量 PDF 排版复杂。
- WebView / 系统打印 / headless pipeline 的体积、能力和跨平台一致性差异明显。

应对：

- 初期先做 HTML 导出和可用 PDF 导出。
- PDF 初版不承诺复杂排版质量。
- 后续独立打磨 PDF 模块。

### 16.5 Tauri 文件权限和保存可靠性

风险：

- Tauri v2 文件系统权限需要显式配置。
- 权限范围过宽会带来安全风险，过窄会影响文件打开和图片写入。
- 保存失败或应用崩溃可能破坏原文件。

应对：

- 文件读写集中在 `TauriFileService`。
- 使用 dialog 授权和最小权限 capabilities。
- 保存采用临时文件 + rename。
- 文件错误需要进入可测试的错误分支。

### 16.6 AI 干扰写作

风险：

- AI 静默检查可能打扰用户。

应对：

- AI 后置。
- 默认关闭静默检查。
- 高置信度才提示。
- 用户可关闭。

---

## 17. 测试计划

### 17.1 Markdown / MDX 保真测试

- 增加 Markdown round-trip fixtures，覆盖标题、列表、引用、fenced code block 保真、图片、Frontmatter、HTML block。
- 增加 MDX 保真 fixtures，覆盖未知组件、自闭合组件、有 children 的组件。
- 验证未知 MDX、Frontmatter raw YAML、HTML/raw block 在未主动编辑时不丢失。
- 明确定义允许归一化范围；Frontmatter、未知 MDX / JSX、HTML/raw block、fenced code block 内容必须保持原始文本。
- 每个 fixture 标注 `byte-equal` 或 `normalized-equal`。
- 对 raw 保真节点优先使用 `byte-equal` 验收。
- 验证打开、模式切换和保存直接保留 CM6 文本；结构化操作只规范化发生 transaction 的明确源码范围。
- 验证官方 Callout 组件未编辑时不重排 props、空白和 children。

### 17.2 模式切换测试

- 验证 WYSIWYG → Source → WYSIWYG 使用同一 `EditorView`，内容、history、selection 和 scroll position 保持一致。
- 验证两种模式保存都直接读取当前 `EditorState.doc`。
- 验证 dirty 状态以 `rawMarkdown` 和 `savedRawMarkdown` 为准。
- 验证模式 StateEffect 不产生文档 transaction 或 dirty 变化，长文档切换不会全量重建 editor。

### 17.3 文件生命周期测试

- 覆盖新建、打开、保存、另存为、dirty 状态、关闭前提示。
- 覆盖保存失败时原文件不被破坏、dirty 状态保留、错误可见。
- 覆盖无路径文档保存必须走另存为。
- 最近文件失效、外部文件移动或删除后的错误提示作为后续增强。

### 17.4 图片测试

- 验证已保存文档粘贴图片会写入同级 `assets` 目录，并插入相对路径。
- 验证未保存文档粘贴图片会提示先保存。
- 导出 smoke test 后续在导出模块中补充。

---

## 18. 阶段假设

- 第一阶段优先 macOS 桌面端。
- Web 和 Windows 只保留架构兼容，不作为 MVP 验收目标。
- MDX 是核心差异化能力，因此必须早期验证，但不追求完整 MDX runtime。
- AI 是后续增强能力，不参与前期核心技术风险验证。
