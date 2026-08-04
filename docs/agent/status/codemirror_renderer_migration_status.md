# CodeMirror 6 渲染器迁移状态

> 用途：记录 CM6 单编辑器迁移的真实代码进度、beta 可用性、缺口、降级和验证证据。
>
> 最后更新：2026-08-04（M4 HTML 安全投影边界与 G004 Markra P0 输入路径优化已落地；MDX 解析/Widget 尚未开始。G004 多轮独立审查后修复 typedBoundary 状态保存/失焦清理、composition guard 快速路径、visible-marks compositionend 刷新，以及 viewport/mode/聚合事务 fail-closed 与 Unicode variation-selector 边界。新鲜验证：全仓 typecheck、workspace 569 tests + release 5 tests、build 通过，G004/M3/M4 Chromium 15/15 通过；Oxlint/Prettier/`git diff --check` 通过。Linux ARM64 Rust tests 32/32 通过；Clippy 仍有 6 个既有 Linux cfg unused warning。）

## 当前结论

- **阶段：S1/M0 beta 可用，M1/S2、M1-FM/S5-FM-only、M2/S3 已验证，M3 表格可视化已完成（始终显示可编辑网格 + 单元格就地编辑 + 增删行列 + 整表原子选中/删除，不再回显源码）。desktop production graph 只保留单一 CM6 产品表面、语义 controller、ordered save 与 main/settings 平台隔离；代码块继续复用同一 EditorView/EditorState/history/selection/scroll。M4、M5、M6 仍未完成，因此不能宣称完整迁移。**
- `App.tsx` 对活动 Markdown 文档只挂载一个持久 `DesktopCodeMirrorEditor`。source/WYSIWYG 复用同一 `EditorView`，编辑区通过源码等宽/所见即所得正文排版区分；右下角继续使用原有单图标透明模式按钮。资源预览只隐藏/inert 该 host，不卸载 renderer。
- 旧 `DesktopMilkdownEditor`、`DesktopSourceEditor`、Milkdown / ProseMirror / `@uiw/react-codemirror` 源码、exports、Vite aliases、manifest 依赖和 lockfile entries 已删除；production bundle 扫描也不再包含旧引擎或测试 composition setter。
- `@md-editor/renderer-codemirror` 已使用原生 CM6 `EditorView` factory、root/mode/line-number compartments、typed transaction origin、external-edit isolated history、generation boundary `setState`、显式 reconcile、composition queue 和 host visibility 恢复；生产 API 不暴露可变 view/state。
- `@md-editor/editor-core` 已实现 LF 不可变快照、generation/revision、有序 transition/snapshot 订阅、外部编辑 reservation/finalize、文档边界、path/mode CAS、save checkpoint、commit-certainty settlement 和 verification barrier。
- `@md-editor/file-system` 已实现显式构造的 `RuntimeFileService`、同步 checkpoint 入队校验、epoch runtime sequence 和完整 native job FIFO；throw、timeout 与非法 payload 都分类为 `indeterminate`。
- Tauri 已注册进程级 `SaveCommitGate`、main-WebView-only attach/ordered save、`spawn_blocking` wrapper、temp write + `sync_all` + atomic rename commit boundary、post-commit warning、reattach/poison recovery 和 retired/non-monotonic rejection。
- Desktop 新建/打开/空文件夹/删除走 atomic `replaceDocument`，rename/move 走 `setDocumentPath`；程序化同文档修改走 renderer external-edit port，mode 走 typed mode port，不再由 controller 调用旧 snapshot-only 文档兼容方法。
- `main.tsx` 在 React 前分流 window surface：main 严格执行 attach -> FileService factory -> render，settings 只加载 `SettingsWindowApp`；一个 main-only `RuntimeFileService` 被注入 App、controllers 与 file tree。unknown/attach failure 均 fail closed。
- 保存 controller 在第一个 `await` 前同步 `beginSave` + enqueue，typed outcome 只 settle 一次；成功采用实际返回 path，warning/failed/cancel/indeterminate 分别反馈，verification-required 继续阻止无提示放弃。
- 当前是 **CM6-only beta 可用**：S1/M0、M1 与 M2 已通过对应自动化和原生门禁。格式化命令 silent no-op、deferred paste/drop 全局监听、旧 engine runtime 和 snapshot-only 文档 mutation 旁路均已移除。该结论不代表 M3-M6 已完成。
- G004（复刻 Markra 渲染层机制 P0 三项，2026-08-04 完成）：① projection 快速路径要求纯 Unicode 字母/组合标记/数字插入且光标前后均在纯文本段落；visible-marks 快速路径另要求光标不在 inline marker、mode 不变、仅一个 docChanged transaction，且新 visibleRanges 与旧 ranges 经 changes 映射后精确一致，否则 fail closed；Variation Selector/emoji/ZWJ/结构字符均回退；② composition guard 存在时仍只 map 并同步映射 guard ranges，compositionend 同时刷新 projection 与 visible-marks；③ typedBoundary 由输入事务推导，快速路径/全量刷新保持状态一致，selection、非输入变更与 blur 清空，link/image 闭合 `)` 右缘保持 reveal。renderer 25 files / 302 tests（15 个 G004 测试）、workspace 569 tests + release 5 tests、E2E G004/M3/M4 15/15 通过；第四轮审查后快速路径要求 record ID 集合稳定，结构记录前的插入回退增量重建，消除 decoration identity 失同步；P1-4 visibleRanges 限定全量重建转后续 PRD。
- M1/S2 核心投影已在同一 `EditorView` / `EditorState` 上实现 inline marker、活动标题、引用/列表/任务项、链接、图片、分割线和默认可视化；M1-FM/S5-FM-only 又实现了 `.cm-content` 内的 Frontmatter 面板。G011 进一步完成活动图片源码与实时预览并存、成功/失败图片的键盘进入、分割线纵向键盘选择、源码/WYSIWYG 自动换行、失败占位、可读列布局和 Frontmatter 视觉层级；G012 补齐隐藏 block marker 的修改保护。renderer 126/126、完整 Chromium 32/32 与 macOS Tauri/WebKit N01-N10 已通过，M1/S2 与 M1-FM 标记为已验证；N09 的通过来自用户明确验收覆盖，报告的保存产物未被独立观测。
- M2/S3 在相同状态栈上实现 fenced/indented code range model、curated native mixed-language loading、WYSIWYG projection、语言菜单、block-local 行号、body-only copy 和 renderer-owned 编辑命令。当前工作树重新验证 renderer 18 files / 184 tests、editor-ui 5 files / 20 tests、desktop 27 files / 103 tests 与完整 Chromium 45/45。真实 Tauri/WebKit N01-N12 于 2026-07-23 在修复前快照通过；2026-07-24 的独立 N13 又验证零长度 fenced body 首次输入、pointer/Enter、undo/redo、WYSIWYG Backspace 保护和单 backtick 删除降级，M2/S3 因此标记为已验证。
- Playwright E2E 现在运行真实 desktop `App` 与 E2E-only 内存平台 adapter；产品 bridge 只暴露只读诊断/受控命令并且不进入 production bundle。独立 React bridge harness 保留为窄层 lifecycle 验证。
- 迁移开始后只维护 CM6 编辑器路径，不增加 Milkdown / CM6 功能开关或双向同步层。

代码证据：

- [`App.tsx`](../../../apps/desktop/src/app/App.tsx) 只挂载持久 [`DesktopCodeMirrorEditor.tsx`](../../../apps/desktop/src/components/DesktopCodeMirrorEditor.tsx)，preview 为 sibling overlay。
- [`main.tsx`](../../../apps/desktop/src/main.tsx) 与 [`platform-bootstrap.ts`](../../../apps/desktop/src/app/platform-bootstrap.ts) 实现 React 前的 main/settings 分流和 required service 注入。
- [`document-save.ts`](../../../apps/desktop/src/app/controller/document-save.ts) 实现 checkpoint 同步入队、单次 settlement、certainty feedback 与 discard protection。
- [`editor-ui/package.json`](../../../packages/editor-ui/package.json)、desktop/root manifests、workspace catalog 与 lockfile 已移除 Milkdown、ProseMirror 和 `@uiw/react-codemirror` 依赖。
- [`editor-ui/src/index.ts`](../../../packages/editor-ui/src/index.ts) 只导出 `CodeMirrorEditor` 产品表面；旧 Milkdown/SourceEditor 目录、desktop wrappers 和专用工具均已删除。
- [`renderer.ts`](../../../packages/renderer-codemirror/src/renderer.ts) 是 G004 的原生 CM6 lifecycle/sync 实现；只有 generation boundary 调用 `setState`。
- [`range-index.ts`](../../../packages/renderer-codemirror/src/markdown/range-index.ts) 与 [`range-types.ts`](../../../packages/renderer-codemirror/src/markdown/range-types.ts) 持有 fenced/indented 精确 ranges、block status、source fingerprint 与增量 mapping。
- [`code-languages.ts`](../../../packages/renderer-codemirror/src/markdown/code-languages.ts) 持有 20 个 direct `LanguageDescription` loader、exact alias resolver、native `codeLanguages` 接入和 theme-backed token highlighting。
- [`code-block-projection.ts`](../../../packages/renderer-codemirror/src/wysiwyg/code-block-projection.ts)、[`code-block-line-numbers.ts`](../../../packages/renderer-codemirror/src/wysiwyg/code-block-line-numbers.ts) 与 [`code-block-commands.ts`](../../../packages/renderer-codemirror/src/wysiwyg/code-block-commands.ts) 分别拥有 projection/ranges、logical line geometry 和编辑语义。
- [`renderer.test.ts`](../../../packages/renderer-codemirror/src/renderer.test.ts) 以 state-backed CM6 view 覆盖 R1-R18，不依赖 React、desktop 或 DOM 模拟库。
- [`testing.ts`](../../../packages/renderer-codemirror/src/testing.ts) 提供只读 probe 和用户 transaction 模拟，不把可变 `EditorView` / `EditorState` 暴露给消费方。
- [`CodeMirrorEditor`](../../../packages/editor-ui/src/components/CodeMirrorEditor/) 是 G005 的 stable React/renderer bridge；transition 与 snapshot 订阅分离，外部编辑和模式切换只通过 typed ports。
- [`codemirror-editor-bridge.spec.ts`](../../../apps/desktop/e2e/codemirror-editor-bridge.spec.ts) 在专用 E2E surface 上验证真实 DOM `EditorView` 身份、StrictMode、preview、外部编辑和文档边界。
- [`s1-capability-inventory.ts`](../../../apps/desktop/src/app/s1-capability-inventory.ts) 精确覆盖当前 runtime 的 12 个注册命令，并为 12 个已移除格式命令及非命令能力保留 S1 审计记录。
- [`codemirror-s1-single-view.spec.ts`](../../../apps/desktop/e2e/codemirror-s1-single-view.spec.ts) 验证真实产品 E1-E11，并补充空文件夹 D3、main reload P5、settings reload 隔离和 deferred controls 的可见 typed-unsupported 反馈。
- [`document-state.ts`](../../../packages/editor-core/src/document-state.ts) 是 G002 的 headless 文档协议实现，不依赖 React、CM6、desktop 或 Tauri。
- [`document-protocol.test.ts`](../../../packages/editor-core/tests/document-protocol.test.ts) 覆盖 C1-C19，包括 notification 顺序、reservation 单次 token、mode rollback、save promotion 和 verification barrier。
- [`save-scheduler.ts`](../../../packages/file-system/src/save-scheduler.ts) 实现 runtime FIFO、双序列边界和 native outcome classification。
- [`save_runtime.rs`](../../../apps/desktop/src-tauri/src/save_runtime.rs) 实现进程级 epoch gate、poison recovery、reattach 和 typed native result。
- [`file_commands.rs`](../../../apps/desktop/src-tauri/src/file_commands.rs) 把 caller authorization、`spawn_blocking`、dialog、sync/rename 和 post-commit warning 接到 Tauri command。

## Spike 状态

| Spike | 状态 | 当前证据 / 缺口 |
| --- | --- | --- |
| S1 单实例与数据同步 | beta 可用 | CM6-only 代码切换、E1-E12、G008 全仓自动化、移除扫描、独立复核及系统 IME/原生 dialog 人工验收均已通过 |
| S2 核心显隐与选择 | 已验证 | parser/range index、StateField、Decoration/Widget/atomic/protected ranges、自动换行与增量更新已实现；renderer 126/126、完整 Chromium 32/32 和原生 N01-N10 已通过 |
| S3 代码块 | 已验证 | fenced/indented projection、native mixed highlighting、语言菜单、block-local 行号、copy/keyboard/IME/history、fail-open 与固定大文件增量预算已通过自动化；post-fix 原生 N13 已在 Tauri/WebKit 通过 |
| S4 可视化 GFM 表格 | 已验证（M3 可编辑可视化表格，S4 引擎评估触发 No-Go 后以"始终网格 + 就地编辑"落地，不引入嵌套编辑器） | `MarkdownTableBlockMetadata` 已收集 header/delimiter/body row ranges、对齐、column count、has-leading-pipes 与 per-line fingerprint；`table` kind 恒走 `TableGridWidget` 网格（始终显示，不再回显源码）；单元格 contenteditable 左键单击即就地编辑、Enter 下移/Tab 右移/Shift-Tab 左移导航、Escape 取消，编辑经受保护 transaction 回写 GFM 源码（`serializeTableRow` 负责 `\|` 转义）；行/列操作采用 Notion 式固定块手柄（⋮⋮ 贴每行首列左缘/每列表头右缘，悬停表格显隐），点击弹出操作菜单：行=在上方插入/在下方插入/删除本行，列=在左侧插入/在右侧插入/删除本列（删除项恒提供，列数>1 下限由 `deleteTableColumn` 兜底）+ **对齐分组（无对齐/左/中/右，当前项带 ✓ 勾选，`setTableColumnAlignment` 只重写 delimiter 行对应列的 `---`/`:---`/`:---:`/`---:` 标记）**；菜单随表格外点击/菜单项执行/销毁自动关闭并释放 document 级监听；整表选中态显示操作提示 tooltip（Delete 删除 · Tab 编辑 · Cmd+C 复制，`aria-selected` 伪元素纯 CSS）；表格末尾（最后一行 body）Enter 先提交当前单元格再退出表格、在下方新增段落续写正文（已有空行时仅移动光标，受保护 transaction 注入）；点击表格空白原子选中整表、Backspace/Delete 整表删除、undo 可恢复，整表原子选中态打字/粘贴等价于替换整表（宽选区放行条件允许恰好相等选区 `from <= from && to >= to`）；ArrowUp/ArrowDown 从表格上方/下方视觉移动会对称地整表选中（`verticalMoveHitsAtom` 覆盖跳过整块 widget 的情况）；整表选中态下 Tab/Enter 进入最近编辑单元格（记忆 `lastEditingCellByRecordId`，无记忆时聚焦首个表头单元格）；单元格内 Cmd+A 先提交当前编辑再整表原子选中（焦点回 CM6 后再次 Cmd+A 由默认 selectAll 扩展到全文）；整表恒 atomic + protected；修复 Tailwind preflight 清零 widget 边框（CSS `!important`）与 range-index 删末行丢表（oldDirty→newDirty 映射 + ensureSyntaxTree）；12 个 table-projection 测试 + 10 个 table-editing 测试（含 3 个退出表格续写段落、2 个对齐切换）+ 4 个表格原子选择测试 + 9 个表格 widget DOM 生命周期测试（含菜单开关/项执行/对齐切换/文档级监听释放）+ 2 个整表进入单元格测试 + 2 个单元格内全选测试通过；多单元格拖选、列宽调整、tab 跳格仍留待后续 |
| S5-FM Frontmatter-only | 已验证 | 精确 top-matter range、YAML panel/highlight/error、主 history、无嵌套 editor 与原生 N08 已通过 |
| S5 HTML / MDX | 进行中（HTML 已落地，MDX 未开始） | HTML 已实现严格白名单清洗、双层 DOM 重建、块级 Widget、原子选择/删除/undo 与错误占位；MDX parser、registry 求值和组件 Widget 仍不可用 |
| S6 性能基线 | 未开始 | 删除旧引擎前未固化同环境量化结果；必须建立 CM6 fixture/门槛，并把历史对照缺口显式保留 |

## 里程碑状态

| 里程碑 | 状态 | Beta / 完成判断 |
| --- | --- | --- |
| M0 CM6 单编辑器主链路 | beta 可用 | CM6-only 主链路、旧引擎删除、E1-E12、G008 自动化质量门禁、独立复核与必需原生人工证据均已通过 |
| M1 core 基础 Markdown | 已验证 | S2 核心行为、G011 图片/分割线键盘与视觉修正、G012 隐藏 marker 保护均已实现；renderer 126/126、完整 Chromium 32/32 与原生 N01-N10 通过 |
| M1-FM Frontmatter 子故事 | 已验证 | 面板、错误降级、范围编辑、source mode、undo、源码复制与原生 N08 已通过 |
| M2 代码块 | 已验证 | renderer 184/184、editor-ui 20/20、desktop 103/103、完整 Chromium 45/45 与 2026-07-24 原生 N13 均通过 |
| M3 GFM 表格 | 已验证 | renderer 21 files / 243 tests（含 M3-A 元数据基座 + 表格投影 12 + 表格编辑 10 + 表格原子选择 4 + 表格 widget DOM 生命周期 9 + 整表进入单元格 2 + 单元格内全选 2）、typecheck/lint/build 全绿；Chromium 浏览器套件 52/52 全绿（2026-08-03，B6 末尾 Enter 续写修复后）；表格恒显示为可编辑网格（contenteditable 单元格左键即编辑 + 受保护 transaction 回写 GFM 源码 + Notion 式行/列块手柄与操作菜单增删行列及列对齐切换 + 整表原子选中/删除与选中态等价替换 + 选中态操作提示 + Arrow 对称整表选中 + Tab/Enter 进入单元格 + 末尾 Enter 退出表格续写段落 + 单元格内 Cmd+A 渐进式全选），不再回显源码；多单元格拖选、列宽调整、tab 跳格留待后续 |
| M4 基础 HTML / 官方 MDX | 进行中 | 基础 HTML 安全投影已落地并通过 M4-E01~E04；官方 MDX 解析、白名单 registry 求值和组件 Widget 尚未开始，不能标记完成 |
| M5 现有能力迁移 | 未开始 | 不可用 |
| M6 稳定发布收口 | 未开始 | 不得宣称迁移完成 |

## 已有可迁移能力

- `editor-core` 已有文档状态、命令、快捷键、feature 和文件生命周期边界。
- `markdown-fidelity` 已有 Frontmatter、raw fragment、图片路径和换行相关保真测试。
- `mdx-component-registry` 已有 metadata registry；`mdx-plugins` 已有官方 `Callout`、component map、metadata 子出口和组件测试。
- 已删除的 Milkdown 表面曾提供官方 MDX 插入菜单、`Mod-Shift-M` 快捷键和 snippet 插入链路；这些事实只保留在历史文档/Git 中，当前代码没有可复用旧运行时。
- 已删除的 Milkdown Callout 轻量预览曾有 ProseMirror `NodeSelection`、选中描边和两步整块删除，但不是 CM6 renderer 的原子交互或 Widget 生命周期证据。
- 搜索、大纲、图片粘贴、AI suggestion 及后续表格/HTML/MDX 的完整 parity 仍需在 CM6 上重建对应测试；不能引用不可达旧表面宣称已迁移。

这些能力只是迁移输入，不能作为 CM6 spike 或里程碑完成证据。

## S1 基线与能力处置清单

`apps/desktop/src/app/s1-capability-inventory.ts` 是 G001 的可执行清单。测试直接读取当前 `runtime.commands.list()`，要求所有注册命令都被覆盖，新增命令若未登记会失败。`baseline` 记录当前事实，`s1Disposition` 只允许 `retained`、`removed-disabled` 或 `typed-unsupported`。

| 当前能力 / 命令 | 当前事实 | S1 处置 |
| --- | --- | --- |
| `file.new/open/openRecent/openFolder/save/saveAs` | desktop shell 已实现 | retained |
| `settings.open`、`view.toggleSidebarPrimary` | desktop shell 已实现 | retained |
| `view.toggleSource`、`view.showWysiwyg` | 当前 reconfigure 同一 CM6 view | retained；history/selection/scroll 自动化已通过 |
| `mdx.openComponentMenu` | 当前显式 immutable unsupported slot 返回 typed unsupported 并显示 toast | typed-unsupported；E11 已验证可见反馈 |
| `ai.continueWriting` | 当前显式 immutable unsupported slot 返回 typed unsupported 并显示 toast | typed-unsupported；E11 已验证可见反馈 |
| `format.bold/italic/code/strikethrough/link` | 基线只打印日志；当前已从 runtime registry 移除 | removed-disabled；保留历史 audit entry |
| `format.codeBlock/blockquote/bulletList/orderedList/heading1/heading2/heading3` | 基线只打印日志；当前已从 runtime registry 移除 | removed-disabled；保留历史 audit entry |
| Markdown input、undo/redo、模式状态保持 | 当前由单一 raw CM6 产品表面承担 | retained；history/selection/focus/scroll 自动化已通过 |
| line number、font size | 当前走 CM6 compartment 与 host style | retained；不替换 view/state epoch |
| asset preview | 当前为 sibling overlay，editor hidden/inert | retained；产品 E9 已验证不卸载 renderer |
| image/paste/drop、link open、search/outline、full editor theme parity | 当前未达到 CM6 parity；旧 editor 已删除 | removed-disabled 或 retained API typed unsupported，并作为 beta gap 记录 |

这张表的 retained 主链路、格式化 no-op 移除和 paste/drop 停用已由 G006 实施；G007 又完成旧 engine/module/dependency、legacy save API 和测试 setter 的物理删除。E11/E12、G008 全仓自动化、移除扫描、独立复核和 2026-07-18 原生人工验收均已通过，因此 S1/M0 标记为 beta 可用。

## Beta 规则

- S1 和 M0 的最小打开、编辑、保存、history、selection、scroll 与 LF 验证通过后，才可以发布 CM6 功能体验 beta。
- Beta 可以暂缺 M1-M5 能力，但发布说明必须列出缺失功能、用户可见降级、安全降级和未运行验证。
- Beta 可用不等于迁移完成；M6 只有在完整功能矩阵和发布门槛通过后才能标记完成。
- 需要回退时使用 Git 分支或历史版本，不在产品代码中恢复第二套编辑器。

## 当前 Beta 已知缺口

- M3 / S4：表格恒显示为可编辑网格并支持单元格左键就地编辑、Notion 式行/列块手柄与操作菜单增删行列及列对齐切换、末尾 Enter 退出表格续写段落、整表原子选中/删除与选中态等价替换及操作提示、Arrow 对称整表选中；多单元格拖选、列宽调整、tab 跳格仍留待后续（S4 评估无成熟引擎，按 No-Go 裁剪为自研 contenteditable 单元格 + 源码回写，不引入嵌套编辑器）。
- M4 / S5：基础 HTML 白名单渲染、原子选择、整块删除、undo 与错误占位已实现；官方 MDX 真实解析/渲染尚未实现，MDX 入口仍可见地报告 typed unsupported。
- M5：AI suggestion、图片粘贴/拖放、链接打开、搜索 parity、完整大纲/主题/可访问性仍未迁移；AI 入口当前可见地报告 typed unsupported。
- S6：没有删除前的同环境量化基线；CM6 大文件、输入延迟、滚动、内存和 Widget 生命周期数据仍待建立。
- S1/M0 原生人工门禁已通过；环境、覆盖范围和结论见文末“原生人工验收通过记录”。后续里程碑引入 decoration、Widget、表格或 MDX 后，仍须针对新增交互重新执行对应原生验收。
- G008：全仓 typecheck/test/lint/build/Rust/browser/Tauri 启动冒烟、post-cleaner 重验和初轮复核修复后的全量重验已通过；独立复跑结果为 code-reviewer `APPROVE`、architect `CLEAR`。

## M1-FM / S5-FM-only 自动化实现记录

- `markdown-fidelity` 只识别 offset 0 的 closed/unterminated Frontmatter 并返回精确 opening/content/closing/raw 范围；它不依赖 YAML parser，也不承担渲染或诊断。
- `renderer-codemirror` 直接依赖 `@lezer/yaml`。`frontmatter-yaml.ts` 产生不可变 token/diagnostic ranges，并对 EOF/空白解析错误做可见范围钳制与去重。
- `frontmatter-projection.ts` 只消费 range-index 中的 `frontmatter` record：opening fence 替换为 `Frontmatter` header Widget，closing fence 隐藏，YAML body 仍是同一 `.cm-content` 中的原始可编辑文本；fence ranges 同时进入 atomic/protected ranges。
- panel 没有 `input`、`textarea`、嵌套 `.cm-editor` 或第二套 history/selection/IME 状态。YAML body 输入是普通 CM6 transaction，undo/redo 与 source mode 继续使用主 `EditorState`。
- invalid YAML 显示 `YAML error` 并保留可编辑原文；unterminated top matter 显示 `Unterminated`，不降级成 HR/Setext。后置 `---`、相邻 HTML 和 MDX 不进入 Frontmatter 路径。
- 新鲜自动化：renderer 14 files / 112 tests 通过；聚焦 Chromium `codemirror-m1-frontmatter.spec.ts` 3/3 通过，覆盖单一 editor、DOM 结构、高亮、原位编辑、composition、undo、完整源码复制、mode、invalid/unterminated、稳定 view identity 与 selection-independent panel 更新。
- 范围声明：上述证据与原生 N08 完成 M1-FM 与 S5 的 Frontmatter-only 验证，不完成整个 S5；HTML/MDX 仍为 raw/deferred，且没有新增 parser、sanitizer 或运行时。

## G009 Chromium/Product 与原生验收记录

- 新增 `codemirror-m1-s2-wysiwyg.spec.ts` 的真实产品矩阵；完整 Chromium 27/27 通过。覆盖单一 `.cm-editor`、inline/heading/block projection、任务项 pointer/Space/Enter/Tab/Shift+Tab/Backspace、双链接多选激活、图片与分割线原子选择/复制/删除/undo、跨图片/分割线/default atom/Frontmatter 的正反拖选与剪贴板、双向多选区、mode/rerender/preview/scroll/history 保持、parse repair、可访问性和全部 S1 回归。
- renderer probe 新增不可变 `selectionRanges`；生产 root 显式启用 `EditorState.allowMultipleSelections`。R11a 验证三个正反混合选区经过 50 次模式切换后保留 range count、anchor/head 方向、history、scroll 和 view/state identity。
- 新鲜自动门禁：workspace 11 个 TypeScript 项目通过；Vitest 50 files / 278 tests 与 release 5/5 通过；renderer 14 files / 113 tests；Oxlint、Prettier、Rust fmt/clippy 通过；完整 Chromium 27/27 通过。独立 verifier 首轮指出双链接 browser multi-range 与 Frontmatter reverse drag 两个缺口，补齐后复核为 browser/product `PASS`。
- 原生环境已确认：macOS 26.5（build 25F71）、`tauri-cli 2.11.2`、系统启用 ABC 与简体拼音。`pnpm tauri dev --no-watch` 完成 Vite/Cargo 并运行 `target/debug/md-editor`。该进程启动证据不替代交互验收。
- 自动化边界：Codex 进程 `AXIsProcessTrusted=false`，因此 N01-N10 由用户在真实 Tauri/WebKit 窗口执行。2026-07-20 用户明确报告 N01-N10 全部通过；N09 为用户验收覆盖，报告的 `/private/tmp/md-editor-m1-native/saved.md` 未被独立文件系统检查观测，不能写成独立产物验证。

## G011 图片与编辑面反馈修正

- 活动或选中的图片现在保留完整 Markdown 源码，并在源码行下方使用 point Widget 持续渲染预览；编辑 `alt`、`src` 或 `title` 后预览随同一 CM6 transaction 实时更新。非活动图片仍以 exact-source Replace Widget 呈现并保留 atomic 删除语义。
- 左右键从图片源码边界进入，或上下键的 `EditorView.moveVertically` 视觉落点命中成功图片/失败占位时，最高优先级命令会把 selection 转换为源码内部的真实折叠光标；源码与实时预览同步展开，焦点保留在唯一 `.cm-content`。鼠标点击仍选择完整图片源码，整块复制和 Backspace/Delete 语义不变。
- 上下键的视觉落点命中 `---`、`***` 或 `___` 时，同一 atom 导航层会选择完整分割线源码并保留原子视觉反馈；正向和反向移动都不会被 atomic range 跳过或把光标困在上一行，后续 Backspace/Delete 仍精确删除整块。
- 图片加载失败使用无边框、无圆角、无底色的两行状态，显示简短提示、alt 和原始 source；选中时只增加一条左侧强调线，不改写源码，也不改变既有 4rem 失败块几何基线。
- `.cm-content` 保持全宽以维持 CodeMirror 指针坐标，使用响应式对称 padding 形成最大约 860px 的居中可读列；块级视觉 Replace 可吞掉紧随源码块的换行以消除重复行高，但 atomic/protected/source range 仍只拥有精确源码。
- renderer root 启用官方 `EditorView.lineWrapping`，源码与 WYSIWYG 都按 CM6 视觉行自动换行；620px 窗口下 500 字符连续字符串形成多条视觉行，`.cm-scroller` 横向溢出为 0。
- Frontmatter 已去掉卡片边框、圆角、底色、`Frontmatter` 标题和 `YAML` 徽标，只以一条细竖线组织 YAML 正文；正常状态不显示标题，异常时才显示简短 status。正文继续位于唯一 `.cm-content`，没有 nested editor、form 或独立 history。
- 视觉检查覆盖 1280 x 720 和 760 x 520：真实图片活动预览为 190 x 190、源码同时可见；窄窗口编辑面和 Frontmatter 无水平溢出或控件重叠。
- 新鲜自动门禁：workspace 11 个 TypeScript 项目通过；Vitest 63 files / 386 tests 与 release 5/5 通过；renderer 14 files / 122 tests；完整 Chromium 31/31 通过。此前 G011 的 Oxlint、Prettier、Rust fmt/clippy 和排除站点后的 10 个 workspace build 仍为全绿；根 `pnpm build` 仅因 `next/font` 无法连接 Google Fonts 失败，编辑器和 desktop production build 已通过。
- G011 后续原生验收已由用户在真实 Tauri/WebKit 窗口完成，N05、N06、N08、N10 均按新视觉确认通过。

| 原生项 | 当前状态 | 待确认结果 |
| --- | --- | --- |
| N01 系统中文 IME01-IME10 | 通过 | 候选窗可用、单次提交、selection/history 正确 |
| N02 正反向跨全部 block family 拖选 | 通过 | 原生选区连续可见，复制源码精确 |
| N03 纯键盘 atom/list/task | 通过 | 无焦点陷阱，选择反馈、删除和 undo 正确 |
| N04 系统 copy/cut/paste | 通过 | 底层 Markdown 与 source-only 保护符合矩阵 |
| N05 相对本地图片 | 通过 | 预览成功且保存仍保留相对 `src` |
| N06 失败/慢图片 | 通过 | 新占位布局/选区稳定，alt/source 可读，源码不变 |
| N07 mode/scroll/ranges/history | 通过 | 同一 view/state/history/selection/viewport |
| N08 Frontmatter YAML | 通过 | 主 `.cm-content` IME/edit/error/undo，无嵌套焦点/history |
| N09 Save/Save As | 通过（用户覆盖） | 用户确认保存语义通过；报告的保存产物未被独立观测 |
| N10 light/dark theme | 通过 | markers/widgets/selection 清晰且无重叠/位移 |

## P0-A 回归修复：provenance-carrying protected ranges（2026-08-02）

- 背景：M3 表格交互第二阶段（commit `7501b76`）把 `isWysiwygChangeAllowed` 的宽选区放行条件放宽为 `selection.from <= pr.from && selection.to >= pr.to`（"恰好相等选区"），本意是支持整表原子选中后直接打字/粘贴等价替换整表，但对**所有** protected ranges 生效，导致默认 atom（footnote `[^note]`、autolink `<https://...>`、reference）的 source-only 删除保护失效。Chromium 复跑出现 3 项失败（`E13` / `E01-AC14` / `AC14`，均在 `codemirror-m1-s2-wysiwyg.spec.ts`）。
- 修复（唯一实现，不做几何反查）：`WysiwygProjectionState.protectedRanges` 从 `readonly SourceRange[]` 改为 `readonly ProtectedSourceRange[]`（携带 `kind`：`default-atom` / `frontmatter` / `block-marker` / `code` / `table`），`buildProtectedRanges` 各分支 push 时携带 provenance；判定公式按 kind 区分：
  - `table`：covers 放行（`selection.from <= pr.from && selection.to >= pr.to`，含恰好相等；容忍拖选含尾随换行 `selection.to` 到 `fullRange.to + 1`，layout decoration 替换范围含尾随换行）；
  - 其余来源：strict-wider 放行（`selection.from < pr.from || selection.to > pr.to`，G012 语义：恰好拒绝、跨块更宽才放行）；
  - 同一 change 触及多个 provenance 时，任一非 table 的恰好/部分命中即整体拒绝；跨块宽选区完整覆盖所有 provenance 时按 G012 放行。
- 契约同步：`projection-state.test.ts` 原"恰好等于 protected 范围的选区视为宽选区"用例（autolink fixture）改为断言 autolink 恰好删除被拒绝，并把整表替换放行语义交由新 `change-protection.test.ts` 的 table fixture 覆盖；既有 protectedRanges shape 断言全部同步为携带 kind 的联合类型。
- 新增 `wysiwyg/change-protection.test.ts`（12 tests）：footnote/autolink 恰好删除拒绝 + 宣布、strict-wider 放行、table 恰好 typing/paste/Delete 放行、混合部分命中拒绝、跨块严格覆盖放行、尾随换行容忍、无代码块文档 select-all 放行/有代码块 select-all 拒绝（`transactionTouchesCodeBlockSyntax` 兜底）、表格内部普通输入拒绝、provenance kind 快照完整性。
- 浏览器契约迁移（非掩盖失败）：`E01-AC14` 的 `| [^table] |` 原文可见断言改为 `table[role="grid"]` widget 存在 + 原文不可见（M3 恒网格行为即契约，决策记录 commit `7501b76` / `docs/agent/design/table_interaction_review.md`）；`E13`、`AC14` 的 source-only 宣布断言冻结恢复，未改动。
- 新鲜验证：renderer 21 files / 242 tests 全绿（230 + 12 新增）、Chromium 45/45 全绿、workspace typecheck/lint/build 全绿、Prettier/Rust fmt/clippy/`git diff --check` 全绿。

## G012 隐藏 block marker 修改保护

- 独立 code-reviewer 复现 source mode 光标位于隐藏引用、列表或任务 marker 内部时，直接构造的 WYSIWYG typing transaction 可以修改 marker；atomic range 只约束导航，不等同于 transaction 保护。
- quote、unordered/ordered list 和 task 的实际 replacement ranges 现同时进入 `protectedRanges`。普通 typing/paste 命中内部 offset 时保持文档、selection 和 history 不变；覆盖完整 marker 的跨块宽选区仍按既有规则放行。
- renderer 自有的 Enter、Backspace、Tab、Shift-Tab 和任务切换显式授权。上游 `@codemirror/lang-markdown` 命令通过同步、state-scoped 授权上下文接入，不复制其结构化编辑实现，也不向普通输入泄漏权限。
- 回归覆盖四类 marker 的 source -> WYSIWYG 保留 offset、typing/paste 拒绝，以及真实 Chromium DOM 输入从隐藏 marker 安全映射到可见正文。post-cleaner 全量门禁通过：11-workspace typecheck/build、Vitest 63 files / 390 tests、release 5/5、renderer 126/126、Oxlint、Prettier、Rust fmt/clippy、Rust 38/38 与 Chromium 32/32；最终独立复核为 code-reviewer `APPROVE`、architect `CLEAR`，无未解决 finding。

## M2/S3 代码块实现与验收记录

- parser/range index 从 Lezer 节点生成 fenced opening/raw-info/language-token/info-suffix/body/closing ranges，以及 indented `bodySegments` / `syntaxIndentRanges` / line fingerprints。`closed`、`unclosed`、`malformed`、`partial` 状态显式冻结并参与 mapping；只有完整 closed block 投影，其他状态 fail open 为原始可编辑源码。
- `wysiwygProjectionField` 仍是唯一 projection 状态拥有者。代码块只增加 renderer-owned Decoration、toolbar Widget、atomic/protected ranges 与 composition guard；没有嵌套 `.cm-editor`、textarea、独立 history 或 React 控制文档。
- WYSIWYG 隐藏 fenced fence/info 与 indented structural prefixes；body 保留普通 CM6 文本编辑。source mode 清空 projection 并显示完整源码，mode reconfigure 不替换 view/state epoch。
- 隐藏结构范围采用严格 transaction 保护。普通 typing、paste、selection delete 和 cut 即使来自覆盖整块的宽选区也会在 WYSIWYG 被拒绝并保留 selection；切到全局 source mode 后才允许结构删除。fenced/indented 单元回归和真实 Chromium 跨块拖选均覆盖该约束。
- 零长度 fenced body 现在保留一行可见 code-line geometry，并以 closing fence 前的位置作为原生 selection 锚点。直接键入、pointer 进入和 Enter 会把首次内容与必需 LF 写入同一 history 事务；紧接着的 WYSIWYG Backspace 不破坏隐藏 fence。源码模式删除单个 closing backtick 后会 fail open，toolbar/code-line projection 全部清除，下方普通段落不继承缩进。
- mixed highlighting 使用 CM6 `markdown({ codeLanguages })` 与 20 个 direct `LanguageDescription` loader。exact alias lookup 不做 fuzzy match；未知、pending 和 load failure 使用 plain fallback 且不改写 info source。G0 probe 比较后拒绝 broad `@codemirror/language-data`：最终 18 个 JavaScript chunk、491940 total gzip bytes、364758 boot gzip bytes、excluded parser module 为 0。
- language command 只修改首个 token 并保留 suffix；Plain 的 suffix 分支、toolbar Select/Copy、clipboard failure feedback、focus restoration、fenced/indented Enter/Tab/Shift+Tab、边界 Backspace/Delete、两段式 Mod-A、多选区、pointer/arrow entry、IME 和 undo/redo 均由 renderer command 层验证。
- line number 使用 block-local `Decoration.line` 和 CSS counter data，不启用 editor-wide gutter。真实 WebKit 首轮发现 `.cm-line` padding specificity 覆盖导致数字压住首字；selector 提升到 `.cm-content .cm-md-code-line-numbered` 后，light/dark/narrow 原生截图与 geometry assertion 均证明 number 不覆盖首 token，wrapped continuation row 不重复编号。
- 固定性能 fixture 为 50 个 200 行 fenced block 加一个 20,000 行 fenced block，共 51 blocks / 30,000 body lines。单元 diagnostics 对 body/info/huge-block edit 均证明 `delta fullIndex=0`、`delta fullProjection=0`、`delta dirtyBlock=1`、`delta dirtyCodeBlock=1`；浏览器测试把 CM6 合法的 lazy parse coverage refresh 单独归因，防止把后台解析误算为编辑全量 rebuild。
- 新鲜自动化：11-workspace typecheck 通过；renderer 18 files / 184 tests、editor-ui 5 files / 20 tests、desktop 27 files / 103 tests、release 5/5 通过；Oxlint、Prettier、Rust fmt/clippy、完整 workspace build 与 Chromium 45/45 均通过。
- 历史原生证据目录：`/private/tmp/md-editor-m2-s3-code-blocks/20260723T045021Z`。2026-07-23 验收时 `code-block-native-evidence.mjs verify` 确认 N01-N12 全部 PASS、toolbar copied body 115 bytes、saved Markdown 244 bytes、LF-only。该目录中的 `working.md` 于 2026-07-24 被后续空代码块复测继续编辑，当前不再与 `expected-saved.md` byte-equal，因此不能再描述为可重放通过的归档；`notes.md`、copy 产物、expected 文件和截图只保留历史验收记录。
- Post-fix 原生证据目录：`/private/tmp/md-editor-m2-s3-code-blocks/20260723T194530Z-n13`。当前 `verify-n13` 可重放确认 N13 PASS，覆盖直接键入、pointer 进入、Enter materialization、单步 undo/redo、WYSIWYG Backspace 保护、源码模式删除一个 closing backtick 后的 fail-open 与下方段落无缩进；保存 Markdown 66 bytes 且 LF-only。

| M2 历史原生项 | 结果 | 观测 |
| --- | --- | --- |
| N01-N02 单实例与导航 | 通过 | source/WYSIWYG 共享 history/selection/scroll；指针和箭头可进出 fence |
| N03-N04 fenced/indented 编辑 | 通过 | Enter/Tab/Shift+Tab、边界 Backspace/Delete 与 undo 符合结构语义 |
| N05 selection | 通过 | 两段式 Cmd+A、多选区与跨块 source selection 保持 |
| N06 language | 通过 | known/plain/custom、suffix preservation 与 undo 通过 |
| N07 visual/accessibility | 通过 | light/dark/narrow 行号、换行和 toolbar 可读，无首 token 覆盖 |
| N08-N09 clipboard/drag | 通过 | toolbar body-only copy 精确；跨块拖选复制底层 Markdown |
| N10 系统中文 IME | 通过 | macOS 拼音候选窗、`中文` 单次提交、undo/redo 使用主 history |
| N11 native save | 通过 | Cmd+S 后磁盘文件与 expected fixture byte-equal、LF-only、保留尾 LF |
| N12 malformed fallback | 通过 | raw fail-open，无 toolbar；修复后投影，undo 恢复 raw，磁盘未改 |
| N13 post-fix empty body delta | 通过 | Tauri/WebKit 已验证直接键入、pointer/Enter、单步 undo/redo、隐藏 fence Backspace 保护和单 backtick fail-open；证据目录 `/private/tmp/md-editor-m2-s3-code-blocks/20260723T194530Z-n13` |

## M3-A GFM 表格元数据与投影骨架

- `range-types.ts` 新增 `MarkdownSyntaxKind.table`、`MarkdownRenderPolicy.table-widget`、`MarkdownEditPolicy.structured` 与 `MarkdownInteractionPolicy.structured-block` 的 `Table` 节点；新增 `MarkdownTableBlockMetadata` 形状（`sourceBlockRange` / `sourceFingerprint` / `headerRowRange` / `delimiterRowRange` / `bodyRowRanges` / `alignments` / `columnCount` / `bodyRowCount` / `hasLeadingPipes` / `sourceLineFingerprints`），对齐数组按 GFM 规范支持 `left` / `center` / `right` / `none`。
- `node-policy.ts` 把 `Table` 改为 `kind: "table" / renderPolicy: "table-widget"`，把 `TableHeader` / `TableRow` / `TableCell` / `TableDelimiter` 维持为透明节点（不分配 policy）；`RAW_FALLBACK_POLICY` 仍是未知节点兜底。
- `range-index.ts` 新增 `createTableBlockMetadata` 工厂与 `freezeTableBlockMetadata` / `mapTableBlockMetadata`，所有 fingerprint 路径与 code block 同样通过 `fingerprintSource` 校验：`visitParserNode` 在 `renderPolicy === "table-widget"` 时也停止向下递归，保证 cell 内 `**bold**` / `[link]` / `[^note]` 等 inline 节点不会越级成为顶层 record。
- `wysiwyg/table-projection.ts` 提供 `isProjectableTable`（仅 `complete` 覆盖且 `delimiterRowRange` 非空）、`buildTableLayoutDecorations`（header / delimiter / body 行级 decoration）、`buildTableAtomicRanges`（delimiter row 的 atomic mark）、`getTableProtectedRanges`（仅返回 delimiter row），配套 `tableProjectionTheme`。
- `projection-state.ts` 暴露 `WysiwygProjectionFeature.tables`；`buildProtectedRanges` 把"每 record 收集多处"重构为累加，使 blocks / tables 互不短路。
- `wysiwyg/index.ts` 注入 `tableProjectionTheme`；`renderer.ts` 把 `"tables"` 加入 `createWysiwygProjectionExtensions` 的 features 数组。
- 6 个 M3 表格 fixture（aligned / minimal / no-leading-pipes / sparse / inline-content / no-body）+ 6 个 M3 range-index 测试 + 6 个 M3 投影测试，全部在 Node 下用 headless `EditorState` 跑通，无需 React / DOM / Tauri。
- 工作区全量门禁：11-workspace `pnpm typecheck` 通过；`pnpm test` 各包通过（renderer 197、editor-ui 20、desktop 103、file-system 25、editor-core 69、ai 20、mdx-plugins 2、mdx-component-registry 3、markdown-fidelity 18、shared 1、site 6 + release 5）；`pnpm lint:oxlint` / `pnpm format:prettier:check` / `pnpm lint:rust` 全绿。
- 明确不做：cell 投影、对齐切换、tab 跳格、toolbar、image / link 在 cell 内的可视化结构化编辑——这些是 M3-B 的目标。

## M3 可编辑可视化表格（2026-08-02，从 M3-B 只读版升级）

- S4 评估结论（2026-08-01 已记录于架构文档 No-Go 条款）：CM6 生态无成熟的可复用 WYSIWYG 表格引擎——`codemirror-markdown-tables`（ckant）0 stars / 单维护者 / 依赖嵌套编辑器方案；`codemirror-live-markdown` 仍为 alpha；Joplin / Zettlr / Nexus-Editor 均为项目内部实现。CM6 作者 marijn 明确：WYSIWYG 表格需 "block widget + 每 cell 嵌套内层编辑器"，与 CM6 单列行模型冲突。按架构 No-Go 条款裁剪范围：**不引入嵌套编辑器、不自研大型表格引擎**。因此不做 CM6 原生光标式单元格编辑，改为 contenteditable 单元格 + 事务回写方案。
- 用户验收决定（2026-08-02）：表格在 WYSIWYG 中**始终显示**为样式化网格，不接受双击切源码；单元格在网格内就地编辑（类似 Excel）；一次 Delete/Backspace 可删除整表；支持调整行、列数量。该决定取代 M3-B 的 "Arrow 回显源码" 行为。
- 实现：非活动表格整表 `Decoration.replace` 为 `TableGridWidget`（block widget，覆盖 `fullRange` 至 trailing newline），DOM 为语义化 `<table role="table">` + `<th scope="col">` / `<td>`，对齐映射 `alignments[index] ?? "none"`；单元格 `contentEditable`（`plaintext-only`，WebView 不支持时降级 `"true"`）就地编辑，`ignoreEvent` 放行 widget 内事件；焦点提交（blur）、Enter 提交并下移、Tab 提交并右移（Shift+Tab 左移）、Escape 取消并恢复源码文本；提交通过 `commitTableCell` 以**整行替换**方式发受保护 transaction（`authorizeWysiwygProtectedChange` + `userEvent: "input.type"` + history），`serializeTableRow` 统一负责 `|`→`\|` 转义与 trim，`splitTableRowCells` 保留转义管道，不双重转义。
- 工具栏按钮（add-row / del-row / add-col / del-col）：body 行新增用单空格 `" "` 占位（纯空串在部分 GFM 解析路径不稳定）、文档末尾无换行时先补 `\n`；列新增跨 header/delimiter/body 同步，末列拒绝删除。点击表格非单元格空白 → `selectWysiwygAtom` 整表原子选中（meta/ctrl 多选），Backspace / Delete 整表删除、undo 可恢复。
- 交互语义变更：`selectionActivatesRecord` 对 table 恒返回 `false`（不再因光标进入而回显源码）；`isKeyboardRevealAtom` 不再包含 table（Arrow 从边界进入 → 直接整表原子选中）；整表恒 atomic + protected，不再依赖 active 状态。
- 关键 bug 修复：
  - **Tailwind preflight 清零 widget 边框**：`@tailwindcss/vite` preflight 全局 `border-width: 0` 覆盖 widget 边框导致表格看起来是原始文本；修复为 `.cm-md-table-widget` / `th` / `td` 边框加 `!important`（调试期曾用红边框 + console 日志确认 widget 真实创建）。
  - **range-index 删末行丢表**：删除表格最后一行时 `newDirty` 落在剩余 Table 节点之外、`expandNewDirtyRange` 不扩到表格，导致 rebuild 跳过表格记录；修复为 `updateMarkdownRangeIndex` 先 `ensureSyntaxTree(transaction.state, doc.length, 5_000)`，再把 `oldDirty` 经 `transaction.changes` 映射并入 `newDirty` 后统一 `expandNewDirtyRange`（含回归测试）。
- 新增/修改文件：`wysiwyg/table-editing.ts`（新，序列化/提交/行列增删纯逻辑）、`wysiwyg/table-editing.test.ts`（新，5 tests，mock `EditorView`：`get state()` + `dispatch` 内 `state.update(spec)`）、`wysiwyg/widgets/table-widget.ts`（重写为可编辑网格 + 工具栏）、`wysiwyg/table-projection.ts`（恒 grid + 恒整表 atomic/protected）、`wysiwyg/projection-state.ts`（table 恒非 active）、`wysiwyg/atom-selection.ts`（table 不再 reveal）、`markdown/range-index.ts`（删末行修复）、`editor-ui` CSS（网格/工具栏/单元格样式）。
- 验证：renderer 全量 **213 tests 全绿**（20 files；table-projection 12 + table-editing 5 + atom-selection 24 含 4 个表格原子测试 + range-index 25）；`pnpm prettier`、`pnpm lint`（oxlint + clippy）、`pnpm typecheck` 全绿。dev server（vite 7273 + tauri debug）下人工确认 widget 渲染（红边框调试已移除）。
- 后续阶段继续留待：多单元格拖拽选区、column resize、末端 Tab 退出/循环语义、cell 内 image / link 可视化结构化编辑；对齐切换已在第三阶段通过列菜单实现。

## G002 M3 浏览器验收与 CI 门禁（2026-08-03）

- **验收交付**：新增 `apps/desktop/e2e/codemirror-m3-table.spec.ts`（7 个交互面：恒网格、单元格就地编辑/Enter/Tab/Shift+Tab/Escape、行列手柄与菜单增删对齐、整表原子选中/删除/undo、选中态等价替换、末尾 Enter 退出续写、表格内 footnote 与表外保护边界 + a11y 冒烟）。Chromium **52/52 全绿**（含 m1-s2 与 s1 既有用例，全量浏览器套件）。
- **B6 末尾 Enter 退出续写根因与修复**（`table-editing.ts` `exitTableWithParagraph`）：`MarkdownTableBlockMetadata.fullRange.to` **不含最后一行 body 的末尾换行**，表格后源码为 `\n\n` 时（终止空行 + 正文换行）旧实现在 `insertAt+2` 注入并在 76 落光标，导致新空行落在正文之后、续写文本粘连进正文。经验证几何：`fullRange.to = 73` 处恰为末行文本结尾，`insertAt+2 = 75` 才是终止空行后的首个新空行。修复为 `\n\n` 分支在 `insertAt+1` 注入 `\n\n`、`\n` 分支在 `insertAt+1` 注入 `\n\n\n`、否则在 `insertAt` 注入 `\n\n`，光标恒 `insertAt+2`。新空行恰好落在终止空行之后，续写文本独立成段。单元测试补齐 3 个退出续写场景（含 B6 镜像断言键入后的精确文档），B6 e2e 期望数组同步修正（Enter 后先断言 `\n\n` 注入的中间态，再断言键入续写后的终态）。
- **预存测试基建缺口**：全量单测曾报 `cell.cloneNode is not a function`（`table-widget.ts` `flushCellCommit` 以 `cloneNode(true)` 克隆单元格剔除块手柄后取 `innerText`）；`widget-lifecycle.test.ts` 的 `FakeElement` 补齐 `cloneNode`（深克隆 attributes/dataset/children/textContent）与 `remove()`（自父节点数组摘除）后 243/243 全绿。
- **CI 门禁**（三个 workflow 均接入 `test:browser`，浏览器失败即显式失败）：
  - `build-macos.yml`（PR 门禁 + workflow_dispatch）：完整执行含 `@quarantine` 用例，CI 默认 `retries: 1` 吸收已知 flaky（`playwright.config.ts` 改由 `PLAYWRIGHT_RETRIES` 环境变量控制，本地仍 0）。
  - `release-macos.yml` / `release-beta.yml`（发布严格单次）：`PLAYWRIGHT_RETRIES=0` 不重试，`--grep-invert "@quarantine"` 排除隔离用例（负向/易变用例只会在 PR 门禁完整执行，符合 B9 负向验证仅在 PR workflow 执行）。
  - 各 job 内先 `playwright install chromium` 再跑套件；Playwright `webServer` 自起 `dev:e2e`（127.0.0.1:4173），无需预构建。


## 文档同步记录

本次架构同步覆盖：

- `custom_markdown_renderer_architecture.md`
- `markdown_editor_requirements.md`
- `markdown_editor_task_priorities.md`
- `markdown_editor_technical_plan.md`
- `mdx_component_plugin_architecture.md`
- `inline_syntax_markers_and_visual_refresh.md`
- 迁移前状态记录及对应目录索引

后续每个实现变更必须在同一变更中更新本文件。状态只能基于已存在的代码和新鲜验证证据，不得按计划日期或目标能力提前更新。

## 初始架构审查验证（历史记录）

- 代码事实核对：desktop 仍挂载 `DesktopMilkdownEditor` / `DesktopSourceEditor`；`editor-ui` 同时包含待接入的独立 `CodeMirrorEditor` bridge 和待 G007 删除的旧 Milkdown 路径。
- 当前 Callout 行为核对：轻量预览已有 ProseMirror `NodeSelection`、选中描边和两步整块删除，但没有官方 React 渲染、后代事件拦截或 CM6 Widget 生命周期证据。
- 文档检查：18 个变更文档通过 Prettier，全部相对 Markdown 链接可解析，`git diff --check` 通过。
- 契约检查：跨文档断言确认 13 个 CM6 spike / 里程碑仍为“未开始”，并确认单编辑器、HTML、MDX、GFM 表格、Frontmatter、AI、LF 和 beta 状态不变量。
- 独立复核：架构审查最终结果为 `APPROVED`。
- 初始架构审查阶段仅修改文档，未运行代码 typecheck、test 或 build；后续实现故事的新鲜证据按 G001-G007 分节记录如下。

## G001 新鲜验证证据

- 迁移前 focused baseline：`editor-core` 4 files / 50 tests、`editor-ui` 19 files / 140 tests、desktop 21 files / 78 tests 全部通过。
- 新增能力清单测试：`apps/desktop/tests/s1-capability-inventory.test.ts` 3 tests 通过，并与 desktop runtime 的 24 个 command id 精确比对。
- Desktop 包级 Vitest：新增 `apps/desktop/vitest.config.ts` 复用现有 Vite alias，并把 Vitest 收集范围限定到 `src/**/*.test.ts` 和 `tests/**/*.test.ts`；标准包级运行 22 files / 81 tests 通过，Playwright spec 不再被 Vitest 误收集。
- Desktop TypeScript：`tsc -p apps/desktop/tsconfig.json --noEmit` 通过。
- Desktop production build：Vite 生产构建通过；对 `apps/desktop/dist` 扫描 `__MD_EDITOR_E2E__`、`legacy-dual-editor-baseline` 和 `renderer-codemirror-not-mounted` 均无匹配，证明 E2E-only bridge 未进入生产产物。现有动态/静态导入和 chunk size 警告仍在，但无新增构建错误。
- 变更文件静态检查：oxlint、Prettier 和 `git diff --check` 通过。
- Playwright Chromium：`apps/desktop/e2e/codemirror-s1-single-view.spec.ts` 2 tests 通过；验证欢迎 shell、E2E-only 只读 baseline、明确的 renderer unavailable 状态，以及 LF-only 内存持久化 fixture。
- 浏览器依赖：workspace catalog 和 desktop dev dependency 已加入 `@playwright/test`，lockfile 已重新解析；Chromium 由 Playwright managed browser 安装。
- G001 当时的环境说明：Volta 将 Homebrew `pnpm` 委托给不可用的系统 Node，因此该阶段自动化使用已安装的 Node 24 二进制直接运行 Vitest/TypeScript/Playwright CLI；这是当时的命令入口环境问题，不是测试失败。当前修复状态见 G008 记录。
- 未验证：尚未实现任何 CM6 renderer 行为，因此 C/R/U/D/F/P/N/E 功能矩阵除上述基线 smoke 外均未宣称通过；本阶段未运行 Tauri smoke 或全仓 workspace build。

## G002 新鲜验证证据

- 新增 `packages/editor-core/src/document-state.ts` 并由 package root 重导出；核心协议使用既有 `normalizeLineEndings`，没有引入 React、CM6、desktop、Tauri 或新依赖。
- C1-C19：`packages/editor-core/tests/document-protocol.test.ts` 19 tests 通过；与既有 document-state 测试合计 targeted 28/28 通过。
- Editor core 全量：5 files / 69 tests 通过；`tsc -p packages/editor-core/tsconfig.json --noEmit` 通过。
- 依赖回归：`editor-ui` 19 files / 140 tests 和 TypeScript 通过；desktop 22 files / 81 tests 和 TypeScript 通过。
- 变更文件 oxlint 与 Prettier 通过；独立 code-reviewer 首轮发现 C11 同轮 listener 注册/取消边界，修复并增加回归测试后复核结果为 `APPROVE`。
- 未验证：G002 只完成 headless core contract；R/U/D/F/P/N/E 系列、CM6 history/IME、FileService/native ordering、Tauri smoke 和单 `EditorView` browser identity 仍属于后续故事，不得据此宣称 beta 可用。

## G003 新鲜验证证据

- FileService F1-F5 与 N4/N5 transport 模型：`packages/file-system/tests/save-scheduler.test.ts` 8 tests 通过；file-system 全量 3 files / 27 tests 和 TypeScript 通过。
- 原生 N0-N3、N6-N9：Rust `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml --lib` 38 tests 通过；覆盖 helper thread、唯一 critical job、atomic rename 后 warning、temp write/sync/rename failure、dialog cancellation、out-of-order delivery、reattach 两种竞态、poison recovery、TS/Rust serde contract 和 non-main no-touch rejection。
- 跨层一致性：`apps/desktop/tests/save-settlement-integration.test.ts` 验证 higher warned same-path commit 与 lower Save As promotion 的最终 bytes、baseline、实际 path 和 dirty 状态一致。
- Desktop runtime 边界：attach/adapter 不传 caller label，TypeScript/Rust `main` 常量契约一致，runtime factory 模块导入不调用 native command；desktop 全量 24 files / 90 tests 和 TypeScript 通过。
- Core 回归：editor-core 5 files / 69 tests 和 TypeScript 通过；变更 TS 文件 oxlint、Prettier、Rust fmt 均通过。
- F6 line-number port 已由 G004 renderer 完成；P1-P5、D/E controller/main/settings 模块图迁移仍属于 G006。尚未运行手动 Tauri dialog/主窗口/设置窗口 smoke，因此不能宣称 desktop 主链路或 beta 可用。

## G004 新鲜验证证据

- 新增 `@md-editor/renderer-codemirror`，直接依赖对齐的 `@codemirror/commands`、`lang-markdown`、`state`、`view` 以及 headless `editor-core/shared`；不依赖 React、`editor-ui`、desktop、Tauri、Milkdown、ProseMirror 或 `@uiw/react-codemirror`。
- 生产路径只由 `createCodeMirrorRenderer` 创建原生 `EditorView`；root extension 与 mode/line-number compartments 分离，external edit、mode、rollback、reconcile 和 line number 都使用 typed origin annotation。
- R1-R17：`packages/renderer-codemirror/src/renderer.test.ts` 18 tests 通过；覆盖单次 create/destroy、local acknowledgement、future sequence fail-closed、isolated external undo/redo、same-text no-op、generation replacement、50 次 mode switch、baseline no-op、IME supersede/local-wins、LF、三类 reconcile 和显式 scroll reset。
- Renderer 包级 `test` 1 file / 18 tests、TypeScript、oxlint、Prettier 与 `git diff --check` 通过；editor-core 回归 5 files / 69 tests 和 TypeScript 通过。
- 测试子路径只暴露只读 identity/revision/history/selection/scroll/counter probe 与 state-backed 用户事务模拟；可变 CM6 view/state 没有进入公共 API。
- G004 阶段当时的明确缺口：R-series 是 Node 下的 CM6 state/protocol 测试。真实 DOM `EditorView` 的单实例、focus/scroll/StrictMode/asset overlay 证据属于 G005/G006 browser integration；该阶段 desktop bridge 仍报告 `renderer-codemirror-not-mounted`，因此当时尚未达到 beta 或 S1 完成条件。

## G005 新鲜验证证据

- 新增 `packages/editor-ui/src/components/CodeMirrorEditor`：稳定 React host 每次真实挂载只创建一个 renderer；transition 订阅负责 `sync/reconcile`，snapshot 订阅只触发 React 元数据失效，不把 Markdown 回灌为 controlled value。
- `EditorUiProvider` 提供唯一 active renderer 的 typed port registry；mode、external edit、line number、host visibility、focus 和 measure 都通过 facade 调用，未挂载时返回 typed unavailable。MDX/AI 旧命令在当前 editor 不支持时显示明确反馈，不再静默成功。
- 同文档外部编辑同步完成 reservation、一个 isolated CM6 transaction 和 finalize/release；document replacement 保持同一 `EditorView`，只在 generation boundary 替换 `EditorState` 并重置 history/selection/scroll。
- 已删除 document remount key、`editor-ui-state.ts` 和 SourceEditor/Milkdown 间的 scroll-ratio/target handoff；对应 desktop 测试改为阻止这些旧机制重新出现。
- R18 与真实 Chromium 验证 asset preview：editor host 作为 sibling 只切换 inert/visibility，renderer 在 CodeMirror measure frame 后恢复 focus-owned scroll。Renderer 现为 1 file / 19 tests，TypeScript 通过。
- `apps/desktop/e2e/codemirror-editor-bridge.spec.ts` Chromium 3/3 通过：覆盖 U1-U8 及保留的 U9 设置路径，包括单 `.cm-editor`、rerender/mode/preview 身份、history/selection/focus/scroll、独立订阅、external edit、document boundary、真实 unmount/remount 和 StrictMode probe 销毁。
- 工作区 11 个项目的递归 TypeScript 与 Vitest 全部通过；其中 `editor-ui` 19 files / 140 tests、desktop 24 files / 87 tests。Desktop production build 通过，产物扫描未发现 `__CODEMIRROR_EDITOR_E2E__`、`codemirror-editor-harness` 或专用 surface 标记。
- G005 阶段当时的明确缺口：专用 E2E harness 不进入 production graph；`App.tsx` 仍挂载旧双编辑器，desktop controller/main 也尚未注入 G002/G003/G005 semantic ports。G006 前不得标记 S1/M0 完成或发布 CM6 beta。

## G006 新鲜验证证据

- Desktop 产品接入：`main.tsx` 在 React 前按 window surface 动态分流；main 严格执行 attach -> FileService factory -> App render，settings 不求值 main controller/FileService/attach graph，unknown/attach failure fail closed。`App.tsx` 只挂载一个持久 `DesktopCodeMirrorEditor`。
- 文档语义：new/open/open-tree/empty-folder/delete 使用 generation boundary，rename 只更新 path；程序化修改和 mode 只经 renderer ports。保存 checkpoint 在第一个 `await` 前同步入队，实际 path、promotion、warning、failure、cancel 和 verification-required 均由 core settlement 决定。
- Focused TypeScript 全部通过：`renderer-codemirror`、`editor-ui`、desktop、`file-system`。
- Focused Vitest 全部通过：renderer 1 file / 19 tests、editor-ui 19 files / 140 tests、desktop 28 files / 102 tests、file-system 3 files / 28 tests。
- D9 能力处置：当前 runtime 不再注册 12 个格式化日志 no-op，deferred paste/drop listener 不再绑定；inventory 同时锁住 12 个当前注册命令和 12 个 removed audit entries。MDX/AI retained API 返回 typed unsupported 并显示 toast。
- 产品 Chromium 11/11 通过：3 个 React bridge lifecycle 用例，以及 8 个真实 desktop App 用例覆盖 E1-E10、D3、P5 和 settings open/reload/close；证明单 view、mode/rerender/preview 状态保持、无 echo、external undo、new/open/相同文本 boundary、IME queue、重叠保存、LF bytes、main-only reattach 和 settings 隔离。
- Rust `cargo test --manifest-path apps/desktop/src-tauri/Cargo.toml` 38/38 通过，覆盖 main caller 授权、non-main no-touch、单 gate/critical job、epoch/sequence、spawn_blocking、atomic rename、warning/failure/cancel 和 poison recovery。
- Desktop production build 通过；`apps/desktop/dist` 未发现 `__MD_EDITOR_E2E__`、fixture command id 或 E2E save bridge 标记。renderer 主模块当前仍会带入 `setCompositionActiveForTesting` 符号，旧 Milkdown/ProseMirror 代码也仍可在 product bundle 中检出；两项均归入 G007 的生产图清理，不作为通过项隐藏。
- 真实 `tauri dev --no-watch` 已完成 Vite/Cargo 编译并启动 `target/debug/md-editor`，进程保持运行且无终端初始化错误后主动停止。
- 尚未人工验证：macOS 系统中文 IME、原生 Save/Save As dialog 并发操作、settings 原生窗口 open/reload/close 和文件字节查看。对应协议已有 Chromium/Rust 自动化，但不能把替代证据写成 GUI 手工通过。
- 结论：G006 desktop 主链路接入可以 checkpoint；S1/M0 继续保持“进行中”，必须完成 G007 的 E11/E12 与旧 runtime/dependency 删除后再判断 CM6-only beta。

## G007 新鲜验证证据

- 代码收口：删除 desktop Milkdown/SourceEditor wrappers、`editor-ui` 旧表面/工具/测试、旧 MDX menu/AI adapter、旧 mode scroll handoff、Vite aliases 和废弃 exports；产品只保留 raw CM6 `CodeMirrorEditor`。
- 依赖收口：root、desktop、`editor-ui`、workspace catalog 和 lockfile 中 Milkdown、ProseMirror、`@uiw/react-codemirror` 均为零匹配；production dependency graph 不再携带第二套编辑器。
- 保存 API 收口：删除旧 `save_markdown_document` Tauri command、TypeScript adapter/FileService 兼容方法和 Rust legacy save job；main 只通过 attach 后的 ordered scheduler 保存。
- 明确降级：MDX/AI retained commands 使用 immutable unsupported slots，返回 typed unsupported 并显示 toast；E11 同时校验 inventory disposition 与两条可见反馈，不存在 default no-op wiring。
- 测试边界：renderer 生产 API 不再导出 `setCompositionActiveForTesting`；browser E2E 通过真实 `CompositionEvent` 驱动 `.cm-content`，state-backed testing adapter 只保留测试内部可变状态。
- Chromium E1-E11 为 12/12 通过；production E12 构建通过，产物未检出 E2E bridge、fixture-only id、测试 composition setter、Milkdown 或 ProseMirror 标记。
- 定向测试在 G007 收口时通过：editor-core 69 tests、renderer 19 tests、editor-ui 14 tests、desktop 98 tests、file-system 25 tests、Rust 38 tests；五个相关 TypeScript 包的定向 typecheck 也全部通过。最终全仓数字以 G008 重验为准。
- Production build 从旧引擎仍可达时的约 1998 modules 降至约 702 modules；该数字只证明依赖图显著收缩，不替代 S6 性能基线。
- 未验证：系统中文 IME、原生 Save/Save As dialog、settings 原生窗口和真实文件 LF bytes 仍无人工证据；G008 全量门禁尚未完成。因此 G007 可 checkpoint 为代码/自动化切换完成，但 S1/M0 仍只标 beta 候选，不标迁移完成。

## G008 自动化、Cleaner 与独立复核证据

- Changed-file cleaner 删除了 `switchEditorModeSafely` 可绕过 renderer 的 core-only fallback：renderer port 现在是必需参数，mode transaction 必须先取得并校验 receipt，core CAS 失败时再同步回滚 renderer；operation id 同步从迁移期 compatibility 命名改为正式 command 命名。
- Cleaner 后工作区 TypeScript 全部通过：11 个具有 `typecheck` script 的项目均成功；workspace root 本身没有第 12 个 typecheck script。
- 初轮独立复核发现两个 HIGH 和一个同源 architecture WATCH：`verification-required && !isDirty` 未完整进入 browser/Tauri close 与 update relaunch 保护，以及 snapshot-only compatibility API 可绕过 renderer transition。修复后所有关闭/主窗口重启路径统一调用 `isDiscardProtectionRequired`，settings 子窗口不再直接 relaunch；core 和 desktop 已删除 `updateMarkdown`、`markSaved`、`updateSavedBaseline`、`setMode`、`commitCompatibilitySnapshot` 与 app/store helper。
- Post-fix 递归 Vitest 为 50 files / 277 tests 全部通过；release Node tests 5/5、Playwright Chromium E1-E12 12/12、Rust 38/38 全部通过。新增 window guard 与 production-store boundary 回归覆盖 clean-text verification barrier、Tauri 确认关闭、受保护 update relaunch 和 snapshot 旁路移除。
- 全仓 Oxlint `--deny-warnings`、Prettier check、`cargo fmt --check`、`cargo clippy --all-targets -- -D warnings` 全部通过。
- 全工作区 production build 通过；desktop 构建约 702 modules。site 构建仍输出既有 Next.js NFT trace warning，但没有导致构建失败，也不属于本次编辑器迁移代码路径。
- LF 字节扫描没有发现 CR；E10 同时证明 E2E adapter 最终持久化字节为 LF。旧编辑器表面、Milkdown/ProseMirror/runtime dependency、legacy save API、snapshot-only mutation、测试 bridge/setter 和迁移期 mode compatibility 扫描均为零匹配。
- `tauri dev --no-watch` 完成 Vite/Cargo 编译并启动 `target/debug/md-editor`，无终端初始化错误后主动停止；该证据仅是非交互启动冒烟，不等同于原生 GUI 人工验收。
- G008 全量验证当时，本机普通 `pnpm` shim 因 PATH 中找不到 `node` 而不可用，因此验证改用同一已安装 pnpm CLI 的绝对 Node 路径执行；全工作区 build 访问 Google Fonts 时受 sandbox 网络限制，获准联网后通过。这两项是当时的命令入口/环境事实，不是产品失败。
- 2026-07-18 已按 Volta 官方 pnpm 支持方式修复本机入口：shell 启用 `VOLTA_FEATURE_PNPM=1`，Volta 安装仓库固定的 `pnpm@11.6.0`。全新登录 shell 已确认 `node v24.16.0`、`pnpm 11.6.0`、`tauri-cli 2.11.2`，普通 `pnpm tauri dev` 已启动 Vite `http://localhost:7273/`、完成 Cargo dev build 并运行 `target/debug/md-editor`；该记录仍只是启动冒烟，不替代下述原生 GUI 人工验收。
- 初轮独立结果为 code-reviewer `REQUEST CHANGES`、architect `WATCH`；两项同源问题修复并通过 post-fix 全量门禁后，独立复跑结果为 code-reviewer `APPROVE`、architect `CLEAR`，没有剩余代码或架构 blocker。G008 结束时系统中文 IME、原生 Save/Save As dialog、settings 原生窗口、asset preview 和真实文件字节仍无人工证据，因此当时只标 beta 候选；该历史缺口已由下述 2026-07-18 原生人工验收关闭。

## S1 原生验收反馈：模式可观察性

- 2026-07-18 原生验收发现 source / WYSIWYG 切换后编辑区和单图标按钮视觉上无法可靠区分。代码检查确认 mode transaction 与 `data-editor-mode` 正确变化，但当时没有任何 `.cm-md-editor--source` / `.cm-md-editor--wysiwyg` 样式，按钮也没有常驻文字或明显活动态。
- 首轮修复曾把 `DocumentBar` 改为带文字和背景活动态的“所见即所得 / 源码”分段控件；产品验收明确要求右下角维持原有样式后，该 UI 变化已完整撤回，继续使用 30×30px 单图标透明按钮，不增加常驻文案或背景色。
- 编辑区在保持相同垂直行高的前提下，WYSIWYG 使用正文 UI 字体，source 使用等宽字体。该差异补齐 S1 的最小可观察 mode reconfiguration，不实现 S2 Markdown decoration，也不改变右下角 chrome。
- 产品 Playwright E1 通过原有按钮驱动模式切换，并新增 `aria-pressed`、`data-editor-mode` 和 computed font-family 断言；完整 Chromium E1-E11 仍为 12/12 通过，并继续验证同一 view、history、selection、focus 和 scroll 保持。`editor-ui` 恢复为 4 files / 14 tests，package typecheck 通过。
- 产品确认模式差异修复后的原生验证没有问题；该反馈与下述完整人工验收记录共同关闭 S1/M0 的人工证据门禁。

## S1/M0 原生人工验收通过记录

- 日期与环境：2026-07-18；macOS 26.5（build 25F71）、系统 WebKit 21624、`tauri-cli 2.11.2`。
- 产品验收确认系统中文 IME 输入、候选选择、undo/redo、多字符选区、滚动和重复模式切换没有问题；source/WYSIWYG 保持同一 history、selection 与 viewport，并保留原有右下角单图标透明按钮。
- 产品验收确认原生 Save/Save As 排序、取消与编辑期间保存、dialog 打开时窗口响应、settings 窗口隔离、asset preview 状态保持、跨文档边界及相同内容文档边界没有问题。
- 产品验收确认真实文件保存后为 LF、单一编辑器表面无 engine selector，延后能力会明确显示 unsupported 而不是静默执行。本轮未报告失败项或未测项。
- 结论：该轮验收确认 S1 单实例与数据同步及 M0 CM6 单编辑器主链路达到功能体验 beta 门槛。其后的 M1/S2 与 M1-FM/S5-FM-only 进展按本文顶部状态表记账；M6 稳定发布收口仍未完成。
