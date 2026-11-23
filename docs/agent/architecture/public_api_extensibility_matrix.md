# 公开 API 自定义能力矩阵（extensibility matrix）

用途：定义"外部宿主想改某个东西时，应该走哪条通道"，并登记 `/internals` 的每一个条目及它**为什么还不是正式 API**。改动公开导出面、新增 `/internals` 条目、或回答"这个能自定义吗"之前必读。

机器约束由 `scripts/packages/public-surface.test.mjs` 提供：`/internals` 的每个导出必须在下文白名单里有条目，白名单里每条必须能在 `/internals` 里解析。二者不一致测试即失败。

## 三条通道

| 用户诉求 | 官方通道（被承诺） | 运行时通道 | 逃生通道（不承诺） |
| --- | --- | --- | --- |
| 改颜色、字体、版心 | `theme` prop → `--theme-*` 变量 | —（主题是创建期配置，不提供运行时改主题端口） | `injectStyles: false` + 自带 CSS |
| 加语法（数学 / Mermaid / 自定义 callout） | `syntax.plugins` 数组 | `ports.setSyntaxPlugins` / `addSyntaxPlugin(): Disposable` | `createCodeMirrorRenderer` 自行组装 |
| 加命令、快捷键、命令面板项 | `@md-editor/core` 的 command registry | 同左（registry 是数据源） | 直接调 `ports` |
| 运行时操作编辑器 | `ports.*` | — | — |
| 接入 Markdown lint | 创建期 `markdownlint={{ lint }}` + `enableMarkdownLint` | `ports.setMarkdownLintEngine(engine)`（引擎晚到时补注，不重建视图） | — |
| 只做无头渲染（Node / QuickLook） | `@md-editor/compiler` 的 `renderStaticHtml` | — | `compileToTokens` 自行消费 |
| 工具栏、大纲、状态栏、AI 面板 | **不在 editor 包内**，宿主自建 | — | `@md-editor/app-ui`（私有）作为参考实现 |
| 改默认快捷键 / 换一套键位方案 | `@md-editor/core`：`MARKDOWN_FORMATTING_KEYMAPS`（默认表）+ `createBuiltInKeymaps()`（整表）+ `resolveKeymaps()`（默认值×用户覆盖）+ `TOGGLE_SOURCE_SHORTCUT`（内置命令 chord 常量） | 同左（都是纯数据与纯函数） | 直接把合并结果交给 `ports.setKeymaps` |

原则：**同一能力只有一个官方入口 + 一个逃生口**。任何"半公开"（名字泄漏内部实现、语义只在某一条路径成立）的入口都不允许留在正式 API 里。

## internals 白名单

登记规则见下节。当前条目：

<!-- internals-whitelist:start -->
| 条目 | 所属入口 | 为什么不是正式 API | 晋级触发条件 |
| --- | --- | --- | --- |
| `acceptAiSuggestion` | `@md-editor/editor/internals` | AI 建议实现细节；正式入口是 `ports.showSuggestion` 与 `aiSuggestionLabels` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `aiSuggestionAcceptedAnnotation` | `@md-editor/editor/internals` | AI 建议实现细节；正式入口是 `ports.showSuggestion` 与 `aiSuggestionLabels` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `aiSuggestionExtension` | `@md-editor/editor/internals` | AI 建议实现细节；正式入口是 `ports.showSuggestion` 与 `aiSuggestionLabels` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `aiSuggestionField` | `@md-editor/editor/internals` | AI 建议实现细节；正式入口是 `ports.showSuggestion` 与 `aiSuggestionLabels` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `aiSuggestionLabelsFacet` | `@md-editor/editor/internals` | AI 建议实现细节；正式入口是 `ports.showSuggestion` 与 `aiSuggestionLabels` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `CalloutFooterWidget` | `@md-editor/editor/internals` | 渲染器内部 widget；自定义外观走 `syntaxPluginHostPorts.createCalloutHeaderWidget` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `CalloutHeaderWidget` | `@md-editor/editor/internals` | 渲染器内部 widget；自定义外观走 `syntaxPluginHostPorts.createCalloutHeaderWidget` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `clearAiSuggestionEffect` | `@md-editor/editor/internals` | AI 建议实现细节；正式入口是 `ports.showSuggestion` 与 `aiSuggestionLabels` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `clearMarkdownLintDiagnostics` | `@md-editor/editor/internals` | lint 实现细节；正式入口是 `ports.runDocumentLint` 与命令 `lint.run` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `closeMediaViewerFor` | `@md-editor/editor/internals` | 媒体查看器实现；正式入口是 `syntaxPluginHostPorts.openMediaViewer` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `collectPreservedNonMarkdownDiagnostics` | `@md-editor/editor/internals` | lint 实现细节；正式入口是 `ports.runDocumentLint` 与命令 `lint.run` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `createCodeMirrorRenderer` | `@md-editor/editor/internals` | 自行组装渲染器 / 测试探针的逃生通道；`/testing` 另有专用入口 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `createDiagnosticDomNode` | `@md-editor/editor/internals` | lint 实现细节；正式入口是 `ports.runDocumentLint` 与命令 `lint.run` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `createDocumentStylePort` | `@md-editor/editor/internals` | 样式接管逃生通道；正式入口是 `theme` 与 `injectStyles:false` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `createLintBaseExtensions` | `@md-editor/editor/internals` | 当前无外部消费者，且未通过三条官方通道暴露；需要时按晋级规则提升 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `createLiquidSearchPanel` | `@md-editor/editor/internals` | 输入辅助/搜索面板实现；命中路径由 ports 与默认扩展组装 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `createMarkdownFormattingKeymap` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `createRealtimeMarkdownLintExtension` | `@md-editor/editor/internals` | lint 实现细节；正式入口是 `ports.runDocumentLint` 与命令 `lint.run` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `DEFAULT_AI_SUGGESTION_LABELS` | `@md-editor/editor/internals` | AI 建议实现细节；正式入口是 `ports.showSuggestion` 与 `aiSuggestionLabels` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `DirectiveHeaderWidget` | `@md-editor/editor/internals` | 渲染器内部 widget；自定义外观走 `syntaxPluginHostPorts.createCalloutHeaderWidget` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `dismissAiSuggestion` | `@md-editor/editor/internals` | AI 建议实现细节；正式入口是 `ports.showSuggestion` 与 `aiSuggestionLabels` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `DocumentSnapshot` | `@md-editor/editor/internals` | `@md-editor/core` 的类型再导出；宿主应直接从 core 导入，避免两处定义漂移 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `DocumentStateEvent` | `@md-editor/editor/internals` | `@md-editor/core` 的类型再导出；宿主应直接从 core 导入，避免两处定义漂移 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `EDITOR_STYLE_CSS` | `@md-editor/editor/internals` | 样式接管逃生通道；正式入口是 `theme` 与 `injectStyles:false` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `EDITOR_STYLE_ELEMENT_ID` | `@md-editor/editor/internals` | 样式接管逃生通道；正式入口是 `theme` 与 `injectStyles:false` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `EditorMode` | `@md-editor/editor/internals` | `@md-editor/core` 的类型再导出；宿主应直接从 core 导入，避免两处定义漂移 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `ensureStyleElement` | `@md-editor/editor/internals` | 样式接管逃生通道；正式入口是 `theme` 与 `injectStyles:false` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `executeDocumentLint` | `@md-editor/editor/internals` | lint 实现细节；正式入口是 `ports.runDocumentLint` 与命令 `lint.run` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `fixAllMarkdownLintIssues` | `@md-editor/editor/internals` | lint 实现细节；正式入口是 `ports.runDocumentLint` 与命令 `lint.run` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `getSuggestionViewportStatus` | `@md-editor/editor/internals` | AI 建议实现细节；正式入口是 `ports.showSuggestion` 与 `aiSuggestionLabels` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `ImageInsertionInput` | `@md-editor/editor/internals` | 图片插入的实现类型；正式入口是 `ports.prepareImageInsertion` 的结果类型 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `ImageInsertionOptions` | `@md-editor/editor/internals` | 图片插入的实现类型；正式入口是 `ports.prepareImageInsertion` 的结果类型 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `ImagePreviewResolveInput` | `@md-editor/editor/internals` | 图片插入的实现类型；正式入口是 `ports.prepareImageInsertion` 的结果类型 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `ImagePreviewResolver` | `@md-editor/editor/internals` | 图片插入的实现类型；正式入口是 `ports.prepareImageInsertion` 的结果类型 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `injectEditorStyles` | `@md-editor/editor/internals` | 样式接管逃生通道；正式入口是 `theme` 与 `injectStyles:false` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `insertCodeBlock` | `@md-editor/editor/internals` | 当前无外部消费者，且未通过三条官方通道暴露；需要时按晋级规则提升 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `insertOrWrapLink` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `isValidUrl` | `@md-editor/editor/internals` | 输入辅助/搜索面板实现；命中路径由 ports 与默认扩展组装 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `lintLiquidTheme` | `@md-editor/editor/internals` | lint 实现细节；正式入口是 `ports.runDocumentLint` 与命令 `lint.run` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `markdownRangeIndexField` | `@md-editor/editor/internals` | 投影状态端口；写语法插件不需要读它（插件通过 `MarkdownSyntaxPlugin` 契约接入） | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `ModePortResult` | `@md-editor/editor/internals` | `@md-editor/core` 的类型再导出；宿主应直接从 core 导入，避免两处定义漂移 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `ModeReceipt` | `@md-editor/editor/internals` | `@md-editor/core` 的类型再导出；宿主应直接从 core 导入，避免两处定义漂移 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `ModeRequest` | `@md-editor/editor/internals` | `@md-editor/core` 的类型再导出；宿主应直接从 core 导入，避免两处定义漂移 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `normalizeCodeMirrorKey` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `openMediaViewer` | `@md-editor/editor/internals` | 媒体查看器实现；正式入口是 `syntaxPluginHostPorts.openMediaViewer` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `PreparedImageInsertion` | `@md-editor/editor/internals` | 图片插入的实现类型；正式入口是 `ports.prepareImageInsertion` 的结果类型 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `RendererExternalEditReceipt` | `@md-editor/editor/internals` | `@md-editor/core` 的类型再导出；宿主应直接从 core 导入，避免两处定义漂移 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `RendererSyncResult` | `@md-editor/editor/internals` | `@md-editor/core` 的类型再导出；宿主应直接从 core 导入，避免两处定义漂移 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `runLinkValidation` | `@md-editor/editor/internals` | lint 实现细节；正式入口是 `ports.runDocumentLint` 与命令 `lint.run` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `runMarkdownLint` | `@md-editor/editor/internals` | lint 实现细节；正式入口是 `ports.runDocumentLint` 与命令 `lint.run` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `runMarkdownLintCommand` | `@md-editor/editor/internals` | lint 实现细节；正式入口是 `ports.runDocumentLint` 与命令 `lint.run` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `setAiSuggestionEffect` | `@md-editor/editor/internals` | AI 建议实现细节；正式入口是 `ports.showSuggestion` 与 `aiSuggestionLabels` | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `setHeading1` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `setHeading2` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `setHeading3` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `setHeading4` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `setHeading5` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `setHeading6` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `setParagraph` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `smartPairsExtension` | `@md-editor/editor/internals` | 输入辅助/搜索面板实现；命中路径由 ports 与默认扩展组装 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `smartPasteExtension` | `@md-editor/editor/internals` | 输入辅助/搜索面板实现；命中路径由 ports 与默认扩展组装 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `syntaxPluginRegistryFacet` | `@md-editor/editor/internals` | 投影状态端口；写语法插件不需要读它（插件通过 `MarkdownSyntaxPlugin` 契约接入） | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `toggleBlockquote` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `toggleBold` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `toggleBulletList` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `toggleHighlight` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `toggleInlineCode` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `toggleItalic` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `toggleOrderedList` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `toggleStrikethrough` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
| `toggleTaskList` | `@md-editor/editor/internals` | 格式化命令的底层实现；正式入口是 `ports.executeFormatting` 或 core 的命令注册表 | 出现 ≥2 个真实外部需求时提升为语义化正式 API |
<!-- internals-whitelist:end -->


## 晋级规则

`/internals` 的条目**可以被提升为正式 API**，条件与流程：

1. **触发**：同一能力被 ≥2 个真实外部需求用到（不是"我们觉得可能有用"）。
2. **改名**：提升时必须换成语义化名字，不允许把内部术语带进正式 API。
   反例：`showInlineStyleMarkers` / `setInlineStyleMarkers` 泄漏了投影策略的内部叫法，正式形态应为 `markerVisibility: "on-touch" | "always" | "never"`。
3. **登记**：同步更新本表、`THEME_VARIABLES` 式的可枚举契约（如适用）、以及 `public-surface.snapshot.json` 的 budget。
4. **反向**：从 `/internals` 移除时，本表对应条目同时删除（测试会抓到不一致）。

`/internals` **只减不增**是默认状态：新增条目必须在 PR 说明里回答"为什么它不能走三条官方通道"。

## 错误契约（临时约定，本段 P6 补全）

当前公开 API 的失败表现有 5 种并存（返回 `false` + `console.warn` / 抛错 / 静默 / 返回 `status` 联合 / 返回 `string | null`）。**本轮不统一**（见 PRD 的 ADR-Deferred）。

**临时约定**：新增 API 一律**抛错**，不得新增"静默失败"或"返回 `false` 表示失败"的形态。

**迁移触发条件**（满足任一条即启动统一）：
- 出现第二个公开包需要跨包错误语义（当前只有 `shared.Result` 未被采纳）；
- 或任一阶段新增的 API 不得不用第二种失败形态来表达同一种失败。

**判据独立性**：4 条验收判据（导出快照 / desktop 零回归 / tarball 验证 / README typecheck）都不依赖错误契约，因此延后不影响本轮结项。

## 同名变量在跨表面的差异（P6 补全）

`--theme-editor-font-size` 在编辑画布上是第 71 条契约变量（默认 `inherit`），但在 `@md-editor/compiler` 的静态导出与打印模板里默认值是 `16px` / `11pt`（`templates/styles.ts:72,387`、`html-export.ts:202,204`），且静态导出会用 `!important` 硬写。写文档时不得表述为"编辑器单一契约"。

## 与测试的绑定

| 测试 | 守什么 |
| --- | --- |
| `public-surface.test.mjs` 的入口集合断言 | 新增/删除公开子入口必须改快照 |
| 导出精确清单断言 | 任何增删导出都在 diff 里可见 |
| budget 身份棘轮 | 新增导出必须显式抬高预算（= 一次需要写理由的动作） |
| internals ↔ 本表白名单双向交叉 | 表与实现不允许脱钩 |
| `exports` ↔ `publishConfig.exports` 键集相等 | 发布产物与源码入口不允许分叉 |

## 验收断言的"可判别性"要求

连续几轮评审都抓到同一类问题：**测试写了，但删掉生产代码仍然绿**。已确立三条判据：

| 判据 | 反例（不可接受） | 正例（已落地） |
| --- | --- | --- |
| 断言必须触达生产代码 | G-11 曾在测试文件里自建 `validateThenRegister` 再断言它抛错（自证循环，删掉生产校验也绿） | `syntax-conflict-validation.ts` 抽出生产校验，测试直接调用它；已自证：删掉 id 校验 → 3 条测试变红 |
| 覆盖清单必须与真实命中一致 | `ports-baseline` 曾写"executeFormatting 7 次命中 = 已覆盖"，而那 7 次全是 `insert.mermaid.*` | `formatting-command-ids.test.ts` 对 17 个 `format.*` 逐个断言，并与 `FORMATTING_COMMAND_MAP` 键集双向比对 |
| 双面可达要用两侧各自的机制证明 | M-9 曾用 `{...spread}` 传参 + 断言 `ports` 存在 —— spread 绕过 TS 多余属性检查，删掉生产转发也绿 | bridge 侧**显式字面量**传参并断言可观测副作用（`<style>` 是否注入、`nonce` 属性、facet 值）；props 侧 `Pick<Props, …>` 显式字面量编译期断言 |

新增测试时必须回答："如果生产实现被删掉/改错，这条断言会不会红？"


### 已实证的判别力（每轮都做"删生产实现→应红"验证）

| 断言 | 注入的破坏 | 结果 |
| --- | --- | --- |
| `syntax-conflict-validation` 的 id/node 校验 | 删除 id 校验分支 | 3 条红 |
| 生产 `createSyntaxRegistrar` 的 wiring | 删除 `assertNoSyntaxConflicts(...)` 调用行 | 2 条红（含"onChanged 零调用"） |
| M-9 bridge 转发 `injectStyles`/`styleNonce` | 从 `rendererOptions` 删除两行转发 | 2 条红 |
| M-9 bridge 转发 `focusDimOpacity` | 删除该行转发 | 2 条红（焦点模式 CSS 变量读不到注入值） |
| M-9 bridge 转发 `syntaxPluginHostPorts` | 删除该行转发 | 1 条红（折叠按钮文案不再经宿主 translator） |
| M-9 props→bridge 转发 | 从 `CodeMirrorEditor.tsx` 删除 `styleNonce` 传参 | 1 条红（mock bridge 收到的实参少了它） |
| `removed-api-scan` | 文档写回 `renderer.setPlugins` | 1 条红 |
| R-2 子入口校验 | 根 README 写回 `plugin-sdk/mdx` | 1 条红 |
| A-6 别名不遮蔽新 id | 去掉 `!realHeadingIds.has(legacySlug)` 条件 | 1 条红（`## テスト手順` + `## 手順` 出现重复 id） |
| A-4/A-5 锚点端到端 | 让 `markdown-fidelity` 的 `extractHeadingOutline` 用自己的分配器（`x-<slug>`）与 compiler 分叉 | **16 条红** |
| A-4/A-5 锚点端到端 | 破坏 compiler 侧 id 来源（改 `generateLegacyHeadingSlug` 的名字/实现） | **19 条红**（全量） |
| T-5 变量条数 | 往 `THEME_VARIABLES` 加第 72 条 | 1 条红（条数是契约，不是跟随代码） |
| utools 字号透传 | 删 `UtoolsApp` 的 `fontSize: settings.fontSize` | 1 条红（15px 会静默落回 inherit） |
| PR#290-A1/C7 按模块名刷新 | 去掉按 key 分流、一律全量刷新 | 2 条红（Turndown 也派发、消毒器多派发解析索引） |
| PR#290-A1/C7 监听器异常隔离 | 去掉 `notifyReady` 的逐项 try/catch | 1 条红（坏监听器挡住后续订阅者） |
| PR#290-A2 lint 原子提交 | 还原"先引擎、后开关"两步提交 | 1 条红（非法组合失败后旧配置不可用） |
| PR#290-A3 注册 token | 去掉 `dispose` 的 token 守卫 | 2 条红（旧句柄摘掉新注册） |
| PR#290-A3 桌面句柄身份 | 桌面 `dispose` 只按 id 删 | 1 条红（同 ID 换实例被误删） |
| PR#290-A4 分配器最终 ID 唯一 | 还原"只按原始 slug 计数" | 3 条红（`a`/`a-1`/`a-1` 撞车） |
| PR#290-A5 别名全文档唯一 | 去掉 `emittedAliases` 条件 | 2 条红（`手順` 重复） |
| PR#290-A6 `defineNodes` 预检 | 预检漏 `defineNodes` | 1 条红 |
| PR#290-A6 桌面批量原子性 | `registerAll` 退化为逐项 `register` | 3 条红（半批状态） |
| PR#290-C8 大纲跳过围栏 | 去掉围栏状态判断 | 6 条红（围栏内假标题占掉 id） |
| PR#290-C9 类型对齐官方 | 还原窄类型（`errorDetail?: string`） | tsc 报 TS2322 **且** README 示例检查红 |

反例（**不可接受**，已修两次）：
1. 早期版本把四个 option 用 spread 传入 —— TypeScript 的多余属性检查对 spread 不生效，删掉 `bridge.ts` 的四行转发后测试仍全绿。
2. 改成显式字面量后，`focusDimOpacity` 与 `syntaxPluginHostPorts` 两条仍是恒真断言（前者只做纯算术 + `expect(fn).toBeTypeOf("function")`，
   后者断言 `Array.isArray(calls)`）；`bridge.ports` 上根本没有 `state` 成员，"经 facet 到达 state" 的说法是错的。
   现改为读焦点模式写入的 `--cm-md-focus-dim-opacity` CSS 变量、以及折叠按钮真实调用宿主 translator。

## 两个非显然的跨层陷阱（PR #290 复审时实证）

这两条都不是"写错了代码"，而是**看起来合理、实际会炸**的结构性陷阱，且都没有类型错误提示。

### 1. 纯声明的语法节点不能进装饰分派表

`SyntaxPluginRegistry` 有两个语义完全不同的表：

| 表 | 语义 | 谁查它 |
| --- | --- | --- |
| `#nodeToPlugin` | "这个节点由**谁**渲染/提取/解析" | `buildDecorations` / `extractMetadata` / `resolveContentRange` |
| 冲突表（独立） | "这个节点名**已被占用**" | 仅注册前的冲突预检 |

把只通过 Lezer `defineNodes` 声明、没有装饰实现的插件塞进 `#nodeToPlugin` 后，
`buildDecorations` 会命中它并返回**空数组**。CM6 对空 mark decoration 直接抛
`RangeError: Mark decorations may not be empty`——错误信息完全不指向根因，
实测让 `syntax-plugins` 3 条用例崩溃。冲突预检与装饰分派必须用两张表。

### 2. `dispose` 必须同时清策略表与分派表

简写 `nodePolicy`（单节点）路径在注册时写了两张表（`#nodePolicies` + `#nodeToPlugin`），
`dispose` 只清前者时，节点名会继续占用分派表。后果不是"多占一个名字"，而是
**同一插件释放后无法重新注册**：预检看到分派表里还有该节点名，报"节点已注册"。
这个缺陷只有在引入注册 token（同一对象可释放→重注册）之后才暴露出来。

## 已删 API 的文档门禁（removed-api-scan）

同一个缺陷类连续两轮逃过评审：**已删除**的 `renderer.use`、`renderer.setPlugins`、`@md-editor/plugin-sdk/mdx`
（前者已删、后者已迁至 `@md-editor/shared/mdx`）都在删除后仍被 README / docs / 源码注释教给用户。此前只有 R-4 一条 grep 且只扫 `packages/*/README.md`，
根 README 与 `docs/**` 全是盲区。

现在改成**单一登记表 + 全量扫描**（`scripts/docs/removed-api-scan.mjs`）：

| 项 | 规则 |
| --- | --- |
| 登记表 | `REMOVED_API`：每删一个对外标识符就加一条（`id` / `pattern` / `replacement` / `allow`），必须有替代写法 |
| 扫描范围 | 仓库根 `README.md`、`README_ZH.md`、`docs/agent/**`、6 个公开包的 `README.md` 与 `src/**` |
| 豁免 | 只允许**迁移备注**：命中点前后 160 字符内出现替代写法或迁移词（原位于 / 已迁移 / 迁至 / 历史 …）。要求同时出现，避免误放行 |
| 接入 | `pnpm test:docs`（已并入 `pnpm test`）；`scripts/docs/removed-api-scan.test.mjs` 自证「当前仓库干净 + 登记表含三项 + 范围含根 README/docs/src」 |

自证：把架构文档里的 `ports.setSyntaxPlugins(plugins)` 改回**已删除**的旧写法 → 扫描立即报
`markdown_syntax_plugin_architecture.md:210 → renderer.setPlugins`；还原即通过。

## 导出预算变更记录

`budget` 只允许人手抬高，重新生成快照不会自动抬高它（否则棘轮失效）。每次抬高都在此登记：谁需要、为什么不能下沉到 `/internals`。

| 日期 | 入口 | total | values | 新增内容与理由 |
| --- | --- | --- | --- | --- |
| 2026-11-21 | `@md-editor/shared/mdx`（新增入口） / `@md-editor/plugin-sdk/mdx`（删除入口） | 新入口 7 / 0 | 0 | MDX 组件契约词表迁入 `shared`：`core` 的 `EditorRuntime.mdxComponents` 需要该类型，而 core 不能反向依赖 `plugin-sdk`（会把它及其 CodeMirror/Lezer peer 拖进"只装 core"的消费者）。类型只此一处定义，8 处调用方已全部改导入。 |
| 2026-11-21 | `@md-editor/shared` | 7 → 11 | 3 → 7 | 标题锚点规范实现（`slugifyHeading` / `headingSlugSource` / `createHeadingSlugAllocator` / `EMPTY_HEADING_SLUG`）。放在 `shared` 而不是 `/internals`：它是 `markdown-fidelity` 与 `compiler` 的共同祖先，必须被两个包**正式引用**，否则又会出现两套实现。 |
| 2026-11-21 | `@md-editor/editor` | 126 → 132 | 76 → 77 | 官方主题通道：`compileEditorTheme` + `EditorTheme` / `EditorThemeColors` / `EditorThemeTypography` / `EditorThemeGeometry` / `ThemeVariables`。必须留在主入口——主题是使用者会直接写的 API，下沉到 `/internals` 等于让每个宿主自建变量映射。 |
| 2026-11-21 | `@md-editor/plugin-sdk/syntax` | 47 → 49 | 9 → 10 | `SyntaxPluginRegistry` 与 `PluginRegistrationOrigin`。注册不变量（id 唯一、节点策略不冲突、装饰分派）归属契约包：插件作者必须能在不引入编辑器的情况下单测自己的插件；留在 editor 会迫使公开包测试反向依赖编辑器。 |
| 2026-11-21 | `@md-editor/shared` | 11 → 12 | 7 → 7 | `Disposable`。跨包通用最小协议；放在 shared 后 `core` 不必为一个 3 行类型依赖契约包（契约包带 CodeMirror peer）。 |
| 2026-11-21 | `@md-editor/editor` | 132 → **51** | 77 → **9** | P4 收口完成：主入口只保留 9 个值导出与全部类型；71 个内部件移入 `/internals`。**预算已下调到实际值**，任何重新膨胀都会直接失败。 |
| 2026-11-21 | `@md-editor/editor` | 51 → 55 | 9 → 9 | lint 引擎端口类型：`MarkdownLintEngine` / `MarkdownLintRequest` / `MarkdownLintIssue` / `MarkdownLintResult`。宿主必须能标注自己注入的引擎形状；`markdownlint` 本身已降为可选 peer，不再是 editor 的静态依赖。 |

## 已知例外：destroyed 后的只读端口

插件**变更类**端口（`addSyntaxPlugin` / `setSyntaxPlugins`）在 destroyed 后**抛错**——静默成功会让插件作者
以为注册生效了。但 **lint 类查询端口**（`runDocumentLint` / `runMarkdownLintCommand` / `fixAllMarkdownLint`）
在 destroyed 后仍返回空结果：它们语义上是"读取当前诊断"，编辑器已销毁时"没有诊断"是真实答案，
且调用方（React effect 清理、窗口关闭）普遍在销毁后仍会触发一次。这是**有意的例外**，新增 API 仍按
"变更类抛错、查询类可返回空调"的规则区分。

## 已实施：三处同步渲染依赖的懒加载（2026-11-21）

`markdownlint` 已移出静态依赖图（改为宿主注入）。以下三类同样已移出，做法是
"**同步就绪判定 + 既有降级路径 + 就绪后重算**"，而不是把渲染签名改成 async：

| 依赖 | 接入层 | 未就绪时的降级 | 就绪后 |
| --- | --- | --- | --- |
| `sanitize-html` | 投影层 `wysiwyg/projections/html-projection.ts` | `sanitizeHtmlBlockDetailed` 返回 `null` → 既有占位 widget（"Loading HTML preview…"） | 重投影，占位升级为渲染结果 |
| `mdast-util-*` / `micromark-extension-*` | 解析层 `markdown/mdx-parse.ts` | `parseMdxJsxElements` 返回 `[]` → 该块保持 `parserCoverage=partial`（源码可见） | 覆盖率重算，升级为结构化记录 |
| `turndown` / `turndown-plugin-gfm` | 粘贴层 `wysiwyg/input/smart-paste.ts` | 交回浏览器默认粘贴（纯文本），不吞内容 | 之后所有粘贴走 Markdown 转换 |
| `markdownlint` | 宿主注入（`@md-editor/app-ui/markdownlint` 子入口动态 import） | `enableMarkdownLint` 保持关闭（缺引擎时开启会抛错，不静默无诊断） | `ports.setMarkdownLintEngine(engine)` 就地补注，不重建视图 |

**顺序契约**：`setMarkdownLintEngine` 必须在 `setMarkdownLint(true)` 之前生效。React 侧靠 effect 声明顺序保证
（引擎 effect 在开关 effect 之前）；写反了会在同一 commit 里先开开关 → 命中"缺引擎"守卫而抛错（实测会让整个编辑器挂载失败）。

统一机制：`packages/editor/src/module-loader.ts` 提供 `preloadOptionalModule` /
`getOptionalModule` / `onOptionalModuleReady`；`renderer/controller/optional-modules.ts`
在控制器构造时预加载、销毁时退订。两条不变量：

1. **只有加载期真的降级过才重算**（`noteOptionalModuleDegraded` / `consumeOptionalModuleDegraded`）。
   否则就绪时会凭空多派一个事务，实测会打断正在进行的图形代码块编辑链。
2. **安全语义不放宽**：`sanitize-html` 未就绪时返回 `null` 而不是"跳过消毒"，
   渲染层因此只可能拿到占位，装载未消毒内容的路径不存在。

实测（桌面端 boot JS gzip，`pnpm test:bundle`）：基线 **823 042 → 661 036**（−162 KB，实测值 660 759）。分两轮收紧：editor 侧三点依赖 → 747 524，
markdownlint 离开 app-ui 子入口 → 661 036（`apps/desktop/scripts/bundle-budget.baseline.json`）。
契约由 `packages/editor/tests/module-loader.test.ts` 锁定（未就绪返回 undefined / 只通知一次 /
失败不永久缓存）。

## 键位表为什么进正式 API（3 个新符号）

`@md-editor/core` 0.6 起新增三个运行时导出，全部是**数据或纯函数**，没有新的可变状态：

| 符号 | 作用 | 为什么不放在 `/internals` |
| --- | --- | --- |
| `MARKDOWN_FORMATTING_KEYMAPS` | 格式化命令的默认 chord（`KeymapDescriptor & { title }`） | `@md-editor/editor` 只依赖 core，必须从正式入口读到默认值；否则编辑器只能再抄一份（这正是 0.6.0 之前的漂移源头） |
| `createBuiltInKeymaps()` | 内建能力的完整键位表（含归属），无需先建 `Runtime` | 第三方宿主（例如只挂 `CodeMirrorEditor` 的应用）需要知道"默认是什么"，构造 `Runtime` 需要 `DocumentState` + `MDX` 注册表 |
| `resolveKeymaps(base, overrides)` | 默认值 × 用户覆盖的唯一合并规则（`null`/空白 = 解绑，未知 id 忽略） | 该规则被编辑器端口、桌面设置、web 派发共用；散落在三处就是上一轮漂移的成因 |
| `TOGGLE_SOURCE_SHORTCUT` | `view.toggleSource` 的默认 chord（`Mod-/`） | 编辑器要内置这个键位（`owner: "editor"`），需要与 core 的注册共用同一常量；与既有的 `OPEN_FOLDER_SHORTCUT` 同一范式 |

配套的**类型**没有新增导出：`owner?: "editor" | "host"` 内联在 `KeymapDescriptor` 上，
覆盖表就是 `Readonly<Record<string, string | null>>`，判断归属直接写 `keymap.owner === "editor"`。
`public-surface` 预算因此只增长 3 个 value（total 104 → 107，values 34 → 37），零 type 增长；
后续把 `view.toggleSource` 的内置绑定补上时又新增了 1 个 value 常量 `TOGGLE_SOURCE_SHORTCUT`
（107 → 108 / 37 → 38），同样零 type 增长。
`KeymapDescriptor` 从 `index.ts` 移到 `src/keymap.ts` 并由包根再导出，导入路径不变。
