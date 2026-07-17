# CodeMirror 6 渲染器迁移状态

> 用途：记录 CM6 单编辑器迁移的真实代码进度、beta 可用性、缺口、降级和验证证据。
>
> 最后更新：2026-07-18（S1/M0 原生人工验收通过，CM6-only 主链路标记为 beta 可用）

## 当前结论

- **阶段：S1/M0 beta 可用。G001-G007 实现、G008 全仓自动化门禁、changed-file cleaner、初轮独立复核修复、post-fix 全量重验、非交互 Tauri 启动冒烟、清洁独立复核和 2026-07-18 原生人工验收均已通过。desktop production graph 只保留单一 CM6 产品表面、语义 controller、ordered save 与 main/settings 平台隔离。**
- `App.tsx` 对活动 Markdown 文档只挂载一个持久 `DesktopCodeMirrorEditor`。source/WYSIWYG 复用同一 `EditorView`，编辑区通过源码等宽/所见即所得正文排版区分；右下角继续使用原有单图标透明模式按钮。资源预览只隐藏/inert 该 host，不卸载 renderer。
- 旧 `DesktopMilkdownEditor`、`DesktopSourceEditor`、Milkdown / ProseMirror / `@uiw/react-codemirror` 源码、exports、Vite aliases、manifest 依赖和 lockfile entries 已删除；production bundle 扫描也不再包含旧引擎或测试 composition setter。
- `@md-editor/renderer-codemirror` 已使用原生 CM6 `EditorView` factory、root/mode/line-number compartments、typed transaction origin、external-edit isolated history、generation boundary `setState`、显式 reconcile、composition queue 和 host visibility 恢复；生产 API 不暴露可变 view/state。
- `@md-editor/editor-core` 已实现 LF 不可变快照、generation/revision、有序 transition/snapshot 订阅、外部编辑 reservation/finalize、文档边界、path/mode CAS、save checkpoint、commit-certainty settlement 和 verification barrier。
- `@md-editor/file-system` 已实现显式构造的 `RuntimeFileService`、同步 checkpoint 入队校验、epoch runtime sequence 和完整 native job FIFO；throw、timeout 与非法 payload 都分类为 `indeterminate`。
- Tauri 已注册进程级 `SaveCommitGate`、main-WebView-only attach/ordered save、`spawn_blocking` wrapper、temp write + `sync_all` + atomic rename commit boundary、post-commit warning、reattach/poison recovery 和 retired/non-monotonic rejection。
- Desktop 新建/打开/空文件夹/删除走 atomic `replaceDocument`，rename/move 走 `setDocumentPath`；程序化同文档修改走 renderer external-edit port，mode 走 typed mode port，不再由 controller 调用旧 snapshot-only 文档兼容方法。
- `main.tsx` 在 React 前分流 window surface：main 严格执行 attach -> FileService factory -> render，settings 只加载 `SettingsWindowApp`；一个 main-only `RuntimeFileService` 被注入 App、controllers 与 file tree。unknown/attach failure 均 fail closed。
- 保存 controller 在第一个 `await` 前同步 `beginSave` + enqueue，typed outcome 只 settle 一次；成功采用实际返回 path，warning/failed/cancel/indeterminate 分别反馈，verification-required 继续阻止无提示放弃。
- 当前是 **CM6-only beta 可用**：E11 deferred controls、E12 production exclusion、G008 post-fix 自动化质量门禁、独立复核和 S1 原生人工验收均已通过。格式化命令 silent no-op、deferred paste/drop 全局监听、旧 engine runtime 和 snapshot-only 文档 mutation 旁路均已移除。该结论只覆盖 S1/M0，不代表 S2-S6、M1-M5 或 M6 已完成。
- Playwright E2E 现在运行真实 desktop `App` 与 E2E-only 内存平台 adapter；产品 bridge 只暴露只读诊断/受控命令并且不进入 production bundle。独立 React bridge harness 保留为窄层 lifecycle 验证。
- 迁移开始后只维护 CM6 编辑器路径，不增加 Milkdown / CM6 功能开关或双向同步层。

代码证据：

- [`App.tsx`](../../../apps/desktop/src/app/App.tsx) 只挂载持久 [`DesktopCodeMirrorEditor.tsx`](../../../apps/desktop/src/components/DesktopCodeMirrorEditor.tsx)，preview 为 sibling overlay。
- [`main.tsx`](../../../apps/desktop/src/main.tsx) 与 [`platform-bootstrap.ts`](../../../apps/desktop/src/app/platform-bootstrap.ts) 实现 React 前的 main/settings 分流和 required service 注入。
- [`document-save.ts`](../../../apps/desktop/src/app/controller/document-save.ts) 实现 checkpoint 同步入队、单次 settlement、certainty feedback 与 discard protection。
- [`editor-ui/package.json`](../../../packages/editor-ui/package.json)、desktop/root manifests、workspace catalog 与 lockfile 已移除 Milkdown、ProseMirror 和 `@uiw/react-codemirror` 依赖。
- [`editor-ui/src/index.ts`](../../../packages/editor-ui/src/index.ts) 只导出 `CodeMirrorEditor` 产品表面；旧 Milkdown/SourceEditor 目录、desktop wrappers 和专用工具均已删除。
- [`renderer.ts`](../../../packages/renderer-codemirror/src/renderer.ts) 是 G004 的原生 CM6 lifecycle/sync 实现；只有 generation boundary 调用 `setState`。
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
| S2 核心显隐与选择 | 未开始 | 当前 CM6 WYSIWYG 仍为布局中性配置；旧实现已删除，不能引用历史行为作为当前能力 |
| S3 代码块 | 未开始 | 当前 CM6 只有 Markdown 源码编辑，尚无语言菜单、高亮工具栏、行号和复制交互 |
| S4 可视化 GFM 表格 | 未开始 | 尚未完成成熟表格引擎评估和 CM6 history 验证 |
| S5 Frontmatter / HTML / MDX | 未开始 | 当前 raw-fragment 与官方组件包可作为迁移输入，但不是 CM6 Widget 证据 |
| S6 性能基线 | 未开始 | 删除旧引擎前未固化同环境量化结果；必须建立 CM6 fixture/门槛，并把历史对照缺口显式保留 |

## 里程碑状态

| 里程碑 | 状态 | Beta / 完成判断 |
| --- | --- | --- |
| M0 CM6 单编辑器主链路 | beta 可用 | CM6-only 主链路、旧引擎删除、E1-E12、G008 自动化质量门禁、独立复核与必需原生人工证据均已通过 |
| M1 基础 Markdown / Frontmatter | 未开始 | 不可用 |
| M2 代码块 | 未开始 | 不可用 |
| M3 GFM 表格 | 未开始 | 不可用 |
| M4 基础 HTML / 官方 MDX | 未开始 | 不可用 |
| M5 现有能力迁移 | 未开始 | 不可用 |
| M6 稳定发布收口 | 未开始 | 不得宣称迁移完成 |

## 已有可迁移能力

- `editor-core` 已有文档状态、命令、快捷键、feature 和文件生命周期边界。
- `markdown-fidelity` 已有 Frontmatter、raw fragment、图片路径和换行相关保真测试。
- `mdx-component-registry` 已有 metadata registry；`mdx-plugins` 已有官方 `Callout`、component map、metadata 子出口和组件测试。
- 已删除的 Milkdown 表面曾提供官方 MDX 插入菜单、`Mod-Shift-M` 快捷键和 snippet 插入链路；这些事实只保留在历史文档/Git 中，当前代码没有可复用旧运行时。
- 已删除的 Milkdown Callout 轻量预览曾有 ProseMirror `NodeSelection`、选中描边和两步整块删除，但不是 CM6 renderer 的原子交互或 Widget 生命周期证据。
- 搜索、大纲、图片粘贴、代码块、AI suggestion、selection 和 IME 的完整 parity 仍需在 CM6 上重建对应测试；不能引用不可达旧表面宣称已迁移。

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

- M1 / S2：inline marker、标题、列表、链接、图片、分割线和 Frontmatter 可视化尚未实现；WYSIWYG 当前与源码模式共享同一 raw Markdown 文档，虽已有不同字体排版，但尚未进行 Markdown decoration / Widget 渲染。
- M2 / S3：代码块语言选择、高亮工具栏、行号、复制和完整键盘交互尚未实现。
- M3 / S4：可视化 GFM 表格、单元格编辑、多选、Tab、行列操作和主 history 接入尚未实现。
- M4 / S5：基础 HTML 白名单渲染、官方 MDX 真实渲染、原子选择、整块删除和错误占位尚未实现；MDX 入口当前可见地报告 typed unsupported。
- M5：AI suggestion、图片粘贴/拖放、链接打开、搜索 parity、完整大纲/主题/可访问性仍未迁移；AI 入口当前可见地报告 typed unsupported。
- S6：没有删除前的同环境量化基线；CM6 大文件、输入延迟、滚动、内存和 Widget 生命周期数据仍待建立。
- S1/M0 原生人工门禁已通过；环境、覆盖范围和结论见文末“原生人工验收通过记录”。后续里程碑引入 decoration、Widget、表格或 MDX 后，仍须针对新增交互重新执行对应原生验收。
- G008：全仓 typecheck/test/lint/build/Rust/browser/Tauri 启动冒烟、post-cleaner 重验和初轮复核修复后的全量重验已通过；独立复跑结果为 code-reviewer `APPROVE`、architect `CLEAR`。

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
- 结论：S1 单实例与数据同步及 M0 CM6 单编辑器主链路达到功能体验 beta 门槛，状态更新为 **beta 可用**。S2-S6、M1-M5 仍按上表保持未开始，M6 稳定发布收口未完成。
