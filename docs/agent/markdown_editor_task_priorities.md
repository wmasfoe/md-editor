# AI Markdown 编辑器任务优先级

## 1. 文档用途

本文用于记录当前确认的任务列表、优先级和阶段边界，作为后续拆分 PRD、技术方案和执行任务时的优先级依据。

当前结论：

- v0.1 目标是用户真的可以日常写 Markdown 的最小产品，不是纯技术原型。
- v0.1 实现时必须做好插件化和 MDX 接入兼容，留好接口，避免后续架构返工。
- v0.1 不要求完整第三方插件运行时，也不要求完整 MDX 组件编辑体验。
- v0.1 只要求 MDX raw 保真和接入接口；官方 `Callout` 组件先进入 v0.2 的最小切片。

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
| EditorRuntime 封装 | App 层不直接依赖 Milkdown，统一编辑器生命周期、内容读写、事件和命令入口 |
| Feature 插件接口 | 提供编译期 `FeatureRegistry`，所有内置功能都通过 feature 注册 |
| Command / Keymap 注册接口 | 为后续插件、MDX 组件和 AI 功能预留统一命令与快捷键入口 |
| Markdown WYSIWYG 基础编辑 | 支持标题、段落、列表、引用、粗体、斜体、链接、分割线等日常写作能力 |
| 文件生命周期 | 新建、打开 `.md`、保存、另存为、dirty 状态、关闭前提示 |
| 原子保存策略 | 避免保存失败破坏原文件 |
| Source Mode | CodeMirror 6 全局切换，内容一致性优先 |
| 内容同步模型 | 以 `DocumentState.markdown` 作为跨 WYSIWYG / Source Mode 的唯一内容源 |
| Markdown 保真测试 | round-trip fixtures 覆盖基础 Markdown、代码块、Frontmatter、HTML/raw block |
| Frontmatter raw 支持 | WYSIWYG 显示 raw metadata block，Source Mode 保留原始 YAML |
| 大纲目录 | 解析 Markdown h1-h6 标题，生成目录并支持点击跳转 |
| 图片粘贴 | 已保存文档粘贴图片时写入同级 `assets`，插入相对路径 |
| MDX 接入接口 | 提供 `MDXComponentRegistry`、组件 descriptor、parser / serializer 接入点 |
| MDX raw 保真 | 未知 MDX / JSX 不丢源码；v0.1 可先不做结构化编辑 |
| 插件兼容边界 | 明确 v0.1 只支持内置编译期 feature，不支持 npm 插件、本地插件目录和插件市场 |

## 4. P1：v0.1 后半段 / v0.2 优先

| 任务 | 目标 |
|---|---|
| 代码块增强 | fenced code block、语言标识保真、基础高亮 |
| 代码块内编辑体验 | Tab 缩进、复制按钮、焦点和 selection 不冲突 |
| 大纲增强 | 当前标题高亮、滚动同步、性能优化 |
| 图片增强 | 拖拽图片、自定义命名、重复文件处理 |
| ImageStorageProvider 接口 | 先实现本地 provider，接口兼容后续自定义目录和云端上传 |
| 最近文件 | 记录最近打开文件，并处理文件移动、删除和无权限访问 |
| 官方 MDX 组件最小切片 | 只做 `Callout` Level 2，验证 registry、parser、serializer、node view 和源码编辑 |
| 错误提示体系 | 文件保存失败、解析失败、模式切换失败时给出可理解提示 |
| 基础主题 | 提供日常写作可用的亮色 / 暗色基础样式 |

## 5. P2：v0.3+

| 任务 | 目标 |
|---|---|
| HTML 导出 | 独立 Exporter 接口，处理主题、图片路径、Frontmatter |
| PDF 导出 | 通过 HTML 到 PDF 先实现可用导出，再逐步优化排版 |
| 更多官方 MDX 组件 | LinkCard、Video、FileTree、Steps 等 |
| 第三方插件运行时 | npm 包、本地插件目录、权限、安全、版本兼容、加载失败隔离 |
| 图片自定义目录 | 用户可配置 assets 目录和命名规则 |
| 云端图片上传 | 用户通过自定义 provider 接入云端存储 |
| AI 显式续写 | Ghost text、Tab 接受、Esc 取消 |
| AI 静默检查 | 默认关闭，高置信度轻提示 |
| 用户风格学习 | 本地历史文章索引、风格画像、`.aiignore` |

## 6. 推荐里程碑

### M1：可保存的 Markdown 编辑闭环

- 项目骨架
- Milkdown Core 接入
- EditorRuntime 封装
- 基础 Markdown WYSIWYG
- 文件生命周期
- dirty 状态
- 原子保存

### M2：插件化架构与 MDX 保真接口

- FeatureRegistry
- CommandRegistry
- KeymapRegistry
- MDXComponentRegistry
- MDX descriptor
- parser / serializer 接入点
- 未知 MDX / JSX raw 保真

### M3：源码模式与内容一致性

- CodeMirror 6 接入
- WYSIWYG / Source Mode 全局切换
- `DocumentState.markdown` 内容同步模型
- 模式切换失败保护
- round-trip 和模式切换测试

### M4：日常写作增强

- Frontmatter raw metadata block
- 代码块增强
- 大纲目录
- 图片粘贴
- 最近文件
- 基础主题
- 错误提示

### M5：官方 MDX 组件最小切片

- 官方 `Callout` 组件 Level 2
- Callout parser / serializer / node view
- 卡片化展示 + 源码编辑
- 插入命令
- 组件 fallback 策略

### M6：导出模块

- Exporter 接口
- HTML 导出
- PDF 导出初版
- 图片路径解析
- MDX fallback / preview 输出策略

### M7：AI 与第三方插件运行时

- AI 插件接口
- 显式续写
- 静默检查
- 用户自带 API Key
- OpenAI-compatible endpoint
- 第三方插件运行时
- 本地插件目录 / 插件市场

## 7. 当前非目标

v0.1 不做：

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

## 8. 决策边界

后续实现时可以自动决定：

- FeatureRegistry、CommandRegistry、KeymapRegistry 的具体代码组织。
- 内置功能如何拆分 feature 包。
- v0.1 中 MDX raw 保真的内部节点模型。
- Source Mode 切换失败时的保护实现。
- Markdown round-trip fixtures 的初始覆盖集合。

## 9. Callout 编辑层级

### Level 1：Raw 保真

WYSIWYG 中把 `Callout` 当作 raw MDX block 显示，主要通过 Source Mode 编辑。目标是保证源码不丢失、不被错误改写。

这是 v0.1 的最低要求，和所有未知 MDX / JSX 的保真策略一致。

### Level 2：卡片化展示 + 源码编辑

WYSIWYG 中把 `Callout` 渲染为组件卡片，用户能看出它是官方组件；点击编辑时仍然编辑 raw MDX 源码。

这是 v0.2 的官方 MDX 组件最小切片目标，用于验证 registry、parser、serializer、node view、插入命令和 fallback 策略。

### Level 3：结构化表单编辑

WYSIWYG 中把 `Callout` 的 props 和 children 拆成可视化控件，例如 `type` 下拉选择、`title` 输入框、内容区 Markdown 编辑。

该能力后置，不进入 v0.1 / v0.2 的必做范围。等 MDX 组件体系稳定后再实现。
