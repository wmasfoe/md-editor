# AI Markdown 编辑器任务优先级

## 1. 文档用途

本文用于记录当前确认的任务列表、优先级和阶段边界，作为后续拆分 PRD、技术方案和执行任务时的优先级依据。

CM6 迁移顺序和实时进度分别以 [`custom_markdown_renderer_architecture.md`](../architecture/custom_markdown_renderer_architecture.md) 与 [`codemirror_renderer_migration_status.md`](../status/codemirror_renderer_migration_status.md) 为准。本文件保留已经完成的 v0.1 历史项，但不再把 Milkdown 或第三方插件作为未来目标。

当前结论：

- v0.1 目标是用户真的可以日常写 Markdown 的最小产品，不是纯技术原型。
- 内置能力通过明确的 feature / command / keymap 边界接入，但不建设第三方插件运行时。
- MDX 只支持官方内置组件；未知源码必须保真，官方 `Callout` 用于真实渲染和原子选择验证。
- WYSIWYG 与源码模式统一使用 CM6，不维护 Milkdown / CM6 双运行时。
- 可以发布记录明确缺口的 beta，但文档状态必须与代码和验证证据同步。

## 2. 优先级定义

### P0

没有它就不能发布 v0.1，或者缺失后会导致后续插件 / MDX 架构返工。

### P1

明显影响技术写作体验，建议在 v0.1 后半段或 v0.2 补齐，但不应阻塞最小写作闭环。

### P2

产品增强或远期能力，不阻塞第一版。

## 3. P0：v0.1 必做

| 任务 | 目标 |
|---|---|
| 项目骨架 | Tauri + React + TypeScript + Vite + monorepo 基础结构 |
| EditorRuntime 封装 | App 层不直接依赖具体编辑器引擎，统一编辑器生命周期、内容读写、事件和命令入口 |
| Feature 插件接口 | 提供编译期 `FeatureRegistry`，所有内置功能都通过 feature 注册 |
| Command / Keymap 注册接口 | 为后续插件、MDX 组件和 AI 功能预留统一命令与快捷键入口 |
| Markdown WYSIWYG 基础编辑 | 支持标题、段落、列表、引用、粗体、斜体、链接、分割线等日常写作能力 |
| 文件生命周期 | 新建、打开 `.md`、保存、另存为、dirty 状态、关闭前提示 |
| 原子保存策略 | 避免保存失败破坏原文件 |
| Source Mode | 与 WYSIWYG 复用同一 CM6 EditorView、history、selection 和 scroll |
| 内容同步模型 | CM6 文本是活动编辑事实源，`DocumentState.rawMarkdown` 是持久化和订阅镜像 |
| Markdown 保真测试 | round-trip fixtures 覆盖基础 Markdown、代码块、Frontmatter、HTML/raw block |
| Frontmatter raw 支持 | WYSIWYG 显示可编辑 YAML 元数据面板，Source Mode 显示完整原始 YAML |
| 大纲目录 | 解析 Markdown h1-h6 标题，生成目录并支持点击跳转 |
| 图片粘贴 | 已保存文档粘贴图片时写入同级 `assets`，插入相对路径 |
| MDX 接入接口 | 复用 `mdx-component-registry` metadata 和 `mdx-plugins` 官方组件 map |
| MDX raw 保真 | 未知 MDX / JSX 不丢源码；官方组件真实渲染、原子选择和整块删除 |
| 扩展边界 | 只支持内置编译期 feature 和官方 MDX 组件，不支持 npm 插件、本地插件目录和插件市场 |

## 4. P1：v0.1 后半段 / v0.2 优先

| 任务 | 状态 | 目标 |
|---|---|---|
| 代码块增强 | 部分完成 | WYSIWYG 已有轻量级基础高亮和语言输入；更完整的语言覆盖和主题化仍待增强 |
| 代码块内编辑体验 | 部分完成 | 已支持 Tab 缩进、复制按钮；复杂 selection 保持和更多编辑细节仍可增强 |
| 大纲增强 | 部分完成 | 当前标题高亮、滚动同步已接入；长文档性能优化仍待增强 |
| 图片增强 | 未开始 | 拖拽图片、自定义命名、重复文件处理 |
| ImageStorageProvider 接口 | 未开始 | 先实现本地 provider，接口兼容后续自定义目录和云端上传 |
| 最近文件 | 未开始 | 记录最近打开文件，并处理文件移动、删除和无权限访问 |
| 官方 MDX 组件最小切片 | 未开始 | 用 `Callout` 验证 registry、AST range、真实渲染、原子选择、后代交互拦截和错误占位 |
| 错误提示体系 | 部分完成 | 文件操作已有顶部错误提示；解析失败、模式切换失败等仍需更完整的用户提示 |
| 基础主题 | 部分完成 | 已有 Typora-like 亮色基础样式；暗色主题和主题切换仍待补齐 |

## 4.1 已完成的 v0.1 打磨项

记录日期：2026-06-17

- 文件树新建空文件夹后会继续显示在树中；空目录不再被 Markdown/图片过滤规则误隐藏。
- 文件树目录折叠状态按 workspace 持久化，重新打开同一目录时恢复上次展开/折叠状态。
- 大纲支持当前标题高亮，并跟随 Source Mode / WYSIWYG 编辑区滚动同步。
- WYSIWYG fenced code block 接入轻量级 decoration 高亮，不改写文档内容，覆盖常见 JS/TS/JSON/YAML/Shell/CSS/HTML token。
- WYSIWYG code block 支持复制按钮、Tab 缩进，以及右下角语言输入；语言模糊匹配只作为提示，最终以用户输入为准。

## 5. P2：v0.3+

| 任务 | 目标 |
|---|---|
| HTML 导出 | 独立 Exporter 接口，处理主题、图片路径、Frontmatter |
| PDF 导出 | 通过 HTML 到 PDF 先实现可用导出，再逐步优化排版 |
| 更多官方 MDX 组件 | LinkCard、Video、FileTree、Steps 等 |
| 图片自定义目录 | 用户可配置 assets 目录和命名规则 |
| 云端图片上传 | 用户通过自定义 provider 接入云端存储 |
| AI 显式续写 | Ghost text、Tab 接受、Esc 取消 |
| AI 静默检查 | 默认关闭，高置信度轻提示 |
| 用户风格学习 | 本地历史文章索引、风格画像、`.aiignore` |

## 6. CM6 迁移里程碑

本节只给出产品级摘要，具体 Go/No-Go、测试和 beta 规则以 CM6 架构文档为准。

### M0：CM6 单编辑器主链路

- 单一 `EditorView`、`DocumentState` 同步和模式 `StateField`
- 打开、编辑、保存、LF、history、selection 和 scroll smoke
- Desktop 切换到 CM6，删除 Milkdown 编辑器路径和产品依赖
- 达到最小门槛后允许发布明确标注缺口的 beta

### M1-M4：可视化编辑能力

- M1：CommonMark / GFM、链接、图片、列表、Frontmatter 和选区语义
- M2：代码块语言、高亮、行号、复制和直接编辑
- M3：标准 GFM 表格结构化编辑
- M4：基础 HTML 和官方 MDX 组件

### M5：现有能力迁移

- AI suggestion、搜索、大纲、图片粘贴、链接打开、主题和可访问性
- 每项能力迁移后更新状态和验证证据

### M6：稳定发布收口

- 完成功能矩阵、性能、可访问性、全仓验证和迁移期清理
- beta 可用不等于 M6 完成

## 7. 当前非目标

当前路线不做：

- 完整 MDX runtime。
- 任意 import / export 执行。
- 任意 JS expression props 的结构化编辑。
- 复杂嵌套 JSX 的完整可视化编辑。
- HTML / PDF 导出。
- AI 写作辅助。
- 官方 `Callout` 组件的结构化表单编辑。
- npm 第三方插件加载。
- 本地插件目录。
- 插件市场。
- 用户导入或第三方 MDX 组件。

## 8. 决策边界

后续实现时可以自动决定：

- FeatureRegistry、CommandRegistry、KeymapRegistry 的具体代码组织。
- 内置功能如何拆分 feature 包。
- v0.1 中 MDX raw 保真的内部节点模型。
- Source Mode 切换失败时的保护实现。
- Markdown round-trip fixtures 的初始覆盖集合。

## 9. Callout 编辑层级

### Level 1：Raw 保真

未知或无法渲染的 `Callout` 显示安全占位块，主要通过 Source Mode 编辑。目标是保证源码不丢失、不被错误改写。

这是所有未知 MDX / JSX 的保真底线。

### Level 2：真实渲染 + 原子选择

WYSIWYG 中真实渲染官方 `Callout`；点击任意后代只选中整个组件，显示高亮描边，删除作用于完整源码范围。修改 props 和 children 时切换到全局源码模式。

这是 CM6 迁移的官方 MDX 组件目标，用于验证 registry、AST range、React Widget、插入命令和安全降级策略。

### Level 3：结构化表单编辑

WYSIWYG 中把 `Callout` 的 props 和 children 拆成可视化控件，例如 `type` 下拉选择、`title` 输入框、内容区 Markdown 编辑。

该能力不在当前路线内，不得作为 beta 或稳定迁移的隐含承诺。
