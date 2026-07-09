# AI Markdown 编辑器技术方案

## 1. 技术目标

本技术方案用于指导开发一个面向技术写作者、程序员、博客作者的开源 Markdown / MDX 编辑器。

核心目标：

1. 使用 Milkdown Core 实现 Typora-like Markdown WYSIWYG 编辑体验。
2. 不使用 Crepe，但参考 Crepe 的模块拆分和插件实现方式。
3. 优先验证 `Milkdown Core + Markdown 编辑 + 文件保存 + Frontmatter / MDX 保真 + 内部 MDX 组件接入` 主链路。
4. 支持本地文件打开 / 保存，并明确未保存文档、dirty 状态、关闭提示等文件生命周期。
5. 支持源码模式全局切换，第一阶段以内容一致性为优先目标。
6. 支持 Frontmatter raw metadata block，避免第一阶段对象化重写导致内容丢失。
7. 提前预留 MDX 接入接口并保证未知 MDX raw block 保真；官方 Callout 组件作为 M0 / v0.1 最小切片验证对象。
8. 支持图片复制到 assets 目录，并预留自定义存储接口。
9. 支持独立导出模块，但导出模块边界作为 P1，在核心编辑链路稳定后再进入；首期目标为 HTML / PDF。
10. 后续支持 AI 写作辅助插件。

优先级原则：

- 先验证核心技术风险，再扩展产品能力。
- MDX 是产品差异化能力，内部 / 官方组件最小接入进入 P0，但第一阶段不追求完整 MDX runtime。
- 源码模式和导出模块均为 P1，不进入第一优先级主链路。
- AI 是增强能力，不进入基础编辑器 MVP。
- 导出质量依赖 Markdown / MDX 解析、主题、图片路径和组件 fallback 策略，因此在核心编辑链路稳定后再做。

---

## 2. 总体架构

建议采用 monorepo 结构：

```txt
apps/
  desktop/                 # Tauri 桌面端，优先 macOS
  web/                     # 后续 Web 端

packages/
  editor-core/             # Milkdown Core 封装
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
  editor-core/             # 先承载编辑器 runtime、内置 feature、parser/serializer
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
  ├── Milkdown Core
  ├── ProseMirror plugins
  ├── Markdown parser / serializer
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
Milkdown Core
ProseMirror
remark / unified
CodeMirror 6
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

## 4. Milkdown Core 封装方案

### 4.1 不直接暴露 Milkdown

建议在 `packages/editor-core` 中封装一个 Editor Runtime：

```ts
interface EditorRuntime {
  create(options: EditorCreateOptions): Promise<void>
  destroy(): Promise<void>

  getMode(): EditorMode
  setMode(mode: EditorMode): Promise<void>

  getContent(): EditorContent
  setContent(content: EditorContent): Promise<void>
  serialize(): EditorSerializeResult

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
  markdown?: string
  rawFragments?: RawFragment[]
}

interface EditorSerializeResult {
  rawMarkdown: string
  markdown: string
  rawFragments: RawFragment[]
}
```

这样 App 层不直接依赖 Milkdown 细节，后续替换部分实现更容易。

Runtime 职责边界：

- Runtime 负责 Milkdown / ProseMirror / CodeMirror 的生命周期和模式切换。
- Runtime 对外只暴露内容、命令、选区和交互状态，不暴露底层 editor view 作为常规业务依赖。
- Runtime 负责把 ProseMirror doc、CodeMirror doc、raw fragment 合成为可保存的 `rawMarkdown`。
- App 层负责文件生命周期、窗口菜单、最近文件、设置和全局 UI，不直接拼接 Markdown。
- Feature 可以注册 parser、serializer、command、keymap 和必要 UI，但不能绕过 Runtime 改写文档权威源。

### 4.2 插件组织方式

每个功能尽量做成独立插件：

```txt
editor-core
  ├── createEditor()
  ├── registerFeature()
  └── feature plugins
```

参考 Crepe 的思路，但不用 Crepe 的封装：

```txt
Feature = Milkdown plugin + ProseMirror plugin + command + keymap + UI state
```

建议统一 Feature 接口：

```ts
interface EditorFeature {
  name: string
  milkdownPlugins?: unknown[]
  prosePlugins?: unknown[]
  commands?: Record<string, EditorCommand>
  keymaps?: Record<string, EditorCommand>
  parseExtensions?: MarkdownParseExtension[]
  serializeExtensions?: MarkdownSerializeExtension[]
  ui?: React.ComponentType<any>
}
```

### 4.3 内容状态流转

Milkdown 是 WYSIWYG 交互内核，但文件内容权威源仍然是 `rawMarkdown`。

```txt
FileService 读取文件
  ↓
DocumentState.rawMarkdown
  ↓
EditorRuntime.setContent()
  ↓
Markdown / MDX parser + raw fragment collector
  ↓
ProseMirror doc
  ↓
用户在 WYSIWYG 中编辑
  ↓
EditorRuntime.serialize()
  ↓
serializeWithRawFragments()
  ↓
DocumentState.rawMarkdown
  ↓
FileService 保存
```

关键约束：

- ProseMirror doc 是结构化编辑状态，不是保存时唯一事实来源。
- CodeMirror doc 是源码模式编辑状态，源码模式下它的全文内容可以直接更新 `rawMarkdown`。
- `rawMarkdown` 是保存和 dirty 判断的权威内容。
- `markdown` 是结构化 serializer 的当前输出，可用于 UI 同步、调试和 normalized fixture，但不单独决定保存内容。

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

合成策略：

- 用户未主动编辑 raw fragment 时，serializer 必须优先输出 `source` 原文。
- 用户主动编辑 raw fragment 或结构化组件后，才允许重新生成对应 Markdown / MDX。
- 已注册官方 MDX 组件也建议保留 `rawSource` / `rawProps` / `sourceRange`，避免未编辑时重排 props、引号、空白和 children。
- 如果无法可靠映射某段语法，第一阶段应降级为 raw block，而不是丢弃或格式化。
- Milestone 0 必须验证 raw fragment collector、dirty 标记和 `serializeWithRawFragments()` 的最小闭环。

### 4.5 交互状态分层

Milkdown 相关状态需要按职责分层，避免所有状态挤进 React 全局 store。

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
- `EditorRuntimeState`：Runtime 是否初始化、当前模式、是否正在切换。
- `EditorInteractionState`：选区、焦点、输入法 composing、浮层、菜单、AI ghost text。
- `FeatureState`：大纲、MDX registry、图片 storage provider、导出 registry、插件配置。

交互原则：

- ProseMirror transaction 和 plugin state 承担编辑器内部高频状态。
- React 只订阅需要渲染外部 UI 的低频状态，例如 toolbar、outline、侧栏和浮层。
- 输入法 composing 期间避免触发破坏输入连续性的自动格式化、AI 替换和模式切换。
- selection、floating menu、slash menu、link tooltip 需要由 Runtime 统一派发状态，避免多个 feature 争抢 DOM 事件。

### 4.6 第一阶段交互边界

第一阶段必须稳定：

- 基础 Markdown 输入、删除、粘贴、撤销、重做。
- 标题、列表、引用、代码块、链接、图片的基础快捷键和命令。
- Frontmatter、未知 MDX、HTML block 以 raw block 形式可见、可复制、可保存。
- 内部 / 官方 MDX 组件的插入、编辑、保存和再次打开。
- 编辑器 focus、selection、dirty 状态和关闭提示可靠。

第一阶段可以延后：

- WYSIWYG / Source Mode 全局切换。
- 完整 toolbar 体验。
- 跨模式 undo history。
- 精准光标映射。
- 复杂 block handle / drag handle。
- 第三方 MDX 组件运行时预览。
- AI 静默检查和 ghost text。

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
  markdown: string
  savedRawMarkdown: string
  rawFragments: RawFragment[]
  dirty: boolean
  mode: 'wysiwyg' | 'source'
  parseStatus: 'clean' | 'warning' | 'error'
}
```

字段说明：

- `rawMarkdown` 是当前文档的保存权威源，优先保留用户原始源码。
- `markdown` 是结构化 serializer 的当前输出，可用于 UI 同步、调试和 normalized fixture。
- `savedRawMarkdown` 是最近一次成功保存后的 raw 内容快照。
- `rawFragments` 记录需要原文保真的 Frontmatter、未知 MDX、HTML block 等片段。
- `dirty` 优先由 `rawMarkdown !== savedRawMarkdown` 得出，不能只依赖 ProseMirror doc 是否变化。
- ProseMirror doc 是 WYSIWYG 编辑结构，不应被当作唯一源码事实来源。

### 5.3 注意事项

- 保存前从当前编辑模式获取最新内容。
- WYSIWYG 模式下通过 `EditorRuntime.serialize()` 合成 `rawMarkdown`，不能直接把普通 Milkdown serializer 输出当作保存内容。
- Source Mode 下从 CodeMirror 获取全文内容，并更新 `rawMarkdown`。
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

- Markdown round-trip 后内容不出现非必要改写。
- Frontmatter 在未被主动编辑时保持 raw YAML。
- 未知 MDX 组件、HTML block、raw block 不丢失。
- fenced code block 的语言、meta、缩进和内容不丢失。
- P1 源码模式启用后，源码模式和 WYSIWYG 模式来回切换内容一致。

实现原则：

- 对 Frontmatter、未知 MDX、HTML block、raw block 使用 raw text 节点或 raw fragment 记录原始源码。
- 用户未主动编辑这些 raw 节点时，serializer 必须优先输出原始文本。
- 用户主动编辑结构化节点后，才允许由 serializer 生成规范化 Markdown。
- 每个保真 fixture 必须标注 `byte-equal` 或 `normalized-equal` 验收级别。
- 第一阶段宁可把不确定语法显示为 raw block，也不要丢弃或重写源码。

---

## 6. 源码模式技术方案

### 6.1 基本策略

源码模式为全局切换，不做双视图。

```txt
WYSIWYG Mode: Milkdown / ProseMirror
Source Mode: CodeMirror 6
```

切换流程：

```txt
WYSIWYG → Source:
  1. 调用 EditorRuntime.serialize()
  2. 合并 raw fragment 后更新 DocumentState.rawMarkdown / markdown / rawFragments
  3. 初始化 CodeMirror
  4. 设置 rawMarkdown
  5. 尝试恢复光标 / 滚动位置

Source → WYSIWYG:
  1. 从 CodeMirror 获取 rawMarkdown
  2. 更新 DocumentState.rawMarkdown
  3. 将 rawMarkdown 设置回 Milkdown
  4. 重新解析 raw fragment
  5. 尝试恢复光标 / 滚动位置
```

P1 初版切换策略：

- 以 `DocumentState.rawMarkdown` 作为跨模式同步的保存权威源。
- `DocumentState.markdown` 可作为当前模式输出和 UI 同步内容，但不单独承担源码保真。
- dirty 判断以 `rawMarkdown` 和 `savedRawMarkdown` 为准。
- 模式切换必须保证内容一致性，光标和滚动恢复作为可用性目标，不作为第一轮阻塞项。
- 切换失败时保留原模式和原内容，并向用户提示错误。
- undo history 暂不要求跨模式完整保留，后续再优化。

### 6.2 长文档性能风险

重点关注：

- Markdown 序列化耗时。
- Markdown 重新解析耗时。
- ProseMirror 节点数过多导致 DOM 压力。
- Source Mode 切回 WYSIWYG 时卡顿。
- 大量 decorations 导致更新慢。

### 6.3 优化策略

P1 初版：

- 使用 debounce 降低频繁序列化。
- 源码模式下直接使用 CodeMirror 的大文档能力。
- 切换模式时显示轻量 loading。
- 对非常大的文档给出性能提示。
- WYSIWYG 切到源码模式时，优先复用 raw fragment 保留的原始源码。

后续阶段：

- 按 block 增量同步。
- 文档分片解析。
- 大文档虚拟化。
- Worker 中执行 Markdown parse / serialize。
- 仅重建变化部分。

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

监听编辑器文档变化，扫描 ProseMirror doc 中的 heading 节点：

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

本节能力属于 v0.2 技术写作增强，不属于 v0.1 必做范围。v0.1 只要求 fenced code block 的源码保真，包括语言标识、meta、缩进和内容。

### 9.1 基础方案

使用 Milkdown code block schema + 自定义 node view 集成 CodeMirror 6。

### 9.2 功能

- fenced code block。
- language meta。
- syntax highlight。
- code block 内 Tab 缩进。
- 复制代码按钮。
- 后续支持语言选择器、行号、折叠、搜索等。

### 9.3 注意事项

- CodeMirror 嵌入 ProseMirror node view 时需要处理焦点和 selection。
- 代码块内按键事件不要冒泡破坏外层编辑器。
- Markdown serializer 必须保留语言信息。

---

## 10. Frontmatter 技术方案

### 10.1 解析

文档顶部 Frontmatter 使用 remark-frontmatter 或 gray-matter 识别。

第一阶段只把解析结果用于识别、展示和错误提示，不默认把 YAML 转为对象后重新序列化。

### 10.2 编辑表现

第一阶段：

```txt
WYSIWYG 模式：显示为可折叠 raw YAML metadata block
Source Mode：显示原始 YAML
```

后续阶段：

```txt
支持表单化编辑 title / date / tags / description 等字段
```

### 10.3 数据原则

- Frontmatter 是文档级 metadata。
- 不应被当作普通正文段落。
- 序列化时必须保持在文档顶部。
- 未被用户主动编辑时必须保留 raw YAML 文本，包括注释、字段顺序、引号和日期格式。
- 若无法解析 YAML，应显示错误状态，但不丢失原始内容。

---

## 11. 导出模块技术方案

### 11.1 模块独立

导出功能独立为 `feature-export`，不耦合 Milkdown 运行时。该模块属于 P1，在 P0 编辑和保存主链路稳定后进入。

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
- MDX 组件 fallback 或预览渲染。

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

提前预留 MDX 接入接口，保证未知 MDX / JSX raw block 保真，并为后续第三方插件预留注册接口。

v0.1 只做：

- 接入 `remark-mdx`。
- 未知 MDX 组件 raw block 保真。
- 内置 Component Registry 和 descriptor 类型。
- MDX import/export、expression、未知 JSX 节点全部 raw 保真展示，不执行、不格式化。
- 一个官方 Callout 组件的 parser、serializer、node view 和插入命令，用于验证最小垂直切片。

v0.2 再将官方 `Callout` 组件产品化：

- Callout 卡片化展示 + 源码编辑。
- 更完整的组件 fallback 策略。

不把完整 MDX runtime、第三方组件加载、npm 插件作为 MVP 目标。

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
  Editor: React.ComponentType<MDXComponentEditorProps>
  Preview?: React.ComponentType<any>
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

### 12.4 Milkdown 接入点

v0.1 需要实现：

1. remark-mdx 解析 MDX。
2. raw block fallback：未知组件保真。
3. Component Registry 和 descriptor 类型。
4. raw inline fallback：未知 inline JSX / expression 保真。
5. `mdx_component` 节点。
6. parser：mdx AST → ProseMirror node。
7. serializer：ProseMirror node → MDX string。
8. node view：渲染编辑器内组件卡片。
9. slash command：插入组件。

MDX AST 处理边界：

- 已注册的官方组件可以转为结构化 `mdx_component` 节点。
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

这些语法在第一阶段仍应可打开、显示、保存，并尽量保持原始源码不变。

---

## 13. AI 写作辅助技术方案

AI 功能后置，不阻塞基础编辑器。

### 13.1 AI Suggestion Plugin

基于 ProseMirror plugin 实现：

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

## 14. 插件系统建议

### 14.1 Feature Plugin

第一阶段插件系统只作为编译期内置 Feature Registry 使用，不设计第三方运行时加载。

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

### 14.3 插件加载阶段

第一阶段：

```txt
编译期内置插件 / 内置 Feature Registry
```

第二阶段：

```txt
npm 包插件
```

第三阶段：

```txt
本地插件目录 / 插件市场
```

第三方插件涉及权限、安全、版本兼容、UI 插槽、加载失败隔离等问题，全部移到远期产品化阶段。

---

## 15. 开发里程碑

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
- 第三方组件注册接口设计

### Milestone 6（v0.2）：官方 MDX 组件产品化与导出模块边界

- 官方 Callout 组件 Level 2
- Callout parser / serializer / node view / 插入命令
- 组件 fallback 策略
- 卡片化展示 + 源码编辑
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
- 第三方插件运行时
- 本地插件目录 / 插件市场

---

## 16. 技术风险

### 16.1 Milkdown Core 自研 UI 成本

风险：

- 不使用 Crepe 会增加初期开发工作量。

应对：

- 参考 Crepe 的 feature 设计。
- 优先实现必要功能。
- UI 与 editor plugin 解耦。

### 16.2 长文档性能

风险：

- ProseMirror 对超长文档可能有性能瓶颈。
- 模式切换可能卡顿。

应对：

- 使用 debounce。
- 大文档提示。
- 后续 Worker 解析和分块优化。

### 16.3 MDX 复杂度

风险：

- 完整 MDX runtime 复杂度很高。
- MDX 是产品差异化能力，如果太晚验证，可能导致前期架构返工。

应对：

- v0.1 先预留 MDX 接入接口并保证 raw 保真。
- v0.2 再做官方 Callout 最小垂直切片。
- 只支持有限 MDX 子集。
- Callout 先做卡片化展示 + 源码编辑，不做结构化表单编辑。
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
- 验证 `serializeWithRawFragments()` 未编辑 raw fragment 时输出原文，编辑后才输出规范化内容。
- 验证官方 Callout 组件未编辑时不重排 props、空白和 children。

### 17.2 模式切换测试

- 验证 WYSIWYG → Source → WYSIWYG 后内容一致。
- 验证源码模式保存和 WYSIWYG 模式保存都使用当前最新内容。
- 验证 dirty 状态以 `rawMarkdown` 和 `savedRawMarkdown` 为准。
- 验证长文档切换时出现性能提示，并且切换失败不会破坏原内容。

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
