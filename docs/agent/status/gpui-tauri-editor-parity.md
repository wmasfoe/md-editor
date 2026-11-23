# PR #280 合并后的 GPUI 编辑器差距与实施顺序

用途：供接下来修改桌面编辑器和 Web Playground 时拆 PR、定位代码和验收。**优先修复选中哪段就编辑哪段、重复格式命令可还原、粘贴图片能到达桌面存储这三条路径。** 旧版的逐块 Apply 流程已经退出，围绕它修草稿或美化卡片会改错入口。

## 比较基线

2026-11-20 已核对远端分支头。GPUI 取 `beta@0f951287`（PR #280），Tauri / CodeMirror 6 取 `main@c75390a6`。#279 将 Rust 升至 1.99，#281 修复 uTools 启动。本文依据固定提交的源码和测试定义；下列验收项是后续实现的完成条件，本次未启动两版应用做同机对照。[GPUI 合并记录](https://github.com/wmasfoe/md-editor/pull/280) · [Tauri 对照版本](https://github.com/wmasfoe/md-editor/tree/c75390a654bb6a0090cbfd21c00fb7f55ec9a247)

| 上一轮关心的问题 | 合并后的状态 | 本轮决定 |
| --- | --- | --- |
| 跨段写作、区块草稿、三种模式 | 桌面和 Playground 均挂载 `TypesetView`，直接编辑同一源文档，旧 `view.rs` 已删除。新视图有跨文本叶导航、撤销和 IME 接线。 | 在原生视图验证跨段选区、格式和命中。取消旧 Apply/Cancel、源码/分栏选区恢复及模式按钮的迁移任务。 |
| 中文输入、全选和撤销 | 新视图按运行平台绑定全选与撤销，并处理 UTF-16 平台输入范围。合并记录写明已在 macOS 简体拼音实机验证。 | 保留中文组合输入、一次撤销和「全选后立即加粗」回归，不重加旧 Web 输入框的 Cmd+A 补丁。 |
| 表格、图表、公式 | 已有单元格源范围和编辑测试；Mermaid 与 math 围栏可渲染图片，渲染失败保留源码。 | 继续核对表格结构操作、图表源码编辑、行内公式和 Tauri 语法覆盖。单元格可输入、围栏可显示各自只证明这一项。 |
| 设置、侧栏、大纲 | 已有独立设置窗口、系统/明暗主题、文件树和可点击大纲。桌面 README 仍描述三种编辑模式、设置未迁移和 Rust 1.98。 | 修设置到正文的接线，并在更新桌面使用说明时校正版本和入口。 |

合并时的职责划分和已验证范围见 [原生排版 ADR](https://github.com/wmasfoe/md-editor/blob/0f951287/docs/agent/architecture/adr_gpui_native_editor.md)、[架构说明](https://github.com/wmasfoe/md-editor/blob/0f951287/docs/agent/architecture/gpui_beta_architecture.md) 和[同一提交的桌面 README](https://github.com/wmasfoe/md-editor/blob/0f951287/apps/desktop/README.md)。

## 第一批：日常输入、选区和粘贴

### 1. 鼠标拖选与渲染文本命中

**代码证据。** 在 `TypesetView::render` 的鼠标移动回调中，先执行 `extend_to(drag_anchor)`，接着调用 `place_caret_from_click`。后者执行 `set_caret`，把刚建立的范围折叠为一个点。另外，点击按「文本叶源范围起点 + 排版命中偏移」换算。标题前缀和表格单元格已有专门处理；带隐藏 Markdown 定界符的行内文本能否逐字对齐，需用夹具验证。[事件顺序](https://github.com/wmasfoe/md-editor/blob/0f951287/packages/editor-gpui/src/typeset_view.rs#L896-L919) · [点击换算](https://github.com/wmasfoe/md-editor/blob/0f951287/packages/editor-gpui/src/typeset_view.rs#L1024-L1044) · [文本叶范围](https://github.com/wmasfoe/md-editor/blob/0f951287/packages/editor-typeset/src/lib.rs#L412-L518)

**改法。** 把命中位置计算与写入选区拆开。单击写入折叠光标，拖动使用按下时的 anchor 和当前命中的 head 一次设置有方向的选区。先给行内偏移写失败样例；确认有偏差时，在 `editor-typeset` 维护渲染位置与源字节位置的双向映射，让点击、光标、高亮和 IME 共用。

**验收。** 在一段含 `**中文**`、链接和 emoji 的文章里向前、向后拖选，再跨段拖选。检查高亮、复制文本和实际替换范围，一次撤销恢复原文与选区。再检查滚动后点击及中文候选框是否仍对准同一字。先跑 GPUI 事件测试，再在原生窗口验证鼠标手势。

### 2. 把格式命令做成真正的开关

**代码证据。** 桌面已绑定 Cmd+B、Cmd+I，格式菜单另有行内代码和删除线。四种 `Toggle*` 最终都调用 `wrap_selection`，重复执行会再包一层。Playground 注册了基础编辑键，桌面的格式绑定则在宿主 `main.rs`。Tauri 有处理空光标、选中正文和连同定界符一起选中的切换逻辑。[GPUI 命令执行](https://github.com/wmasfoe/md-editor/blob/0f951287/packages/editor-gpui/src/typeset_view.rs#L1097-L1143) · [桌面绑定](https://github.com/wmasfoe/md-editor/blob/0f951287/apps/desktop/src/main.rs) · [Tauri 格式行为](https://github.com/wmasfoe/md-editor/blob/c75390a6/packages/editor/src/wysiwyg/editing/markdown-formatting.ts)

**改法。** 在 `editor-core` 基于源范围产出添加或去除标记的 `SourceEdit`；在 `TypesetEditor` 走现有记录撤销的事务路径，保留选区方向。GPUI 在正文焦点内统一绑定四个命令，复用 `CommandKeys::for_os` 的平台规则；菜单和键盘调用同一操作，组合输入期间延后格式修改。移除桌面重复绑定。

**验收。** 对中文选区、反选、空光标、嵌套强调和已选中完整标记，各执行同一命令两次，比较原文和选区。桌面与 Chromium 都从真实按键触发；另测只读、搜索框或设置输入框获得焦点时不会修改正文。Web 用导出结果核对最终 Markdown。

### 3. 接通桌面图片粘贴

**代码证据。** `TypesetView::paste` 仅读取剪贴板文本。桌面仍有 `Workspace::paste_image`、资源写盘和 `insert_image_if_unchanged`；`FileAction::PasteImage` 的构造出现在未命名文档保存后继续粘贴的分支。普通粘贴入口缺少首次把图片交给宿主的步骤。[粘贴入口](https://github.com/wmasfoe/md-editor/blob/0f951287/packages/editor-gpui/src/typeset_view.rs#L409-L418) · [桌面存储与回写](https://github.com/wmasfoe/md-editor/blob/0f951287/apps/desktop/src/workspace.rs#L515-L563)

**改法。** 共享视图在粘贴时识别负载，记录 revision、selection 和组合输入状态，把图片交给可选的桌面处理器。桌面复用现有保存、落盘和回写流程；普通文本沿用原路径。异步完成时再次检查文档身份、版本和选区。

**验收。** 在已保存文档粘贴截图，检查只生成一份资源、只插入一条相对引用。覆盖首次另存、取消另存、打字或换文档后写盘才完成、只读和 IME 组合输入；这些场景都不能把引用写到错误位置。单独测带文本和图片两种表示的剪贴板条目。

## 第二批：让桌面上可见的控件与行为一致

| 改动 | 具体做法 | 验收 |
| --- | --- | --- |
| 字号、字体与正文宽度 | 设置已读写字体和字号，正文渲染仍传固定的 `BODY_FONT_SIZE`。由桌面观察偏好、向共享视图注入排版参数；视图重算几何并保留文档位置。用同一篇长文比较 Tauri 与 GPUI 的行长、段间距和标题层级后再定阅读宽度。 | 字号从 13 调至 22 后，已打开的文章立即改变换行，点击仍命中同一字，重启保留设置。分别检查侧栏展开、收起及窄窗口。 |
| 行号、标记和 Markdown lint | 这三项有设置控件与持久化字段。先分别接入代码块行号、行内语法显示、诊断与定位；能力交付前让控件如实显示可用状态。 | 每个可用开关都要用一个可观察结果验证。仅有配置读写测试不足以验收正文效果。 |
| 模式与快捷键说明 | 设置仍列出「Switch editor mode」，主窗口绑定 Cmd+/，但宿主映射返回 `None`；标题栏的 Typeset 按钮仅聚焦编辑器。移除失效绑定和说明或明确标为聚焦动作。快捷键列表复用真实动作及运行平台修饰键。 | 从菜单、设置和键盘逐项比对，显示的命令均可执行；大纲仍能开关并跳转。若产品需要完整源码视图，单独设计其选区、撤销与保存契约。 |

证据见[设置读写](https://github.com/wmasfoe/md-editor/blob/0f951287/apps/desktop/src/settings/preferences.rs)、[设置窗口](https://github.com/wmasfoe/md-editor/blob/0f951287/apps/desktop/src/settings/view.rs)、[正文渲染](https://github.com/wmasfoe/md-editor/blob/0f951287/packages/editor-gpui/src/typeset_view.rs#L850-L874) 和[宿主命令映射](https://github.com/wmasfoe/md-editor/blob/0f951287/apps/desktop/src/workspace/chrome.rs#L677-L698)。

## 后续能力与依赖

| 顺序 | Tauri 能力与 GPUI 现状 | 实施方式和完成条件 |
| --- | --- | --- |
| 优先保护写作成果 | GPUI 已有手动保存、脏状态提示和外部修改检查。会话草稿恢复、持久文档历史仍待迁移。 | 桌面在编辑事务后记录草稿和选区，先交付异常退出恢复；再做历史列表、差异查看和显式还原。验证无路径草稿、磁盘文件被外部更改、恢复中文光标，以及还原后仍可撤销。[Tauri 恢复测试](https://github.com/wmasfoe/md-editor/blob/c75390a6/apps/desktop/tests/hot-exit-cursor.test.ts) |
| 再补高频编辑与检索 | Tauri 有文内查找、表格结构编辑和命令面板；GPUI 已能编辑单元格，回车入口直接插入换行。 | 查找由文档层返回源范围，视图选中并滚动；列表续项与退出、表格 Tab 导航和增删行列分别定义事务。等真实动作与快捷键统一后，再接命令面板与自定义键位。用长文下一处匹配、空列表退出和同表跨格撤销逐项验收。[Tauri 查找](https://github.com/wmasfoe/md-editor/blob/c75390a6/packages/editor/src/wysiwyg/view/search-panel.ts) · [表格编辑](https://github.com/wmasfoe/md-editor/blob/c75390a6/packages/editor/src/wysiwyg/editing/table-editing.ts) |
| 按真实文档补渲染与输出 | Mermaid/math 围栏已有原生静态渲染。外部插件、完整 MDX 工作流、HTML/PDF 导出，以及本地续写之外的 AI 纠错和风格学习，需独立排期。 | 先用同一组文档逐项比对链接、图片、行内公式、容器和图表；记录哪些能显示、哪些能原位编辑、哪些仅显示源码。导出独立检查中文、图片和分页；插件与 AI 分别验证运行时、异步结果过期和撤销。Quick Look、更新与遥测另归桌面分发。[原生图表覆盖边界](https://github.com/wmasfoe/md-editor/blob/0f951287/docs/agent/architecture/adr_gpui_native_editor.md) · [Tauri 导出入口](https://github.com/wmasfoe/md-editor/blob/c75390a6/apps/desktop/src/app/controller/export-controller.ts) |

**性能待测。** 每次成功编辑会重解析文档，图表可能重复光栅化，撤销保存整篇快照。先在短文、长文和含多张图表的文章上记录同机输入延迟与撤销内存；确认瓶颈后，再选择缓存图像、局部重排或缩减历史内存。当前没有两版同机数据支持速度结论。[重解析路径](https://github.com/wmasfoe/md-editor/blob/0f951287/packages/editor-gpui/src/typeset_view.rs#L221-L257) · [设计取舍](https://github.com/wmasfoe/md-editor/blob/0f951287/docs/agent/architecture/adr_gpui_native_editor.md)

## 上一轮工作树如何接续

本地未提交补丁基于 `4f1c77b7`。开工时从已合并的 beta 建独立分支，逐项移植并验证。

- **可复用**：`packages/editor-core` 中格式切换的纯函数与中文往返测试，`apps/web/tests/gpui-playground.spec.ts` 中按键后核对导出原文的用例。接到新 `TypesetEditor` 后补反选、IME 与撤销用例。
- **需要重接**：旧 `shortcuts.rs`、桌面和浏览器启动处的格式绑定。以新视图已有的键位上下文和宿主菜单为准；全选走已合并的运行平台绑定。
- **结束维护**：旧 `view.rs` 的区块草稿、Apply/Cancel、三模式工具栏及相应导出。保留其用户目标：同一文档连续输入、选区稳定、宽窄窗口都能阅读，再在新视图验证。

每批语义改动先跑 `cargo test --locked -p inkpoint-editor-core -p inkpoint-editor-typeset -p inkpoint-editor-gpui`。涉及浏览器的改动重新构建 `pnpm --filter @md-editor/web build`，再跑 `pnpm --filter @md-editor/web test:browser`。涉及原生剪贴板、主题或输入法时，用 `pnpm dev:desktop` 核验对应操作。旧视图上的通过记录只作回归用例来源。
