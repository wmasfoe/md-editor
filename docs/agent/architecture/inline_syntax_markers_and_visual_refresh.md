# WYSIWYG 内联可删除语法标记（路线 D）+ 编辑器视觉优化 · 实施文档

> 面向接手实施的 AI Agent。本文自包含：读完即可执行，无需依赖会话上下文或 `.omc/` 临时产物。
> 关联规格：`.omc/specs/deep-interview-wysiwyg-ui.md`；共识计划：`.omc/plans/wysiwyg-ui-route-d.md`；spike 结论：`.omc/research/route-d-spike.md`。

## 1. 目标（两个独立组件）

### 组件 1 · 编辑器视觉优化（低风险）
- 标题 H1–H6 染主题青蓝色（新增 `--theme-heading-accent`），非黑。
- 段落间距/行高/列表缩进对齐参照图（Effie）的舒适密度。
- **字体族绝对不改**。
- 配色走主题变量、**亮/暗各一套**；所有新变量在 CSS 里用 `var(--x, <fallback>)` 兜底（应用支持 custom CSS 主题，不含新变量）。

### 组件 2 · 内联语法标记 · 路线 D（中高风险，核心）
行内 4 种语法 `**`（加粗）、`*`（斜体）、`~~`（删除线）、`` ` ``（行内代码）：
- 标记符号作为**真实文本**常驻显示在 WYSIWYG 文档中（全程可见）。
- 用 ProseMirror decoration 给"合法成对语法"的**内部文字**加样式（加粗/斜体/删除线/等宽 + 染色），**标记符号本身淡化**。
- 删除一个字符使语法非法时（`**加粗**` → `**加粗*`），样式**自动消失**，只剩字面字符——无需自研合法性判定，交给解析器/正则天然处理。
- 保存到磁盘的 markdown **identity 往返**，`**`/`*`/`` ` `` 不被转义成 `\*\*` 等。

## 2. 关键架构决策（已定，勿推翻）

- **底座不换**：保留 Milkdown(ProseMirror)，不迁 CodeMirror（否决路线 A）。
- **路线 D 三支柱**（spike 已验证 GO，全走官方扩展点、无 patch node_modules）：
  1. **micromark disable**：`$remark` 插件向 remark-parse 传 `data().micromarkExtensions.push({ disable: { null: ['attention','codeText','strikethrough'] } })`（`attention`=strong+emphasis，`codeText`=inline code，`strikethrough`=gfm 删除线；按构造名全局生效、与 gfm 注册顺序无关）。使 `**` 等在 mdast 层就不再被切成 mark 节点、保留为纯文本。
  2. **bundle 重组**：停用 `.use(commonmark)`/`.use(gfm)`，用 granular 导出重组 keep-list，**剔除 emphasis/strong/inlineCode/strikethrough 的四件套**（`$markSchema` + `$inputRule` + `$command` + `$useKeymap`）。keymap 必须一并删，否则 Mod-b 调 `toggleStrongCommand` 命中已删 mark 类型会**运行时报错**。
  3. **选择性 raw-emit 序列化**：自定义 `remarkStringifyOptionsCtx` 的 `handlers.text`——调用 `state.safe()` 前临时从 `state.unsafe` 过滤掉 `character ∈ {* _ \` ~}` 的条目、调用后还原。**免疫 phrasing + atBreak 两类转义，且保留 `#`/`>`/`[` 等结构字符的正常转义**。
     - ⚠️ 注意：`remarkStringifyOptionsCtx` 的 options **无 escape 开关**，`configure` 对 unsafe 只能追加不能删除——所以"改 options 删 unsafe 条目"不可行，唯一干净路径是自定义 text handler 在运行时改 `state.unsafe`（每次调用是 fresh copy，改后还原安全）。
- **Non-Goal 裁决（用户已批准）**：自定义 serializer text handler 关转义**可接受**。理由：micromark disable 后 `*`/`_`/`` ` `` 已是普通标点，序列化不转义是"解析+序列化两侧对称、语义正确"，区别于被否决的路线 B"单侧对抗框架序列化"。
- **粘贴降级（用户已接受）**：schema 移除 4 mark 后，从外部复制的富文本粘入会落为纯文本（无 `**` 包裹、无 mark）。这是路线 D 的必然结果，已确认可接受。

## 3. 当前磁盘状态（已有部分实现，未验证）

> ⚠️ 以下改动由自动化流程写入但**尚未运行 typecheck/test、也无单测**。接手 agent 必须先验证再补齐，不可假设其正确。

已改文件（`git diff --stat`）：
- `apps/desktop/src/app/settings/built-in-themes.ts`：三套 scheme（light/warm/dark）各新增 6 个变量 `--theme-heading-accent` / `--theme-strong-accent` / `--theme-em-accent` / `--theme-del-accent` / `--theme-code-accent` / `--theme-marker-dim`（亮暗各一套取值）。
- `apps/desktop/src/styles.css`：+12 行（应为变量兜底/全局声明，需核对）。
- `packages/editor-ui/src/components/MilkdownEditor/MilkdownEditor.css`：heading `color` 改 `var(--theme-heading-accent, color-mix(...))`；`li::marker` 改 `var(--theme-marker-dim, ...)`；删掉了 h6 的 `--theme-muted` 覆盖。**注意：`.md-marker-dim` / `.md-strong` / `.md-em` / `.md-del` / `.md-code` 的 CSS 规则可能还没加全，需核对补齐**。
- `packages/editor-ui/src/components/MilkdownEditor/MilkdownEditorPrimitive.tsx`：移除 `commonmark`/`gfm` import，`.use(commonmark).use(gfm)` 替换为 `.use(inlineMarkerPreset).use(inlineSyntaxDecorationPlugin)`，config 阶段加 `configureInlineMarkerSerializer(ctx)`。

新增文件（未纳入 git）：
- `packages/editor-ui/src/components/MilkdownEditor/inlineMarkerPreset.ts`（~417 行）：含 `DISABLED_MICROMARK_CONSTRUCTS`、`REMOVED_MARK_NAMES`、`createRawInlineMarkerTextHandler`、`configureInlineMarkerSerializer`、`disableInlineMarkTokenizationPlugin`、`commonmarkKeepList`、`gfmKeepList`、`inlineMarkerPreset`、`collectMarkSchemaNames`/`collectNodeSchemaNames`。
- `packages/editor-ui/src/components/MilkdownEditor/inlineSyntaxDecorationPlugin.ts`（~226 行）：含 `inlineSyntaxDecorationPluginKey`、`SYNTAX_RULES`（4 条正则）、`collectBlockDecorationSpans`（按 textblock 拼接扫描 + `￼` 占位符跳过 + 重叠 claim 去冲突）、decoration 下发逻辑。

## 4. 待接手 Agent 执行的任务

以下按依赖顺序。**先验证既有实现，再补测、修复、收口**，不要推翻已符合本文技法的代码。

### T1 — 编译与既有测试基线
- `pnpm typecheck`（全包）与 `pnpm --filter @md-editor/editor-ui test` 跑通。记录初始错误。
- 逐一修复类型错误（重点 `inlineMarkerPreset.ts` / `inlineSyntaxDecorationPlugin.ts` 的 Milkdown 类型：`MilkdownPlugin`、`$remark`、`Ctx`、`remarkStringifyOptionsCtx`、`Decoration`/`DecorationSet`/`PluginKey`）。

### T2 — 核对 keep-list 重组正确性（组件2 · Step 1）
- 核对 `commonmarkKeepList` / `gfmKeepList` 是否**完整覆盖**上游 preset 的非目标条目（对照 `@milkdown/preset-commonmark` `lib/index.js:2103` 的 `[schema, inputRules, markInputRules, commands, keymap, plugins]` 与 `@milkdown/preset-gfm` `lib/index.js:1037` 的 `[schema, inputRules, pasteRules, markInputRules, keymap, commands, plugins]`），仅剔除 emphasis/strong/inlineCode/strikethrough 四件套。
- 确认 `.use()` 双层展平不会漏挂某类插件（heading/list/table/blockquote/code-block/image/hr/hardbreak 等必须保留）。
- **升级护栏单测**：用 `collectMarkSchemaNames`/`collectNodeSchemaNames` 对重组后的 mark/node 键集做快照断言，Milkdown 升级时 diff 告警。

### T3 — schema 移除的运行时断言（组件2 · Step 1，spike 遗留项）
- 单测断言 `view.state.schema.marks` **不含** strong/emphasis/inlineCode/strike_through。
- 键入 `**x**` 不触发自动加粗；Cmd-B/Cmd-I/Cmd-`/Cmd-Shift-X 按下**不报错**（keymap 已移除，光标处不产生 mark）。
- 从外部富文本粘贴 → 落为纯文本无 mark（`transformPasted`/parseDOM 命不中）。
- 注意：editor-ui 的 vitest 环境为 `node`（无 jsdom）。需要真实 Editor + DOM 的断言，评估用 jsdom/happy-dom 或迁到能起 ProseMirror view 的测试环境；若成本高，至少覆盖 schema 键集与 parser/serializer 层断言。

### T4 — decoration 染色正确性（组件2 · Step 2）
- 核对 `SYNTAX_RULES` 4 条正则与 commonmark 语义一致、防贪婪/嵌套误判；`*` 斜体正则须排除 `**` 加粗歧义（当前 `/\*(?![\s*])([^*\n]*[^\s*])\*/g` + 重叠 claim 机制，需测试验证）。
- 单测覆盖：合法成对 / 删一半失配 / 嵌套 / 边界 / **跨 text 节点分裂**（构造多个相邻 text 节点的段落，断言按 textblock 拼接后仍匹配到）。
- 验证删一个 `*` 后 decoration 立即消失（#7）；标记为真实文本可逐字符/整对删除（#8）。
- 与 `wysiwygSearchPlugin` 的 DecorationSet 共存不互相覆盖（独立 pluginKey，已具备，需测试确认）。
- IME 组合期不重算/不闪烁（复用 `imeCompositionGuardPlugin` 语义）。

### T5 — CSS 样式补齐（组件1 + 组件2 接缝）
- 确认 `MilkdownEditor.css` 有 `.md-marker-dim`（`var(--theme-marker-dim, <fallback>)`）与 `.md-strong`/`.md-em`/`.md-del`/`.md-code`（分别 `font-weight:700` / `font-style:italic` / `text-decoration:line-through` / 等宽字体+`var(--theme-code-accent,...)`，内容染色引对应 `--theme-*-accent`）。**缺则补**，且新变量都带 `var(fallback)` 兜底。
- 核对 `styles.css` 的 +12 行改动意图（是否变量全局兜底），确保 custom 主题（`theme-css.ts:134` `source==="custom"`）下标题/标记仍染色不退化为黑。

### T6 — 序列化保真验证（组件2 · #9，最高优先回归）
- **identity 往返逐语法分别单测**：`**b**`、`*i*`、`` `c` `` 各断言序列化后不被 `\` 转义；`~~s~~` 作对照（本就不在默认 unsafe 表）。
- 综合样本：4 语法混排 + frontmatter + MDX raw block + 本地图片路径，保存后与预期一致。
- **副作用回归**：行首 `#`/`>`/`[`/`1.` 等结构字符仍被正确转义（选择性 handler 只放行 4 字符）。
- `markdown-fidelity` 现有测试零回归。

### T7 — 组件1 视觉验收（#1–#4）
- H1–H6 亮/暗均染青蓝、非黑；`git diff` 确认**无任何 font-family/font 声明改动**（#3，手动 + grep）。
- 亮/暗切换配色协调无刺眼/低对比；custom 主题下走 fallback 仍染色。
- 参照图（Effie）的行高/段间距/列表缩进为主观项——若需精确对齐，向用户索取数值区间，否则标注 provisional。

### T8 — 收口
- `pnpm typecheck` + `pnpm test`（全包）+ `pnpm --filter @md-editor/editor-ui test` 全绿。
- 手动验证清单（见 `.omc/plans/wysiwyg-ui-route-d.md` 的 Verification Steps）逐项过。
- 汇报改动文件、新增单测、验证输出。

## 5. 关键 file:line 锚点（已核实）

| 位置 | 用途 |
|------|------|
| `packages/editor-ui/src/components/MilkdownEditor/MilkdownEditorPrimitive.tsx:448-461` | 插件链组装点（`.use(...)`），序列化经 `serializerCtx`(:282)、AI 插入经 `parserCtx`(:481) |
| `@milkdown/core@7.21.2/lib/index.js:139` | `remarkPluginsCtx.reduce` 组装点（`$remark` 注入处）|
| `@milkdown/core/lib/index.js:75-78,107-108` | `remarkStringifyOptionsCtx` 默认值 + `init` 重建 processor（自定义 handler 注入点）|
| `mdast-util-to-markdown@2.1.2/lib/handle/text.js` | 默认 text handler = `state.safe(...)`（一行）|
| `mdast-util-to-markdown/lib/unsafe.js` | `*`(:90 atBreak/:91 phrasing)、`_`(:132/:133)、`` ` ``(:136/:141)、`~`(:145 atBreak) 转义规则 |
| `mdast-util-to-markdown/lib/configure.js` | `handlers` 用 Object.assign（可覆盖）、`unsafe` 用 list（只能追加）|
| `micromark@4.0.2/lib/create-tokenizer.js:415` | `disable.null.includes(construct.name)` 按名禁用 |
| `micromark-core-commonmark/lib/attention.js:20` / `code-text.js:16` / `micromark-extension-gfm-strikethrough/lib/syntax.js:22` | 构造名 `attention`/`codeText`/`strikethrough` |
| `@milkdown/preset-commonmark@7.21.2/lib/index.js:2103` | `commonmark` 扁平 bundle 定义（granular 导出 emphasisSchema/strongSchema/inlineCodeSchema + inputRule/keymap/command）|
| `@milkdown/preset-gfm@7.21.2/lib/index.js:1037` | `gfm` 扁平 bundle 定义（strikethrough 散布 schema/keymap/command/markInputRules）|
| `apps/desktop/src/app/settings/built-in-themes.ts:41/82/127` | light/warm/dark 三套 scheme（新变量注入处）|
| `apps/desktop/src/app/settings/theme-css.ts:134` | custom 主题判定（新变量必须带 fallback 兜底）|
| `packages/editor-ui/src/components/MilkdownEditor/MilkdownEditor.css:238/246/248/285/329` | heading group / heading color / heading line-height / 段落间距 / `li::marker` |

## 6. 验收标准（对齐规格 #1–#9）

| # | 判据 | 归属 |
|---|------|------|
| #1 | H1–H6 亮/暗均染 `--theme-heading-accent`，非黑 | T7 |
| #2 | 段落/行高/list 缩进对齐 Effie 舒适密度（可能 provisional） | T7 |
| #3 | 字体族与改动前一致（无 font 声明变更）| T7 |
| #4 | 亮/暗切换配色协调、custom 主题走 fallback | T5/T7 |
| #5 | `**加粗**` 中 `**` 恒淡化可见、内部加粗+染色 | T4/T5 |
| #6 | `*`/`~~`/`` ` `` 同样标记淡化 + 内部对应样式 | T4/T5 |
| #7 | 删一 `*` → `**加粗*` 样式即消、显字面 | T4 |
| #8 | 标记为真实文本，可逐字符/整对删除 | T3/T4 |
| #9 | 磁盘 markdown identity 往返、标记不转义、保真零回归 | T6 |

## 7. No-Go 回退（若发现 spike 结论在真实 Editor 下不成立）

- **仅序列化转义无法消除** → 转「中间路线」（保留原生 mark + 封 input-rule/keymap/storedMarks/paste 四向量 + widget decoration 渲染字面标记），因原生 mark 经 `strongSchema` toMarkdown 天然正确序列化，绕开转义问题。
- **micromark disable 在真实 Editor 穿不透** → 路线 D 纯文本模型不成立，回退路线 C（光标邻近才显标记）或组件 2 延后、只交付组件 1（视觉优化独立可交付）。
- 触发回退前先回报用户，因涉及规格 #5「全程显示」的降级。
