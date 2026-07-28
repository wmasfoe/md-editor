# WYSIWYG selection integrity spec

> 状态：CodeMirror 6 当前契约。M1/S2、M1-FM 与 M2/S3 已验证；M2/S3 当前 renderer 184/184、完整 Chromium 45/45 与 2026-07-24 post-fix Tauri/WebKit N13 均已通过。

## 用途

记录 WYSIWYG 投影层的选区、原子节点、输入法和模式切换契约。修改 Markdown range index、投影 StateField、Decoration、Widget、atomic range、受保护范围或结构化命令前，先读本规范。

## 核心不变量

1. 一个打开文档只能拥有一个 CodeMirror 6 `EditorView` 和一个当前 `EditorState`。
2. `source` / `wysiwyg` 只重配同一编辑器实例；history、selection、multi-range 方向和 scroll 不得由另一套编辑器接管。
3. Markdown 文本是唯一持久化事实。Decoration 和 Widget 只投影视觉与交互，不建立第二份文档模型。
4. 所有选区都使用 CM6 文档 offset。不得用 DOM selection、隐藏 textarea、嵌套编辑器或 Widget 内部焦点模拟编辑器选区。
5. parser 无法可靠分类的语法必须降级显示原始 Markdown，不得吞字、猜测补全或阻断正常源码编辑。

## 必须保持的行为

### 跨块与剪贴板

1. 正向或反向拖选可以跨段落、标题、引用、列表、任务列表、链接、图片、分割线、默认可视化 atom 和 Frontmatter。
2. 跨块选区复制、剪切、替换时，操作对象是底层 Markdown 源码，而不是 Widget DOM 文本。
3. 包含受保护 atom 的宽选区可以整体删除或替换；仅命中受保护 atom 内部或恰好等于默认 atom 的局部修改必须拒绝，并保持原 selection/history。
4. 普通 paste 在可编辑位置走单次 CM6 transaction；粘贴目标位于受保护 atom 内部时遵循同一拒绝规则。

### 图片

1. 图片非活动时显示 Widget；活动行、光标进入源码范围或精确选中时，完整 `![alt](src "title")` 源码与图片预览同时可见。
2. 鼠标点击图片或失败占位会选中图片完整源码范围，并把焦点留在 `.cm-content`。
3. `ArrowLeft` / `ArrowRight` 从相邻位置进入图片时，必须在图片源码内部放置真实折叠光标并显示实时预览。
4. `ArrowUp` / `ArrowDown` 跨到图片行时必须采用同一源码揭示语义，保留 goal column；光标不得消失。
5. 图片源码编辑后，preview resolver 使用新值实时更新；加载失败只切换为简约占位，不改变源码、选区或历史。
6. 图片被精确选中时，`Backspace` / `Delete` 只删除该图片源码；`Escape` 或继续移动退出显式 atom 选中，退出操作不进入 history。

### 分割线与默认 atom

1. `---`、`***`、`___` 始终渲染为可辨识分割线，并保留稳定点击热区。
2. 鼠标点击、水平键盘移动或垂直键盘移动进入分割线时，必须选中其完整源码范围并显示选择反馈。
3. 精确选中的分割线由 `Backspace` / `Delete` 整块删除，一次 undo 必须完整恢复。
4. 未提供专用编辑交互的 CommonMark/GFM 语法作为默认 atom 自动可视化。WYSIWYG 中允许选择和跨越，不允许精确修改或整块删除；编辑必须切到全局源码模式。
5. 多选区 atom 操作必须全有或全无：所有 range 都兼容才派发一次 transaction，任何一个 range 不兼容则不产生部分修改。

### 结构化编辑、IME 与模式

1. 引用、无序/有序/任务列表的标记可以隐藏，但实际隐藏的 replacement ranges 必须同时进入 atomic/protected ranges；普通 typing/paste 不得从保留在隐藏 marker 内部的 offset 修改源码。
2. Enter、Tab、Shift-Tab、Backspace 和任务切换必须由结构化命令基于源码范围执行，并且只有这些 renderer-owned transaction 可以获得 marker 修改授权。
3. composition 期间禁止 atom 移动、atom 删除和列表结构化命令抢占输入法；composition guard 随文档 change mapping，结束后再恢复投影。
4. 模式切换、React rerender、图片 preview 更新和行号切换不得替换 `EditorView`，也不得改变文档、history、selection ranges、range 方向或 scroll。
5. source 模式关闭所有 WYSIWYG Decoration、Widget、atomic range 和 protected range，但保留同一 CM6 状态栈；在 source 中产生的编辑可在切回 WYSIWYG 后 undo/redo。
6. 两种模式都必须启用自动换行；长行不得让编辑区产生水平滚动条。

### 代码块

1. fenced/indented code body 必须继续在主 `EditorState.doc` 中编辑；toolbar、语言菜单和行号不得创建嵌套编辑器或第二份 selection/history。
2. 只有完整 closed block 进入投影；unclosed、malformed 或 partial block 必须 fail open 为完整可编辑源码。
3. WYSIWYG 隐藏的 fence、info string 和 indented structural prefixes 必须同时进入 atomic/protected ranges；普通 typing、paste、cut 和 selection delete 不得静默修改这些范围。
4. 零长度 fenced body 必须保留一行可见原生 CM6 geometry。直接键入、pointer 进入或 Enter 必须在 closing fence 前 materialize 所需 LF，并与首次输入形成一个主 history 事务。
5. WYSIWYG Backspace/Delete 不得删除隐藏 fence；source 模式删除单个 fence 字符后必须立即清除代码块投影并显示 raw source，下方普通文本不得遗留代码缩进样式。
6. 代码块的多选区、跨块拖选、IME、undo/redo 和 mode switch 必须继续使用同一 selection/history/scroll owner。

## 实现边界

- parser 与 range index：`packages/renderer-codemirror/src/markdown/range-index.ts`
  - 负责从 CM6 Markdown syntax tree 建立稳定 `MarkdownRangeRecord`。
  - document change 时重建受影响解析覆盖；仅 selection change 时不得重跑全文解析。
- 投影状态：`packages/renderer-codemirror/src/wysiwyg/projection-state.ts`
  - `wysiwygProjectionField` 唯一持有 active syntax ids、selected atom ids、composition guards、protected ranges、layout decorations 和 atomic ranges。
  - source 模式投影集合必须为空。
- 原子选择与删除：`packages/renderer-codemirror/src/wysiwyg/atom-selection.ts`
  - 图片键盘进入揭示源码；分割线和默认 atom 使用精确 CM6 range 选择。
  - 图片、分割线可精确删除；默认 atom 不走专用删除。
- 修改保护：`packages/renderer-codemirror/src/wysiwyg/change-protection.ts`
  - transaction filter 拦截 WYSIWYG 内默认 atom、Frontmatter fence 和隐藏 block marker 的局部修改。
  - undo/redo、授权的外部编辑、source 模式编辑和覆盖完整 atom 的宽选区操作必须放行。
- 结构化授权：`packages/renderer-codemirror/src/wysiwyg/change-authorization.ts`
  - renderer 自有 transaction 使用显式 annotation；上游 Markdown 命令只在同步 `state.update` 调用栈内获得 state-scoped 授权。
  - 授权不得延续到后续普通 typing、paste 或其他编辑器实例。
- 结构化命令：`packages/renderer-codemirror/src/wysiwyg/markdown-commands.ts`
  - 列表、任务和 atom 命令统一使用 CM6 transaction，并在多选区下保持全有或全无。
- 代码块投影与命令：
  - `packages/renderer-codemirror/src/wysiwyg/code-block-projection.ts` 负责 closed block 投影、结构范围和零长度 body geometry。
  - `packages/renderer-codemirror/src/wysiwyg/code-block-commands.ts` 负责 body editing、首次 materialization、语言/copy/selection 和边界删除语义。
- Widget：`packages/renderer-codemirror/src/wysiwyg/widgets/`
  - Widget 只渲染和转发 atom 选择，不直接修改 Markdown，不获得独立可编辑焦点。

## 增量更新边界

1. `docChanged`、解析版本变化、mode 变化、atom effect 或 composition effect 触发投影重编译。
2. 纯 selection transaction 只计算旧/新 selection span 并集涉及的 record ids，增量替换这些 record 的 layout Decoration 和 atomic ranges。
3. 行内样式只为 `visibleRanges` 构建 paint-only marks，避免为不可见全文创建装饰。
4. Widget `updateDOM` 应复用现有 DOM；图片 load/error 只更新自身视觉状态，不派发文档 transaction。
5. mode、selection-only、scroll 和 projection refresh transaction 不进入 history。

## 解析错误降级

- 不完整链接、图片或其他无法形成可靠 range record 的语法保持原始文本可见、可选、可编辑。
- 同一文档内修复语法后，range index 和投影应恢复，无需替换 EditorState。
- Frontmatter 仅识别文档顶部精确围栏；非法 YAML 显示错误态但正文仍在主 `.cm-content` 中编辑。
- HTML 与 MDX 不属于本阶段，不得因 Frontmatter spike 顺带引入专用渲染或交互。

## 回归测试入口

- `packages/renderer-codemirror/src/wysiwyg/atom-selection.test.ts`
  - 跨块删除让出控制、多选区原子操作、图片水平/垂直键盘揭示、三种分割线垂直选择、Escape、composition bypass。
- `packages/renderer-codemirror/src/wysiwyg/projection-state.test.ts`
  - selection delta、multi-range、composition guard mapping、protected range、source-mode undo/redo、可见范围 marks。
- `packages/renderer-codemirror/src/wysiwyg/markdown-commands.test.ts`
  - 列表/任务结构化命令、多光标全有或全无、composition bypass。
- `packages/renderer-codemirror/src/renderer.test.ts`
  - 单 view/state、mode reconfigure、multi-range 方向、IME、history、scroll 和外部编辑边界。
- `packages/renderer-codemirror/src/wysiwyg/code-block-commands.test.ts`
  - fenced/indented 命令、零长度 body 首次 materialization、结构边界保护、多选区、IME 和 history。
- `apps/desktop/e2e/codemirror-m1-s2-wysiwyg.spec.ts`
  - 图片、失败占位、分割线、自动换行、剪贴板、跨块拖选、默认 atom、模式切换和解析错误降级。
- `apps/desktop/e2e/codemirror-m1-frontmatter.spec.ts`
  - 单一编辑器内 Frontmatter 投影、YAML 编辑/history、错误态和模式切换。
- `apps/desktop/e2e/codemirror-m2-code-block-editing.spec.ts`
  - toolbar、键盘编辑、跨块源码拖选、composition、零长度 fenced body 首次输入和 malformed fence 降级。

## 原生验收记录

2026-07-20，用户确认 N01-N10 全部通过，包括系统中文 IME、跨块拖选、键盘 atom/list/task、系统剪贴板、本地与失败图片、mode/scroll/ranges/history、Frontmatter、保存和明暗主题。

N09 报告保存路径为 `/private/tmp/md-editor-m1-native/saved.md`，收尾检查时该文件未被独立观测；因此 N09 记录为“用户覆盖通过”，不宣称有机器复验产物。

2026-07-24，M2/S3 post-fix N13 在真实 macOS Tauri/WebKit 通过，覆盖空 fenced body 直接键入、pointer/Enter materialization、单步 undo/redo、隐藏 fence Backspace 保护、源码模式单 backtick fail-open 与下方段落无缩进。可重放证据位于 `/private/tmp/md-editor-m2-s3-code-blocks/20260723T194530Z-n13`，保存结果为 66 bytes、LF-only。

## 后续范围

- S3 代码块实现、自动化和 post-fix Tauri/WebKit N13 均已完成，M2/S3 标记为已验证。
- S4 GFM 表格与 S5 的 HTML/MDX 技术验证仍未开始。
- Frontmatter 是 M1 独立子故事，本阶段只执行 S5 Frontmatter-only spike；不得把 HTML/MDX 映射进 M1 完成状态。
