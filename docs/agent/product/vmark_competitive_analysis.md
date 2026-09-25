# VMark 竞品分析与功能借鉴建议

> 用途：记录对竞品 VMark（vmark.app / `xiaolai/vmark`）的功能调研结论、可借鉴项、应拒绝项，以及落地时的架构边界归属，作为需求优先级调整的输入。
>
> 调研日期：2026-09-22
> **决策记录（opt-in 补记）**：本文档属 spec §12 列出的 opt-in 项（当时标注「未自动执行」），后经属主**显式批准执行**并落盘 —— 系主动选择性产出，非流程自动触发。
> 信息来源：`https://vmark.app/`、`https://github.com/xiaolai/vmark`（ISC License，已 shallow clone 通读 `website/guide/*.md` 全量产品文档 8853 行）与仓库 `src/` 结构
> 对照基线：[`markdown_editor_requirements.md`](./markdown_editor_requirements.md)、[`markdown_editor_task_priorities.md`](./markdown_editor_task_priorities.md)、[`markdown_editor_ai_feature_requirements.md`](./markdown_editor_ai_feature_requirements.md)、[`codemirror_renderer_migration_status.md`](../status/codemirror_renderer_migration_status.md)

---

## 1. 竞品概况

| 维度 | VMark | Inkpoint（本项目） |
|---|---|---|
| 一句话定位 | 纯文本工作台：人与 AI 协作读写同一批工件 | 面向技术写作者的 Typora 替代品 + MDX 组件 + AI 写作辅助 |
| 技术栈 | Tauri v2 + React 19 + **Tiptap(ProseMirror) + CodeMirror 6** | Tauri 2 + React 19 + **CodeMirror 6 单实例投影层** |
| 状态管理 | Zustand v5 | 自建 `editor-core` 文档协议 |
| 许可 | ISC（宽松） | GPL-3.0-or-later |
| 热度 | 526 stars / 87 forks | — |
| 覆盖格式 | Markdown / YAML / JSON / TOML / Mermaid / SVG / HTML + 9 种代码查看格式 | Markdown / MDX |
| 平台 | macOS 主，Windows/Linux best-effort | macOS / Win / Linux / Web / Android / iOS / uTools |
| 开发方式 | **"vibe-coded"，只收 issue 不收 PR** | 常规开源协作 |

**结论先行**：VMark 与我们目标用户高度重合（技术写作者 + 中文/东亚语境 + 本地优先 + AI 辅助），且同为 Tauri + React 技术栈，是一份**高质量的产品设计参考**，但由于它是双编辑器架构且不接受外部 PR（实现由 AI 全量生成），**只应抄产品设计与交互契约，不应抄实现**。

---

## 2. 战略层判断：我们的架构护城河

VMark 的 WYSIWYG 用 Tiptap/ProseMirror、Source 用 CodeMirror 6，是**两个编辑器实例**。这带来一串必须自建的补丁能力，其文档里专章描述：

- **Undo Across Modes**：模式切换要记录 checkpoint，靠遍历跨模式 checkpoint 链来"近似"统一撤销。
- **Reading Position**：Rich Text 与 Source 各自记忆阅读位置，切 tab / 切模式 / 磁盘重载都要手工恢复。
- **Split View 的一致性保证**：右侧预览必须"就是 WYSIWYG 渲染器"以避免漂移。

而我们是**同一 CM6 `EditorView` + 投影层**，Markdown 源文本是唯一事实源，模式切换只切 decoration/交互策略（见 [`codemirror_renderer_migration_status.md`](../status/codemirror_renderer_migration_status.md) 中 history/selection/scroll 自动保持的验证记录）。

> **战略结论**：这三项补丁能力对我们是**零成本天然拥有**的。这是本项目最重要的架构护城河，**在借鉴任何功能时都不得引入第二个编辑器运行时或双向同步层**（与 `markdown_editor_requirements.md` §4.2 的既定决策一致）。同时可以把它写进对外宣传：单引擎同构 = 模式切换零漂移。

---

## 3. 功能差距盘点（我们当前真实状态）

已核查仓库代码，非宣传口径：

| 能力 | 我们现状 | VMark |
|---|---|---|
| 搜索替换 | ✅ 已有 `renderer-codemirror/src/wysiwyg/search-panel.ts` | ✅ 含正则/全词/计数 |
| 命令面板 | ✅ 已有（G007，`Cmd/Ctrl+K`） | ✅ `Mod+Shift+P`，含 when 过滤 |
| 最近文件 | ✅ 已有 `file-system/src/recent-files.ts` | ✅ |
| 大纲面板 | ✅ 已有（含当前标题高亮 + 滚动同步） | ✅ 另有过滤输入框 |
| GFM 可视化表格 | ✅ 已有（M3，就地编辑 + 增删行列 + 对齐） | ✅ 另有 Fit-to-width 列宽 |
| 图片粘贴 / 拖拽 | ✅ 已有（含 `paste-image` / `drop-image-listener`） | ✅ 另有右键菜单与尺寸显示 |
| 代码块 | ✅ 已有（M2，高亮/行号/复制/Tab 缩进） | ✅ |
| Frontmatter 面板 | ✅ 已有（M1-FM） | ✅ 折叠式 |
| 快捷键自定义 | ✅ 已有 `settings/shortcuts/keys.ts` | ✅ 全量可自定义 |
| **自动配对 + Tab 跳出** | ⚠️ 部分：`wysiwyg/smart-pairs.ts` 仅做**选区包裹**；空光标自动闭合被**有意排除**（代码注释：保证连续输入 ``` 可创建代码块）；无 Tab 跳出 | ✅ 含 CJK 括号 |
| **行/块操作**（移/复/删/并/排序） | ⚠️ 部分：`wysiwyg/block-move.ts`（369 行）已有**块移动**（拖拽手柄 + 列表缩进归一 + 空行归一 + `addBlockBelow`）；无复制/删除/合并/排序命令，也未接进命令注册表 | ✅ 8 项行操作 |
| **Focus / Typewriter / 只读模式** | ❌ 无 | ✅ 三件套 |
| **Hot Exit / 会话恢复** | ❌ 无 | ✅ 全量含崩溃恢复 |
| **文档历史快照** | ❌ 无 | ✅ JSONL 按日分组 |
| **CJK 排版规则** | ❌ 无（仅字体配置） | ✅ **20+ 规则，产品卖点** |
| **Markdown Lint + 链接检查** | ❌ 无 | ✅ 13 条规则 + M001/M002 |
| **导出 HTML / PDF** | ❌ 无（PRD v0.3 待做） | ✅ 成熟产品设计 |
| **Source Peek 块级源码编辑** | ❌ 无 | ✅ `F5` |
| **智能粘贴（HTML/Word→MD）** | ❌ 无 | ✅ |
| **AI Genies（选区 AI 改写）** | ⚠️ 已有 `wysiwyg/suggestion.ts`（多条目建议 + `Tab` 接受 / `Mod-Enter` 接受 / `Esc` 取消 + ghost text + diff 高亮）与 `packages/ai`（completion/connector/document-context）；缺 Spotlight 选择器、scope 循环、prompt 历史、选区改写 genie | ✅ 13 个 genie + Spotlight |
| **MCP 集成** | ❌ 无 | ✅ 一键接入 6 个 AI CLI |
| 内联 `[TOC]` | ❌ 无 | ✅ |
| 文本清理 / 孤儿图片清理 | ❌ 无 | ✅ |
| 大文件阈值策略 | ⚠️ M6 有性能抽查但无明确阈值 | ✅ 1MB/5MB/50MB 分级 |
| 字体（拉丁/CJK/等宽分离）+ 缩放 | ⚠️ 有字体配置，未见快捷键缩放 | ✅ |
| 主题 | ✅ 5 款 | 6 款 |
| i18n | ✅ zh/en | 10 语言 |

---

## 4. 借鉴建议

优先级定义沿用 [`markdown_editor_task_priorities.md`](./markdown_editor_task_priorities.md) 的 P0/P1/P2 口径（P0 = 不做不能发版或会造成返工；P1 = 明显提升写作体验；P2 = 增强项）。

> 🔴 **【勘误 · 2026-09-22 · deep-interview + ralplan 共识评审后】**
> 下列 §4.2–§4.4 是调研初稿，其中若干建议**已被属主明确否决或被代码事实证伪**，以本勘误为准：
>
> 1. **§4.2「自动配对 + Tab 跳出」**：属主**明确否决「空光标自动补右半括号」**（含 CJK 括号）——原话「这个千万不要做，编辑起来手感很恶心」。这与仓库既有产品决策一致（`wysiwyg/smart-pairs.ts` 注释：「空光标状态下不进行任何自动闭合干扰」）。**最终只保留 Tab 跳出**，且其语义改为「光标位于或紧邻括号对/link 节点时移到右边界之后」（**非空对也跳**、嵌套取最内层、link/图片当整体）。CJK 括号**不做自动闭合**，但**参与跳出配对**。
> 2. **§4.3「行操作」**：裸行语义会破坏 Markdown 结构，已改为**块操作**（复用既有 `block-move.ts`）；且「合并/排序」两项已推迟。
> 3. **§4.4「无干扰三件套」**：只读模式推迟到 1.5 批；专注/打字机已落地，且实现采用**零 decoration 的 ViewPlugin 变体**（比本文原设想更安全）。
> 4. **本文遗漏的两个真实缺陷**（已修）：`acceptAiSuggestion` 缺 composing 门控；表格单元格 Tab 在 `flushCellCommit` **之后**才移动焦点（破坏零文本变更契约）。
> 5. **本文夸大的一处复用**：`link-projection.ts` 的 link range **无法**服务表格单元格内 link（`range-index.ts:410-418` 在 table 记录处停止下钻）。
> 6. **G006 视口过滤在生产是休眠的**（`projection-state.ts:185-197` probe 是有意 no-op），本文第 5 节若引用其性能收益需打折扣。

### S 级：立即做（高价值 / 低成本 / 强契合定位）

#### 4.1 CJK 排版规则（P0，杀手级差异化）

VMark 靠"终于有一个懂中文排版的编辑器"出圈，官网首屏主卖点。我们目标用户**就是中文技术写作者**，这是必争之地。

- 能力：CJK-拉丁间距、全角/半角标点归一、弯直引号智能配对、`「」『』（）【】《》` 配对、技术构造保护（URL / 版本号 / 时间 / 小数不被误改）、光标处引号风格切换。
- **架构归属**：属于**编辑器语义/文档模型**，实现应落在 `packages/renderer-codemirror`（输入事务拦截 + 文本改写）或独立 `packages/cjk-format` 纯函数包（规则表 + 纯文本变换，便于单测与复用到导出链路）。**不属于 AI 层**。
- **复用优先**（AGENTS.md 第 2 条）：优先调研 `pangu.js` / `@lint-md/...` 等成熟开源分词间距方案；规则表本身需要我们自建，因为带"技术构造保护"。
- 规则必须**逐条可配置、默认开启可整体关闭**，且改写必须走可撤销事务（不能绕过 history）。

#### 4.2 自动配对 + Tab 跳出（P0）

- CM6 官方 `@codemirror/autocomplete` 的 `closeBrackets` 直接可用，**几乎零成本**。
- 需自建部分：CJK 括号规则表、"Tab 跳出右括号"、WYSIWYG 下格式标记（`**bold**`）的配对与跳出、**代码块/行内代码内必须禁用**（VMark 已踩过这个坑，代码里的括号必须保字面）。
- **架构归属**：`renderer-codemirror` 的 keymap/input handler 层。

#### 4.3 行操作命令集（P0）

移动行上/下、复制行、删除行、合并行、去空行、升/降序排序。
- 多为 CM6 现成命令（`moveLineUp/Down`、`copyLineDown`、`deleteLine`、`joinLines`）+ 少量自研（排序）。
- **必须接入既有命令注册表**（G007 的 `registry` + `listByPlacement`/`listAvailable`），自动获得命令面板入口 + 可自定义快捷键 + when 过滤。
- **架构归属**：`editor-core` 的 Command 层。

#### 4.4 无干扰写作三件套：Focus / Typewriter / 只读（P1）

- **Focus Mode**：只保留当前块全透明、其余块降透明度。**我们是块级投影层，这个能力天然契合**（已有 block range model / `range-index.ts`，M3 表格已是块级 Widget），成本显著低于 VMark 在 ProseMirror 上的做法。
- **Typewriter Mode**：当前行垂直居中。CM6 `EditorView` scroll 控制即可，注意阈值防抖（VMark 明确提到"小阈值避免抖动"，这个坑要避开）。
- **Read-Only**：`EditorState.readOnly` + `EditorView.editable` compartment，注意与我们既有的 `protectedRanges` 语义区分（只读是全文级，protected 是范围级）。
- **架构归属**：`renderer-codemirror` 视图状态；开关命令走 `editor-core` Command 层。

#### 4.5 Hot Exit + 会话恢复（P1，"敢日常用"的信任基石）

- 保存：打开的 tab 与未保存内容、光标、撤销历史、UI 布局、窗口位置；崩溃后用周期性恢复快照；快照 7 天自动清理。
- **我们已有强基础**：`editor-core` 的 LF 不可变快照 / generation / revision、`file-system` 的有序保存与 checkpoint、Tauri 的 `SaveCommitGate` + 原子写。**恢复链路可以复用同一套快照与确定性语义，不需要另起一套状态系统**。
- 注意与现有"关闭前提示未保存"的关系：Hot Exit 后仍保留 dirty 标记（VMark 的做法正确）。
- **架构归属**：`file-system`（持久化）+ `editor-core`（快照语义）+ desktop 平台适配层（窗口/生命周期）。**不得把会话状态塞进 React 组件**（AGENTS.md 架构边界）。

#### 4.6 文档历史快照（P1）

- 自动快照、按日分组、恢复（恢复前先存一份当前快照）、单条删除、只对已保存文档生效。
- 我们已有 JSONL/快照与原子写基础，边际成本低。
- **架构归属**：`file-system` 拥有历史存储与清理策略；`editor-core` 提供"恢复为一次受控外部编辑"的入口（复用 external-edit port，天然可撤销）。

### A 级：纳入规划（中成本 / 明显差异化）

#### 4.7 AI Genies（P1，与我们 AI 路线完美同构）

VMark 的"选中文本 → `Mod+Y` Spotlight 选择器 → AI 改写 → 内联建议 → 接受/拒绝"，与我们已定的 **AI 显式续写：ghost text + `Tab` 接受 + `Esc` 取消**（见 [`markdown_editor_ai_feature_requirements.md`](./markdown_editor_ai_feature_requirements.md) §3.2）是**同一套 suggestion 展示/接受/取消/失效基础设施**，只是触发源从"续写"扩到"选区改写"。这是投入产出比最高的一条。

产品细节可直接吸收：
- Spotlight 单输入框，输入即过滤 name/description/category，无匹配时**降级为自由 prompt**；
- **Quick Chips**：选区场景下空输入时给出常用项（润色/精简/纠错/改写）；
- **两步提交**：自由 prompt 需 Enter 两次，防误触；
- **Scope 循环**：`Tab` 在 选区 → 块 → 文档 → 全部 之间循环；
- **Prompt 历史**：↑↓ 翻历史，`Ctrl+R` 打开可搜索历史，ghost text 预填最近匹配项；
- 处理态：思考指示 + 计时、`Esc` 取消、流式预览、Accept/Reject、错误 + Retry；
- 状态栏 AI 进度（转圈 + 计时 → Done 闪现 / 错误 + Retry）。

**架构归属（严格遵守 AGENTS.md 边界）**：
- `packages/ai` **只负责**：构造请求、调用模型、解析结果为结构化 suggestion，以及 provider 配置/失败分类。
- `packages/editor-core` + `renderer-codemirror` **负责**：suggestion 的展示、接受、取消、失效、选区映射与换行语义。
- genie 模板（prompt 定义）应作为**编译期内置数据**放独立模块，不进 AI 请求层。

#### 4.8 Markdown Lint + 本地链接检查（P1）

对"开源文档维护者 / 博客作者"用户群价值极高，且**规则可直接复用成熟开源**（AGENTS.md 第 2 条）：调研 `markdownlint` 作为规则引擎，我们只做 CM6 诊断投影与导航。

VMark 的链接检查设计可直接抄（`link-check.md`）：
- 只查本地相对路径（外部 URL、fragment-only 跳过）；fragment 由单独规则比对本文档标题；
- 相对源文件目录解析，百分号解码后再查；
- **异步并行 + 按解析后路径去重**；**绝不在每次按键触发**（明确的显式触发）；
- **容错降级**：`fs.exists` 抛权限错时判 `error`（跳过）而非 `missing`——"宁可漏报不可误报"，与我们 fail-closed/fail-open 的既有取舍一致；
- WYSIWYG 下诊断**按块左边缘标记**（不做行内下划线），Source 下用 CM6 诊断下划线 + gutter；`F2`/`Shift+F2` 跳转。

**架构归属**：规则引擎在独立包；**本地文件存在性检查必须通过 `packages/file-system` 的能力边界**，不允许 lint 模块自己碰 fs。

#### 4.9 导出 HTML / PDF（P1，PRD v0.3 既有项）

吸收 VMark 的产品设计，减少我们试错：
- HTML 导出**同时产出两个文件**：`index.html`（外链 `assets/`）+ `standalone.html`（全内联），不做模式选择——直接消灭一个设置项；
- PDF 导出用**自己的导出对话框**（纸张 A4/Letter/A3/Legal、方向、页边距预设 + 可拖拽自定义、字号、行高、**拉丁与 CJK 字体分开**、样式预设、页码），并产出带可点击标题大纲的 PDF；系统打印（`Cmd+P`）是**另一条独立路径**；
- **Copy as HTML** 与 **Copy Format**（把 Markdown 语法写进 `text/plain`）两个小命令，成本极低但很实用。

**架构归属**：导出模块必须与编辑器核心解耦（PRD §5.7 的 `Exporter` 接口），主题样式复用 `editor-ui` 的主题 token。PDF 建议复用 Tauri 的 print-to-PDF 或成熟开源排版引擎，不自研排版。

#### 4.10 Source Peek 块级源码编辑（P1，架构契合度最高）

`F5` 在 WYSIWYG 下针对**光标所在块**打开源码编辑浮层，`Cmd+Enter` 保存、`Esc` 取消、可开实时预览。用于"修表格语法 / 调列表缩进"这类真实痛点。

对我们而言这块成本异常低：**我们已有精确 block range model（`range-index.ts` 持有 fenced/indented 精确 ranges + block status），M3 表格已实现"块级 Widget + 就地编辑 + 受保护 transaction 回写 GFM 源码"**，Source Peek 是同一套能力的通用化。

**架构归属**：`renderer-codemirror`（块定位 + 受保护回写）；浮层 UI 在 `editor-ui`。可借鉴的边界：VMark 明确排除了已有专属编辑机制的块（代码块/图片/前端元数据/HTML 块/分割线）不走 Source Peek——这个排除表直接抄，避免重复交互。

#### 4.11 智能粘贴：HTML / Word → 干净 Markdown（P1）

真实场景：从网页、飞书、语雀、Word 搬内容。
- **复用开源**（AGENTS.md 第 2 条）：HTML→Markdown 用 `turndown`，不自研。
- 与我们已有的图片粘贴链路（`paste-image-listener.ts`）统一到同一个粘贴决策入口，注意**代码块内粘贴必须原样**（与 4.2 的禁用规则同源）。
- **架构归属**：粘贴策略属于编辑器交互语义（`renderer-codemirror` / `editor-core` 命令），转换器为独立纯函数依赖。

#### 4.12 MCP 集成（P2，但战略价值高）

让 Claude Code / Codex CLI / Gemini CLI 直接读写**正在编辑的文档**，"人与 AI 读写同一批工件、无翻译层"是 VMark 的核心叙事，也是我们「AI 时代编辑器」定位的真正护城河。

- 做法参考：作为 **Tauri sidecar** 打包 MCP server（VMark 的 `server/mcp` 构建为 `cli.js` 作为 external binary），设置页 **一键安装**到各 AI CLI；
- **隐私边界**：只绑定 `127.0.0.1`，不落任何云端凭据，与我们「本地优先、无私有云端绑定」承诺一致；
- **风险提示**：VMark 的知识库功能因 sidecar 分发问题**至今没有任何发布版包含该 runtime**（文档明确写出这个坑）。MCP sidecar 的**跨平台打包与分发必须先做技术尖刺**，否则会重蹈覆辙。

**架构归属**：MCP 是**接入层**，只做协议适配与命令转发；文档语义、保存确定性、冲突处理仍由 `editor-core` / `file-system` 拥有，MCP 写入必须走既有的受控外部编辑 port + 有序保存链路，**不得绕过 `SaveCommitGate`**。

### B 级：选择性吸收（小成本）

| 项 | 说明 | 归属 |
|---|---|---|
| 内联 `[TOC]` | 自生成目录、点击跳转、实时更新、导出保留 | renderer 投影 |
| 表格 Fit-to-width | 表格固定到编辑器宽度、列按内容比例分配；支持每表右键覆盖 | renderer 表格投影（M3 已有基础） |
| 文本清理 | 去尾随空格、合并空行、大小写转换 | editor-core 命令 |
| 孤儿图片清理 | 扫描 assets 中未被引用的图片 | file-system |
| 大文件阈值 | >1MB 自动进源码模式、>5MB 二次确认、>50MB 拒绝 | file-system + 平台层 |
| 大纲过滤框 | 按标题文本过滤、保留祖先链 | editor-ui |
| 字体缩放快捷键 | `Mod+=/-/0`，与设置项同一数值源，2px 步进 + 上下限 | editor-ui 设置 |
| 阅读位置保持 | 切 tab / 切模式 / 磁盘重载后回到原位（光标优先） | editor-core |
| 多光标增强 | `Mod+D` 选中下一处 / `Mod+Shift+L` 全选 / 纵向光标；**需代码围栏感知** | renderer |
| Smart Select All | `Mod+A` 按容器逐级扩大（单元格→行→表→文档） | renderer |

---

## 5. 明确不借鉴（守住产品边界）

VMark 的定位已从「Markdown 编辑器」漂移成「通用纯文本工作台」。以下项**与我们「Typora-like 单文档写作 + MDX」定位冲突，建议明确拒绝**：

| 项 | 拒绝理由 |
|---|---|
| **Split View（源码 + 预览双栏）** | 我们 PRD §5.1/§5.6 **明确决策单视图、不采用双栏**。VMark 提供它是双编辑器架构的补救，我们单引擎同构无此需求 |
| **Schema-aware 预览**（GitHub Actions 工作流图、Cargo.toml/`package.json` 依赖树、JSON/YAML/TOML 树） | 超出 Markdown 编辑器定位，等于重做半个 IDE |
| **集成终端** | 超出定位，且是巨大的安全/维护面 |
| **知识库 / 双链 / 反链 / 关系图谱 / Slidev** | 进入 Obsidian 领地，与「单文档写作」定位冲突。VMark 该功能至今未在任何发布版可用 |
| **Coherence 溯源层**（记录每份 AI 生成读过哪些文档，上游变更时标记下游过期） | 概念很有价值，但极重：需要 revision ledger + 依赖边 + stale/diverged 判定 + waiver 语义。与我们文档模型边界冲突。**建议仅作远期观察，不进路线图** |
| **云图床原生上传** | **学 VMark 的拒绝理由**（`cloud-images.md` 是极佳的决策范文）：会引入凭据保管库、多 S3 兼容厂商差异长尾、与 PicGo/PicList 重复造轮子。我们已有 `ImageStorageProvider` 接口（PRD §5.5）**留扩展点即可**，默认本地 provider，云端交给成熟开源 |
| **多格式打开**（YAML/JSON/TOML/SVG/代码查看） | 同上，定位漂移。保留 `.md`/`.mdx`/`.txt` 即可 |

---

## 6. 反向借鉴：VMark 的坑

1. **双编辑器架构的隐性成本**：Tiptap + CM6 双运行时，导致必须自建「跨模式撤销」「阅读位置恢复」「预览不漂移」三套补丁。我们单 CM6 投影层天然无此问题——**借鉴功能时严禁引入第二个编辑器**。
2. **"vibe-coded / 只收 issue 不收 PR"**：实现由 AI 全量生成且不接受外部贡献，代码质量与可维护性存在未知风险。**只抄产品设计与交互契约，不抄代码**。
3. **Sidecar 分发陷阱**：知识库依赖的 content server 因打包/分发问题，至今所有发布版都没有，功能被迫藏在 Developer Mode 后面。我们要做 MCP sidecar 时，**必须先做跨平台打包分发尖刺再动手写功能**。
4. **产品定位漂移**：从 Markdown 编辑器一路扩到通用纯文本工作台，功能面急剧膨胀（165 个快捷键、13 个 genie、6 个面板）。提醒我们**克制**：每加一个功能先回答"是否仍服务于技术写作"。

---

## 7. 建议的落地顺序

| 批次 | 内容 | 理由 |
|---|---|---|
| 第 1 批（手感） | 4.2 自动配对 + 4.3 行操作 + 4.4 无干扰三件套 | 复用 CM6 现成能力，1~2 天量级即可显著提升"好写"体感 |
| 第 2 批（差异化） | 4.1 CJK 排版 + 4.10 Source Peek | 我们目标用户的核心痛点 + 架构契合度最高，是对外可讲的两个卖点 |
| 第 3 批（信任） | 4.5 Hot Exit + 4.6 文档历史 | "敢当日常工具"的前提，复用既有快照/原子写基础 |
| 第 4 批（AI） | 4.7 AI Genies | 复用既有 suggestion 基础设施，是 AI 路线的自然延伸 |
| 第 5 批（专业） | 4.8 Lint/链接检查 + 4.9 导出 | 强依赖开源复用，独立并行 |
| 第 6 批（战略） | 4.12 MCP（先做分发尖刺） | 战略价值高但有分发风险，尖刺先行 |
| 随手 | B 级小项 | 穿插在各批次 |

---

## 8. 待确认事项

1. **CJK 排版默认策略**：规则默认全开还是逐条默认开？改写是否需要"首次提示"？涉及写作习惯，建议按规则分组提供默认预设。
2. **文档历史的存储位置与上限**：存文档同级 `.inkpoint/` 还是应用数据目录？是否需要容量上限与清理策略？（VMark 存工作区 `.vmark/` 且 git-friendly，值得讨论）
3. **MCP sidecar 的分发可行性**：需先出技术尖刺结论（各平台打包体积、签名、更新链路）再决定是否进路线图。
4. **导出 PDF 引擎选型**：Tauri print-to-PDF vs 开源排版引擎（如 Typst）需要一次小型评估。
