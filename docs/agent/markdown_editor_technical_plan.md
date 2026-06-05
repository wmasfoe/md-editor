# AI Markdown 编辑器技术方案

## 1. 技术目标

本技术方案用于指导开发一个面向技术写作者、程序员、博客作者的开源 Markdown / MDX 编辑器。

核心目标：

1. 使用 Milkdown Core 实现 Typora-like Markdown WYSIWYG 编辑体验。
2. 不使用 Crepe，但参考 Crepe 的模块拆分和插件实现方式。
3. 优先验证 `Milkdown Core + Markdown / MDX 保真 + 源码模式 + 文件保存` 主链路。
4. 支持本地文件打开 / 保存，并明确未保存文档、dirty 状态、关闭提示等文件生命周期。
5. 支持源码模式全局切换，第一阶段以内容一致性为优先目标。
6. 支持 Frontmatter raw metadata block，避免第一阶段对象化重写导致内容丢失。
7. 提前验证 MDX 最小垂直切片：`remark-mdx`、未知 MDX raw block 保真、一个官方 Callout 组件。
8. 支持图片复制到 assets 目录，并预留自定义存储接口。
9. 支持独立导出模块，首期支持 HTML / PDF。
10. 后续支持 AI 写作辅助插件。

优先级原则：

- 先验证核心技术风险，再扩展产品能力。
- MDX 是产品差异化能力，必须早期验证，但第一阶段不追求完整 MDX runtime。
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
  feature-image/           # 图片粘贴、拖拽、资源存储
  feature-frontmatter/     # Frontmatter 支持
  feature-code-block/      # 代码块高亮
  feature-mdx/             # MDX 组件系统
  feature-export/          # 导出模块
  feature-ai/              # 后续 AI 写作辅助
  file-system/             # 文件打开、保存、路径处理
  shared/                  # 公共类型、工具函数
```

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
  ├── Export
  ├── MDX Components
  └── AI Suggestion

Service Layer
  ├── FileService
  ├── ImageStorageProvider
  ├── Exporter
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
最近文件：local app data
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

  getMarkdown(): string
  getCurrentContent(): string
  setMarkdown(markdown: string): void

  focus(): void
  insertMarkdown(markdown: string): void

  onChange(listener: (markdown: string) => void): () => void
  onSelectionChange(listener: (selection: EditorSelection) => void): () => void
}

type EditorMode = 'wysiwyg' | 'source'
```

这样 App 层不直接依赖 Milkdown 细节，后续替换部分实现更容易。

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
  ui?: React.ComponentType<any>
}
```

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
  markdown: string
  savedMarkdown: string
  dirty: boolean
  mode: 'wysiwyg' | 'source'
}
```

### 5.3 注意事项

- 保存前从当前编辑模式获取最新内容。
- WYSIWYG 模式下从 Milkdown serializer 获取 Markdown。
- Source Mode 下从 CodeMirror 获取 Markdown。
- 关闭窗口或打开新文件前检查 dirty 状态。
- `path` 为空表示新建未保存文档，保存时必须走 `saveFileAs`。
- 未保存文档粘贴图片时，第一版提示用户先保存文档，再写入同级 `assets` 目录。
- 文件写入优先采用原子写入策略，避免保存失败时破坏原文件。
- 最近文件需要处理文件已移动、删除或无权限访问的情况。

### 5.4 文档保真原则

文档保真是第一阶段的核心验收标准，不能只依赖“能渲染出来”判断成功。

需要优先保证：

- Markdown round-trip 后内容不出现非必要改写。
- Frontmatter 在未被主动编辑时保持 raw YAML。
- 未知 MDX 组件、HTML block、raw block 不丢失。
- fenced code block 的语言、meta、缩进和内容不丢失。
- 源码模式和 WYSIWYG 模式来回切换后内容一致。

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
  1. 从 Milkdown 获取 markdown
  2. 更新 DocumentState.markdown
  3. 初始化 CodeMirror
  4. 设置 markdown
  5. 尝试恢复光标 / 滚动位置

Source → WYSIWYG:
  1. 从 CodeMirror 获取 markdown
  2. 更新 DocumentState.markdown
  3. 将 markdown 设置回 Milkdown
  4. 尝试恢复光标 / 滚动位置
```

第一阶段切换策略：

- 以 `DocumentState.markdown` 作为跨模式同步的唯一内容源。
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

第一阶段：

- 使用 debounce 降低频繁序列化。
- 源码模式下直接使用 CodeMirror 的大文档能力。
- 切换模式时显示轻量 loading。
- 对非常大的文档给出性能提示。

后续阶段：

- 按 block 增量同步。
- 文档分片解析。
- 大文档虚拟化。
- Worker 中执行 Markdown parse / serialize。
- 仅重建变化部分。

---

## 7. 图片资源模块

### 7.1 默认行为

图片粘贴 / 拖拽时：

1. 获取剪贴板或拖拽中的 image file。
2. 调用 ImageStorageProvider 保存。
3. 返回 Markdown 可使用的 `src`。
4. 插入 `![alt](src)` 或图片节点。

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

导出功能独立为 `feature-export`，不耦合 Milkdown 运行时。

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
Markdown → HTML → 打印 / WebView PDF
```

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

提前验证 MDX 最小垂直切片，支持官方内置 MDX 组件，并为后续第三方插件预留注册接口。

第一阶段只做：

- 接入 `remark-mdx`。
- 未知 MDX 组件 raw block 保真。
- 一个官方 Callout 组件的 parser、serializer、node view 和插入命令。
- 内置 Component Registry。

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

需要实现：

1. remark-mdx 解析 MDX。
2. Milkdown schema 定义 `mdx_component` 节点。
3. parser：mdx AST → ProseMirror node。
4. serializer：ProseMirror node → MDX string。
5. node view：渲染编辑器内组件卡片。
6. slash command：插入组件。
7. raw block fallback：未知组件保真。

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

第一阶段不支持：

- 执行任意 import/export。
- 任意 JS expression props 的结构化编辑。
- 任意动态组件运行。
- 完整 MDX runtime。
- 复杂嵌套 JSX 的完全可视化编辑。

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
  exporters: ExportRegistry
  imageStorage: ImageStorageRegistry
}
```

### 14.2 注册中心

需要维护：

- CommandRegistry
- MDXComponentRegistry
- ExportRegistry
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

### Milestone 1：项目骨架与编辑器最小闭环

- Tauri + React + TypeScript 项目初始化
- Milkdown Core 接入
- 基础 Markdown WYSIWYG 编辑
- EditorRuntime 封装
- 文档状态管理

### Milestone 2：文件生命周期与文档保真基础

- 打开 Markdown 文件
- 保存文件
- 另存为
- 关闭前 dirty 提示
- 最近文件
- Markdown round-trip 验收标准
- Frontmatter raw metadata block
- 新建未保存文档的保存策略

### Milestone 3：源码模式

- CodeMirror 6 接入
- WYSIWYG / Source Mode 全局切换
- 切换前后内容一致
- 光标和滚动恢复初版
- 长文档切换性能提示

### Milestone 4：MDX 最小垂直切片

- remark-mdx 接入
- mdx_component / mdx_raw 最小 schema
- 未知 MDX 组件 raw block 保真
- 官方 Callout 组件
- Callout parser / serializer / node view / 插入命令
- 不支持任意 import/export、任意 JS expression props、完整 MDX runtime

### Milestone 5：技术写作基础能力

- 大纲目录
- 代码块高亮
- 语言标识
- 代码块内 Tab 缩进
- 复制代码按钮
- 粘贴图片
- 拖拽图片
- 默认保存到 assets
- ImageStorageProvider 接口，本地 provider 优先

### Milestone 6：导出模块

- Exporter 接口
- HTML 导出
- PDF 导出初版
- MDX 组件 preview 或 fallback HTML
- 图片路径按当前文件路径和 assets 目录解析

### Milestone 7：产品化增强

- 主题
- 设置
- 快捷键
- 菜单
- 错误提示
- 长文档性能优化
- 图片自定义目录和云端上传接口
- 扩展 LinkCard / Video / FileTree / Steps 等官方 MDX 组件

### Milestone 8：AI 增强

- AI 插件接口
- 显式续写
- 静默检查
- 用户自带 API Key
- OpenAI-compatible endpoint
- 静默检查默认关闭
- 本地模型、历史文章风格学习、`.aiignore`

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

- 第一阶段提前做最小垂直切片。
- 只支持有限 MDX 子集。
- 先实现官方 Callout 组件。
- 未知组件 raw block 保真。
- 不执行任意 JS。

### 16.4 PDF 导出质量

风险：

- 高质量 PDF 排版复杂。

应对：

- 初期先做可用导出。
- 后续独立打磨 PDF 模块。

### 16.5 AI 干扰写作

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

- 增加 Markdown round-trip fixtures，覆盖标题、列表、引用、代码块、图片、Frontmatter、HTML block。
- 增加 MDX 保真 fixtures，覆盖未知组件、自闭合组件、有 children 的组件、Callout 组件。
- 验证未知 MDX、Frontmatter raw YAML、HTML/raw block 在未主动编辑时不丢失。

### 17.2 模式切换测试

- 验证 WYSIWYG → Source → WYSIWYG 后内容一致。
- 验证源码模式保存和 WYSIWYG 模式保存都使用当前最新内容。
- 验证长文档切换时出现性能提示，并且切换失败不会破坏原内容。

### 17.3 文件生命周期测试

- 覆盖新建、打开、保存、另存为、dirty 状态、关闭前提示。
- 覆盖最近文件失效、保存失败、无路径文档保存。
- 覆盖外部文件移动或删除后的错误提示。

### 17.4 图片与导出测试

- 验证已保存文档粘贴图片会写入同级 `assets` 目录，并插入相对路径。
- 验证未保存文档粘贴图片会提示先保存或走明确的临时策略。
- 增加导出 smoke test，覆盖 Markdown、Frontmatter、图片、代码块、Callout 到 HTML / PDF 的基本输出。

---

## 18. 阶段假设

- 第一阶段优先 macOS 桌面端。
- Web 和 Windows 只保留架构兼容，不作为 MVP 验收目标。
- MDX 是核心差异化能力，因此必须早期验证，但不追求完整 MDX runtime。
- AI 是后续增强能力，不参与前期核心技术风险验证。
