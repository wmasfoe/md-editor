# CodeMirror 6 Markdown 可视化编辑器架构方案

> 用途：定义从 Milkdown 迁移到 CodeMirror 6 后的产品行为、领域边界、状态模型、实现顺序和验收契约。
>
> 状态：**产品行为已确认；S1/M0 为 CM6-only beta 可用。M1/S2 核心和独立 M1-FM/S5-FM-only 已在单一 CM6 状态栈上完成自动化实现，renderer 122/122 与完整 Chromium 31/31 通过；macOS Tauri/WebKit N01-N10 仍待人工验收，因此暂不标记 M1/S2 或 M1-FM 完成。S3/S4、S5 HTML/MDX、M2-M6 仍未完成。**
>
> 本文是迁移目标和冲突决策的权威来源。迁移在 feature 分支上以单一 CM6 编辑器推进，不维护
> Milkdown / CM6 双运行时；未达到完整验收前可以发布明确标注缺口的 beta，但不得宣称迁移完成。

## 1. 决策摘要

目标底座是 CodeMirror 6（以下简称 CM6），但迁移动机不是“光标进入后显示行内 Markdown 标记”。产品已经确认：

- 加粗、斜体、删除线和行内代码的标记始终可见。
- 行内标记作为真实 Markdown 字符直接编辑，视觉上淡化，内容应用对应样式。

迁移的真正原因是当前 Milkdown / ProseMirror 树模型会把这些标记解析成 mark。为了让标记继续作为文本存在，现有路线需要：

1. 禁用原生 inline Markdown constructs。
2. 移除相应 schema、input rule、command 和 keymap。
3. 改写 serializer 的转义行为。
4. 再用正则和 decoration 重建视觉样式。

这条链路长期在绕开框架的原生文档模型。CM6 以 Markdown 文本作为编辑状态，Lezer 语法树只提供结构信息，因此能让“源码字符可编辑”和“视觉渲染”处于同一个模型内。

本方案同时锁定以下范围：

- WYSIWYG 和源码模式复用同一个 CM6 `EditorView`、撤销历史、选区和滚动状态。
- 保存时统一换行为 LF；不承诺保留原始 CRLF 或混合换行。
- 不设计通用第三方 Markdown 语法或渲染插件系统。
- MDX 首版只支持官方内置组件，不支持用户导入或运行第三方组件代码。
- 表格、代码块、Frontmatter、HTML 和 AI suggestion 都属于完整迁移验收范围；beta 可以暂缺，但必须公开记录缺口和降级行为。
- 实现、验证和文档状态必须同步更新，不能用目标架构描述冒充当前代码进度。

## 2. 目标与非目标

### 2.1 目标

1. Markdown 文本是编辑器内的内容事实源，不经过树模型序列化重建。
2. 两种模式只切换渲染策略，不切换编辑引擎或重建实例。
3. WYSIWYG 中保留日常写作所需的直接编辑体验，包括链接、列表、代码块和表格。
4. 未被用户主动编辑的 Frontmatter、MDX、HTML、图片地址和其他源码保持不变。
5. 编辑器交互语义集中在 CM6 renderer 层；AI/provider、Tauri 和 React 容器不重复计算选区或源码范围。
6. 迁移保留现有搜索、大纲、图片粘贴、AI suggestion、IME、选区和滚动行为。

### 2.2 非目标

- 不实现 Notion 式自由块拖拽或任意嵌套页面模型。
- 不提供通用第三方编辑器插件运行时。
- 不支持用户导入第三方 MDX React 组件。
- 不在首版实现 MDX props 表单或 children 可视化编辑。
- 不在首版把 Frontmatter 转换成字段表单。
- 不执行 Markdown 文件中的 JavaScript 或 MDX expression。

## 3. 术语与模式

本文继续使用产品上的“WYSIWYG 模式”，其准确含义是“基于 Markdown 源文本的可视化编辑模式”，不是隐藏所有源码字符的传统富文本模型。

- **WYSIWYG 模式**：启用可视化 decoration、block widget 和结构化交互。
- **源码模式**：关闭 WYSIWYG decoration，显示完整 Markdown / MDX 源码，仅保留语法高亮和源码编辑辅助。
- **活动范围**：当前任一光标或选区触碰的语法节点或行。
- **原子块**：WYSIWYG 中以整体方式选择和删除、不能在内部直接编辑的源码范围。

模式通过 CM6 `StateEffect` / `StateField` 切换。不得通过 React 条件渲染卸载 `EditorView`，也不得为两个模式分别保存 undo history。

## 4. 产品行为契约

### 4.0 默认渲染与编辑规则

- WYSIWYG 默认可视化渲染解析器能够识别的标准 CommonMark / GFM 语法。
- 本节后续的元素级契约优先于默认规则；例如行内强调 marker 始终可见，不能被“自动渲染”解释为隐藏。
- 没有专用 WYSIWYG 编辑契约的语法只负责可视化展示，修改时必须切换到全局源码模式。
- 不得为未设计的语法自动套用“光标进入后局部展开源码”行为。
- 解析失败或 renderer 尚未支持的节点必须保持源码，并采用明确的安全降级；不得丢失或静默改写内容。

### 4.1 行内强调语法

适用元素：

- 加粗：`**text**`、`__text__`
- 斜体：`*text*`、`_text_`
- 删除线：`~~text~~`
- 行内代码：`` `code` ``

WYSIWYG 行为：

- 开始和结束标记始终可见并淡化。
- 内容应用加粗、斜体、删除线或等宽样式。
- 光标移动不改变标记可见性。
- 标记始终是真实文本，可逐字符选择、删除和修改。
- 语法失效后样式立即消失，不用正则猜测 CommonMark 合法性。
- 嵌套、转义和 delimiter 合法性以解析器语法树为准。

实现上只使用 Mark decoration，不对标记使用 Replace decoration 或 atomic range。

### 4.2 标题

对 `# Heading`：

- 非活动标题行隐藏行首 `#` 和其后的分隔空格，并应用标题字号和样式。
- 任一光标或选区位于该标题行时显示完整源码。
- 显隐按整行活动状态切换，不要求光标进入隐藏标记。
- 标题标记不设为 atomic；否则会与“活动行立即显示”产生竞态。
- ATX H1-H6 都遵循相同规则。

Setext 标题按默认规则在 WYSIWYG 中可视化渲染。首版没有为它定义局部 marker 展开交互，修改其下划线语法时切换到全局源码模式。

### 4.3 引用、列表和任务列表

适用元素：

- 引用 `>`
- 无序列表 `-`、`*`、`+`
- 有序列表 `1.`
- 任务列表 `[ ]`、`[x]`

WYSIWYG 行为：

- 源码标记始终隐藏，不因光标进入而展开。
- 引用显示为引用块，列表显示缩进和列表 marker，任务项显示复选框。
- 任务复选框点击时只切换对应 `[ ]` / `[x]` 源码。
- Enter 延续当前列表项；空列表项 Enter 退出列表。
- Tab / Shift+Tab 调整列表层级。
- Backspace 在行首遵循列表解除和层级回退语义。
- 完整 marker 编辑统一进入源码模式。

这些交互属于 renderer 的 Markdown 编辑语义，不允许由桌面容器或 React 组件拼接字符串实现。

### 4.4 链接

对 `[label](url "title")`：

- 非活动状态只显示并保留可编辑的 `label`。
- 隐藏 `[`, `](`, URL、可选 title 和 `)`。
- 光标或选区进入链接 label 或触碰完整链接源码范围时，显示完整源码。
- 单击用于定位光标并展开源码；打开链接沿用现有编辑器的显式打开策略，不能抢占文本编辑点击。

链接不能实现成替换整个源码范围的 Widget。正确实现是保留 label 文本，分别隐藏外围标记和目标地址。

### 4.5 图片

对 `![alt](src "title")`：

- 非活动状态以图片 Widget 替换完整源码范围。
- 点击图片或选区触碰图片范围时显示完整源码；左右键从源码边界进入、上下键从相邻视觉行进入图片时，必须把折叠光标放进完整源码内部，同时在源码行下方保留实时图片预览。
- 活动预览由源码范围之外的 block point Widget 提供；源码仍是主 CM6 文档中的普通文本，不进入 atomic range，编辑 `alt`、`src` 或 `title` 后预览随 transaction 更新。
- 图片活动状态必须有稳定的源码选区或选中反馈，预览本身不能抢走文本 selection。
- 图片加载失败显示无边框、无底色的简洁可访问状态，保留 alt 和原始 source 信息，但不得改写 `src`。
- 相对路径只在渲染 adapter 中解析为预览 URL；保存仍使用原始相对路径。
- 删除图片必须删除完整 Markdown 图片范围。

图片 projection 和选择状态由同一个 StateField 驱动。非活动图片的 Replace range 是 atomic range；活动图片只保留 point Widget，不把已显示的源码标为 atomic。不能依赖“光标进入 atomic range”触发展开，因为常规光标移动会跳过 atomic range；最高优先级键盘命令必须在左右边界或 `EditorView.moveVertically` 的视觉落点命中图片时，先把 selection 转换为源码内部的真实折叠光标。鼠标点击仍使用完整源码范围选择，以保留整块复制和删除语义。

### 4.6 分割线

对 `---`、`***`、`___`：

- WYSIWYG 中始终渲染为横线，不展开源码。
- 点击，或左右键/上下键的移动目标命中分割线时，进入精确原子块选中状态并显示明确选中反馈；纵向移动必须消费 `EditorView.moveVertically` 的视觉落点，不能让 atomic range 把光标留在上一行。
- `Backspace` / `Delete` 删除完整分割线源码范围。
- 选区策略不得破坏跨块文本拖选。

继续遵守 [`wysiwyg_selection_integrity_spec.md`](../specs/wysiwyg_selection_integrity_spec.md) 中的分割线契约。

### 4.7 代码块

WYSIWYG 代码块不是源码围栏预览，而是直接可编辑的代码块：

- 隐藏 opening / closing fence 和 info string。
- 代码正文仍是主 CM6 文档的一部分，直接在原位置编辑。
- 根据 fence info string 提供语言选择和语法高亮。
- 提供可配置行号和复制按钮，视觉沿用当前代码块样式。
- 修改语言时通过 CM6 transaction 更新原始 fence info string。
- Tab、缩进、全选和代码块活动描边保持现有行为。
- 复制按钮只复制代码正文，不复制 fence。

代码块不创建第二个嵌套编辑器。优先复用 CM6 Markdown 的 fenced-code mixed parsing、line decoration、gutter marker 和 block widget，保证选区与 undo history 天然统一。

### 4.8 表格

标准 GFM 管道表格在 WYSIWYG 中渲染为可视化表格，并提供结构化编辑：

- 单元格直接编辑。
- Tab 在单元格之间移动；最后一个单元格的行为遵循最终选定表格引擎的默认规范。
- 支持增删行和列。
- 支持拖拽形成多单元格选区。
- 多单元格选区执行删除时清空全部选中单元格内容。
- 多单元格选区直接输入时编辑左上角单元格。
- 表格交互必须接入同一 CM6 undo / redo 历史。

首版不支持 Pandoc 多行表格、单元格合并或其他非 GFM 表格扩展。这些语法保持源码，必须在全局源码模式编辑，不得尝试按 GFM canonical serializer 改写。

表格不能手写一套临时网格状态机。技术 spike 必须评估成熟开源表格模型，至少验证：

- 多单元格选择与键盘导航。
- 动态行列。
- 自定义序列化和外部 state 控制。
- 与 React 19、Tauri WebView、主题和可访问性的兼容性。
- 许可证是否允许当前产品使用。

实现边界：

- Lezer 或 GFM AST 负责识别表格源码范围。
- 表格模型负责单元格坐标和选择。
- 每次确认编辑通过一个 CM6 transaction 替换对应表格源码。
- 未编辑表格必须保持原始源码；用户编辑后允许按明确的 GFM canonical serializer 格式化该表格。
- 网格获得焦点时，Mod-Z / Mod-Shift-Z 必须转发到主 CM6 history。

### 4.9 Frontmatter

文件开头的 YAML Frontmatter 继续沿用当前产品逻辑：

- WYSIWYG 中显示为无卡片、无标题栏的可编辑 YAML 元数据块。
- 正常状态不显示 `Frontmatter` 标题或 `YAML` 徽标；只在解析失败或 fence 未闭合时显示一行简短状态。
- 隐藏外层 `---` 分隔符。
- YAML 内容直接编辑并提供 YAML 高亮。
- 不转换成 title、date、tags 等表单字段。
- 未编辑时保持原始 Frontmatter 文本；用户编辑后只更新 Frontmatter 范围。
- 解析失败时在同一面板显示错误状态并保留可编辑原文，不得误判为分割线和 Setext 标题。

因此，`markdown-fidelity` 中 Frontmatter 识别和保真测试不能因迁移 CM6 被直接删除。可以删除的是 Milkdown 专用 preview fence 转换，不是 Frontmatter 领域能力本身。

当前实现边界（2026-07-18）：

- `markdown-fidelity.findFrontmatterSourceRange` 只负责 LF 文档中 offset 0 的 closed/unterminated 边界和 raw/content fidelity，不解析 YAML。
- `renderer-codemirror/markdown/frontmatter-yaml.ts` 直接使用 `@lezer/yaml` 生成 YAML token 与 diagnostic ranges；EOF/空白错误会钳制到可见字符，解析错误不阻断编辑。
- `renderer-codemirror/wysiwyg/frontmatter-projection.ts` 把 opening fence 替换为默认隐藏的 status Widget、隐藏 closing fence、为 YAML body 添加 line/Mark decorations，并只把 fence 放入 atomic/protected ranges。
- status Widget 在正常状态不占用可见标题内容，只在 YAML 错误或 fence 未闭合时显示状态；YAML 正文、光标与选择仍全部属于主编辑面。
- YAML body 没有被搬入 Widget、form、nested `EditorView` 或 contenteditable island；它仍是主 `.cm-content` 的普通文本，因此 selection、IME、clipboard 和 history 沿用主 CM6 状态。
- 未编辑源码不经过 serializer。用户编辑只产生命中正文范围的 CM6 change；全局保存仍遵循既有 LF 契约，不承诺恢复输入文件的 CRLF bytes。
- 本实现只完成 M1-FM 与 S5-FM-only；相邻 HTML/MDX 保持 raw/deferred，不启用 S5 HTML/MDX parser、sanitizer 或 Widget。

### 4.10 基础 HTML

首版只直接渲染受控白名单中的基础 HTML 标签：

- `span`
- `div`
- `br`
- `input`
- `button`

行为：

- 非活动节点真实渲染；`span`、`div`、`button` 的文本 children 保持可编辑。
- 光标或选区进入节点时，在原位置显示该节点完整的开始标签、属性和结束标签，允许直接编辑并保留标签结构。
- 嵌套节点只展开包含活动选区的最内层节点；祖先节点继续保持可视化渲染。
- `br`、`input` 等无文本节点非活动时以安全 Widget 展示，点击或选中后原位显示完整标签源码。
- `input` / `button` 只展示原生视觉，默认行为和状态写入必须被阻止；点击用于激活源码或定位选区。
- 不使用 iframe；内容直接渲染在编辑器文档中。

安全边界：

- 使用成熟 HTML sanitizer，并显式配置标签和属性白名单。
- 禁止 `script`、`style`、`iframe`、`object`、`embed`、表单提交能力和未知标签。
- 渲染 DOM 删除所有 `on*` 事件属性，但原始 Markdown 文本保持不变并可在活动源码中编辑。
- 禁止 `javascript:` 等危险 URL。
- 不允许 HTML 访问 Tauri API 或注入任意 React 组件。
- 不支持的 HTML 保留原始源码，并以安全占位块显示；不得静默删除。

基础 HTML 的最内层活动节点展开、可编辑 children、属性编辑和无文本 Widget 必须单独做 selection / IME spike。Shadow DOM 不是安全边界，本方案不依赖它隔离不可信代码。

验收示例：对 `<div><span class="tag">text</span></div>`，光标进入 `text` 时只原位显示 `<span class="tag">...</span>` 的完整标签和属性；外层 `div` 继续保持可视化渲染。

### 4.11 MDX 官方组件

首版只渲染应用内置并注册的官方 MDX 组件：

- `@md-editor/mdx-component-registry` 继续只保存 metadata、props schema、插入模板和查询 API。
- `@md-editor/mdx-plugins` 保存官方 React 组件，并导出 `officialMdxComponents`。
- renderer 根据 registry 识别组件，再从官方组件 map 取得可信实现。

WYSIWYG 行为：

- 默认真实渲染官方 React 组件。
- 点击组件后进入原子块选中状态并显示高亮描边。
- 组件后代中的链接、按钮、输入框和其他交互必须统一拦截为选中整个 MDX 组件，不执行组件内部行为。
- `Backspace` / `Delete` 删除整个 MDX 源码范围。
- 不在 WYSIWYG 中展开源码。
- 不提供 props 表单或 children 可视化编辑；修改统一进入源码模式。
- 未注册组件、语法错误、不支持的 expression 和 React 渲染异常统一显示安全占位块。
- 占位块同样支持选中描边和整块删除，原始源码保持不变。

MDX 解析必须使用成熟的 MDX parser 生成 AST 和精确源码范围，不能复用 `isLikelyMdxBlock` 正则作为正式解析器。首版不执行 import/export、JavaScript expression 或文档内任意代码；不满足静态渲染条件时 fail closed 到占位块。

## 5. 解析与渲染模型

### 5.1 单一 Markdown 文档

CM6 `EditorState.doc` 是活动编辑会话的权威文本。Lezer tree、block index、decoration、Widget 和 React 组件都是派生状态，不得反向成为保存事实源。

文档操作规则：

- 用户输入只通过 CM6 transaction 修改 `EditorState.doc`。
- renderer 的结构化操作也必须生成 CM6 transaction。
- `DocumentState.markdown` 是持久化和 React 订阅镜像；renderer transaction listener 通过带 origin/sequence 的 `applyEditorChange` 同步，并由 core 发出 `already-applied` acknowledgement。
- 保存先由 `DocumentState.beginSave` 固化当前 generation、content revision 和准确 LF Markdown，再由 FileService 写入 checkpoint 的 `markdownLf`；I/O 完成后统一通过 `settleSave` 原子更新 baseline/path/verification 状态，不能在异步返回后重新读取较新的 `EditorState.doc` 代替 checkpoint。
- `RuntimeFileService` 在 enqueue 调用同步保留 checkpoint 顺序和不回绕的 epoch runtime sequence；完整 native job 进入同一个 FIFO。transport reject、timeout、非法 payload 或 helper join failure 一律是 `indeterminate`，不能降级成可 promotion 的“未提交”。
- 同文档外部编辑先取得短生命周期 core reservation，再由 renderer 生成一个隔离 history transaction，最后用同一 operation id 和 renderer 实际 LF 文本 infallible finalize；reservation 不跨 Promise、timer 或 composition 生命周期。
- 外部打开或替换文件先通过 core `replaceDocument` 建立新的 document generation，再由 renderer 在同一个 `EditorView` 上安装新的 `EditorState`；只有明确文档边界重置 history。
- React 不把 `snapshot.markdown` 作为每次 render 都回灌的 controlled `value`；否则会破坏 history 和 selection。
- 同一文档的模式切换绝不能替换 `EditorState.doc`。

### 5.2 Parser 分工

- `@codemirror/lang-markdown` / `@lezer/markdown`：CommonMark、GFM、源码范围和增量语法树。
- Frontmatter：使用 `markdown-fidelity` 中经过测试的独立 top-matter range detector，优先级高于 HorizontalRule / SetextHeading；YAML 内容由 renderer 直接使用 `@lezer/yaml` 解析。
- Fenced code：使用 CM6 mixed parsing 和已注册语言支持。
- MDX：对 Lezer 识别出的候选 HTML/MDX 范围使用官方 MDX parser 做二次解析，不用自研 JSX 正则。
- HTML：使用标准 HTML parser 获取结构，再经过 sanitizer 白名单输出。
- 表格：使用成熟 GFM table parser / serializer 和成熟表格交互模型。

所有 parser 输出都必须包含稳定源码范围。解析失败是普通状态，必须显示源码或占位，不能抛出导致编辑器失效。

### 5.3 Decoration 索引

不能在每次 selection 变化时全量遍历文档并重建所有 decoration。

renderer 维护按源码范围索引的派生状态：

- 文档变化先用 `ChangeDesc` 映射未受影响范围。
- 只重新解析和重建 changed ranges 周围受语法影响的块。
- selection 变化只更新旧活动范围和新活动范围。
- Mark decoration 可按 visible ranges 计算。
- 会改变垂直布局的跨行 Replace / block widget 必须通过 CM6 允许影响布局的直接 decoration source 提供。
- 只承担视觉布局的块级 Replace 可以覆盖紧随源码块的换行，避免隐藏源码行留下重复行高；range index、protected/atomic range、复制和删除所有权仍只覆盖精确源码范围。
- Lezer `syntaxTree()` 可能是不完整树；需要明确 background parse、缺失范围安全降级和完成通知策略。
- Frontmatter 只在 offset 0 边界变化或其 block range 被编辑时重建；普通 selection 变化不重新解析 YAML。range fingerprint/coverage 不一致时移除 panel decoration 并显示原始源码。

大文件性能必须以迁移前后的固定 fixture 基线对比验收，不能以“Lezer 增量解析，所以不会卡”代替测试。

## 6. 包与职责边界

### 6.1 `@md-editor/editor-core`

继续负责：

- `DocumentState` 的不可变 snapshot、document generation、state/content revision 和有序 transition/snapshot 订阅
- LF 文件内容、saved baseline、persistence verification barrier 与 save checkpoint settlement
- 同文档外部编辑 reservation/finalize、文档边界、路径 metadata 和模式 CAS 契约
- `CommandRegistry` / `KeymapRegistry`
- `FeatureRegistry` / `EditorRuntime`
- 跨 UI 的编辑器命令和模式状态契约

不负责：

- CM6 Decoration、StateField、EditorView
- React Widget
- AI provider 请求和解析
- Tauri 或本地路径转换

`switchEditorModeSafely` 已退休 Markdown 序列化 adapter，改为 renderer port first，再用 generation/state revision CAS 提交 core；CAS 失败时通过 receipt 同步回滚 renderer。G006 已在 desktop 注入 typed renderer port，G007 已删除旧引擎调用链；G008 cleaner 又把 renderer port 收紧为必需参数，删除可绕过 renderer 的 core-only mode fallback。初轮独立复核后，core 与 desktop 进一步删除 snapshot-only `updateMarkdown` / `markSaved` / `updateSavedBaseline` / `setMode` 兼容 API 和 app/store helper，生产 mutation 只能通过有序 transition 或 renderer port 进入。

### 6.2 `@md-editor/renderer-codemirror`（新包）

这是 CM6 编辑器实现层，不叫 `renderer-core`，避免把浏览器、CM6 和 React 实现误称为核心协议。

负责：

- 创建和持有单一 `EditorView`
- WYSIWYG / source mode StateField
- Markdown 解析索引和 decorations
- HTML sanitizer、精确源码范围和最内层活动节点判定
- 链接、图片、标题、列表、分割线等交互语义
- GFM 表格 parse / serialize、表格和代码块 transaction
- MDX 原子块选择、后代事件拦截与 Widget 生命周期
- AI suggestion 展示、接受、取消和失效状态机
- selection、history、IME 和 scroll 的引擎内行为

G004 已新增 `packages/renderer-codemirror`，G005 在不扩展 S2-S5 语法范围的前提下补齐了 React bridge 所需的 S1 renderer 端口：

- 生产 factory 直接创建并持有原生 CM6 `EditorView`，不依赖 React wrapper。
- root extensions 持有 Markdown language、history、`EditorView.lineWrapping`、keymap、update listener 和 composition observer；mode 与 line number 分别由独立 `Compartment` 管理。源码与 WYSIWYG 共用 CM6 视觉行测量，长物理行和连续字符串在可读列内自动换行，不产生编辑器横向滚动。
- local renderer origin、external edit、mode、reconcile 和 line-number transaction 使用 typed annotation 区分，core acknowledgement 不生成 echo transaction。
- 同文档 external edit 使用一个 isolated history transaction；只有新的 `documentGeneration` 才创建新 `EditorState` 并对同一 view 调用 `setState`。
- composition 期间只保留一个 external request；浏览器 `compositionend` 等待 CM6 最终 DOM mutation flush 后再通知 bridge 重新 reservation。
- asset preview 只隐藏现有 host；renderer 通过 `setHostVisibility` 在 CM6 测量帧后恢复 focus-owned scroll，不卸载或重建 view。
- `@md-editor/renderer-codemirror/testing` 只提供 state-backed 用户事务模拟和只读 probe，不暴露可变 `EditorView` / `EditorState`。

G006 已由 desktop main 产品表面的 `DesktopCodeMirrorEditor` 挂载该组件。`source` / `wysiwyg` 现在只改变同一 renderer 的 mode，React rerender 和 asset preview 不切换编辑器组件。S1 原生验收反馈通过源码等宽字体与 WYSIWYG 正文字体提供最小可观察差异，同时保持右下角原有单图标透明模式按钮。G007 删除 Milkdown、ProseMirror、legacy SourceEditor、旧 wrapper/alias/helper 及其依赖后，后续 M1/S2 工作已在这个单一 renderer 内加入 range index、StateField、Decoration、Widget 与 atomic/protected ranges；该进展仍不能被写成 S3-S5 或完整可视化迁移完成。

不负责：

- AI 请求、provider 设置和模型响应解析
- 文件读写、图片落盘和 Tauri API
- 应用设置页面和 toast
- 第三方插件加载

### 6.3 `@md-editor/editor-ui`

负责：

- React 编辑器表面和工具栏容器
- 搜索面板、大纲和 MDX 插入菜单
- 注入官方 MDX component map
- 注入图片 URL resolver、打开链接 callback 和 UI 设置
- 将 renderer 事件接到现有 controller

React 层不得复制 selection、atomic range、表格序列化或 AI preview 失效逻辑。

G005 当前实现：

- `CodeMirrorEditor` 为每个稳定 host 创建一个 imperative renderer；普通 React rerender、mode、line number、font size 和 asset preview 不重建 `EditorView`。
- transition 订阅只驱动 renderer `sync/reconcile`；snapshot 订阅独立使用 `useSyncExternalStore` 使 React 元数据失效，不能把 `snapshot.markdown` 回灌成 controlled value。
- `EditorUiProvider` 注册唯一 active renderer 的 typed mode/external-edit/line-number/visibility/focus/measure ports；未挂载时返回 typed unavailable，不能静默成功。
- 同文档外部编辑在同步调用栈内完成 core reservation、renderer transaction 和 finalize/release；composition queue 只重试 readiness，不跨异步持有 reservation。
- 已删除 document remount key 与 source/Milkdown 之间的 scroll-ratio handoff；preview 是隐藏现有 editor host 的 sibling 表面，恢复顺序由 renderer 管理。
- 生产 React API 和 provider registry 都不暴露可变 `EditorView` / `EditorState`；只在测试子路径提供只读 probe。

G006-G007 desktop 接入与收口：

- `App.tsx` 对活动 Markdown 文档只挂载一个持久 `DesktopCodeMirrorEditor`；资源预览是绝对定位 sibling overlay，编辑器仅进入 `inert` / `aria-hidden` 状态，关闭后请求 CM measure。
- 新建、打开、最近文件、文件树、空文件夹和删除文档统一使用 `replaceDocument` 建立 generation boundary；rename/move 只使用 `setDocumentPath`，不会重置 dirty、baseline、history 或 generation。
- 同文档程序化修改只通过 renderer `applyExternalEdit` port；保存同步取得 checkpoint 并在第一个 `await` 前进入共享 FIFO，每个 typed outcome 只 settle 一次。
- `indeterminate` 保存进入 `verification-required`，即使 Markdown 等于 baseline 也继续触发放弃保护；更高已知成功才清除该状态。
- 12 个只打印日志的旧格式化命令不再注册；deferred 图片 paste/drop 全局监听已停用。MDX/AI 保留命令通过显式 immutable unsupported slots 返回 typed unsupported 并显示反馈，不允许静默成功或落入默认 no-op。

### 6.4 `@md-editor/file-system`

负责：

- 打开、目录树、图片落盘等平台无关文件服务协议
- 显式构造的 main-runtime `RuntimeFileService`
- checkpoint sequence 入队校验，以及 epoch 内不回绕的 runtime sequence 分配
- 覆盖完整 native save job 的单 FIFO
- native committed / warning / pre-commit failure / cancellation / superseded 结果分类
- transport reject、caller timeout、非法 payload 和未知执行阶段的 `indeterminate` 分类

不负责：

- `DocumentState` 的 baseline promotion 或 verification barrier
- Tauri caller 身份、原生 dialog、临时文件、sync 或 rename
- React 生命周期和 main/settings 表面路由

`main.tsx` 在 React `createRoot` 前按窗口 surface 分支。只有 `main` 依次动态加载并执行 `attachSaveRuntime -> createDesktopRuntimeFileService -> render App`，产生一个注入到 controller/file tree 的 `RuntimeFileService`；settings 只动态加载 `SettingsWindowApp`，未知 label fail closed。factory 模块求值本身不 attach、不 invoke、不构造 scheduler。

### 6.5 Tauri 保存提交边界

Rust app process 持有唯一 `SaveCommitGate`。`attach_save_runtime` 与 ordered save 都先读取 Tauri 注入的真实 `WebviewWindow` label；非 `main` caller 在 clone/lock gate、`spawn_blocking`、dialog 和文件副作用之前返回 typed rejection。请求参数不包含可伪造的 caller label。

通过授权后：

- attach 和 save 的 mutex/dialog/filesystem 工作只在 `spawn_blocking` closure 中执行，不让 guard 跨越 `.await`
- attach 与 save 共用同一 gate；reattach 递增 epoch/token 并退休旧 token
- admission 在任何 dialog/temp/write 前拒绝 retired epoch、zero/overflow 或非递增 sequence
- dialog、临时写入、`sync_all`、atomic rename 和提交后资源目录授权保持一个原生 critical job
- atomic rename 是 commit boundary；rename 前错误明确为 `not-committed`
- rename 后资源授权错误只生成 `asset-directory-registration-failed` warning，不能把已提交结果降级成失败
- caller timeout 不取消原生任务；gate 继续阻止更高任务越过未结束的低序列任务
- poisoned mutex 使用同一个 mutex/state 恢复，保留 epoch/high-water diagnostics，不创建第二把 gate

产品 main 保存只走显式 attach 后的 ordered service。G007 已删除旧 `save_markdown_document` Tauri command、TypeScript adapter、FileService 兼容方法和 Rust legacy job；生产图只保留 attach + ordered save handler，不再维护两种保存 API。

依赖方向固定为：

```txt
desktop ──adapters──> editor-ui ──> renderer-codemirror ──> editor-core
                              ├──typed map──> mdx-plugins
                              └──metadata───> mdx-component-registry

main bootstrap ──registration──> RuntimeFileService ──adapter──> Tauri SaveCommitGate
                                                              └──settlement──> editor-core
```

- `renderer-codemirror` 不依赖 `editor-ui`、desktop 或 `mdx-plugins`；官方组件通过 `editor-ui` 注入的 typed component map 获取。
- renderer 只消费 `mdx-component-registry` 的 metadata / descriptor，不硬编码官方组件名称。
- 图片预览 URL、链接打开、文件系统、AI 请求结果和平台设置通过 adapter 或纯数据注入。
- M0 的旧依赖删除条件已由 G007 满足：`editor-ui`、desktop、workspace catalog 和 lockfile 均不再包含 Milkdown、ProseMirror 或 `@uiw/react-codemirror`。历史文档可以保留框架名称，产品与测试运行图不得重新引入这些依赖。

### 6.4 其他现有包

- `@md-editor/markdown-fidelity`：保留 Frontmatter、图片路径、LF 规范化和源码范围保真能力；G007 删除旧编辑器路径时没有删除这些领域能力。
- `@md-editor/mdx-component-registry`：继续是 metadata-only 协议包。
- `@md-editor/mdx-plugins`：继续存放官方可信 React 组件。
- `@md-editor/ai`：只负责请求、provider、结果解析和纯 suggestion 数据。
- desktop：只负责平台能力、文件系统、设置、错误反馈和 adapter 注入。

依赖方向不得让 renderer 反向依赖 desktop 或具体 AI provider。

## 7. Widget 与原子选择

### 7.1 React Widget 生命周期

官方 MDX 和可视化表格需要 React Widget。实现必须遵守 CM6 `WidgetType` 生命周期：

- `toDOM()` 创建稳定容器并挂载 React root。
- `destroy()` 无条件卸载对应 root。
- `eq()` 只在语义模型完全等价时返回 true。
- props 变化优先实现 `updateDOM()`，避免无意义销毁重建。
- Widget 高度变化必须通知 CM6 测量，避免滚动位置跳动。
- root 引用使用类型安全的宿主对象或 `WeakMap`，不把任意字段挂到 DOM 的 `any` 属性上。

React 组件内部状态不是文档事实源。表格选择等需要跨重建保留的状态放入 renderer StateField 或独立受控模型。

### 7.2 原子范围不是展开触发器

`EditorView.atomicRanges` 只用于让光标移动和删除命令把隐藏范围视为整体，不能阻止程序化 selection 进入范围，也不会自动实现“点击后展开源码”。

每类元素必须定义显式触发：

- 图片：Widget 点击或 selection 触碰后显示完整源码，并在源码行下方保留实时 point Widget 预览；只有非活动 Replace range 是 atomic。
- 链接：label 中的普通光标 / selection 触发展开。
- 分割线、MDX：只进入原子块选中，不展开源码。
- 标题：按活动行显隐，不使用 atomic 触发。

所有 selection 变化、删除和拖选必须通过针对该元素的回归测试证明。

## 8. AI 功能迁移契约

迁移必须完整保留现有 continuation 和 edit replacement preview，不得降级为一个简单 ghost-text Widget。

renderer StateField 至少保存：

- suggestion request id
- anchor / selection 范围
- document version
- continuation
- anchored edit
- delete-only / insert-only / mixed preview model
- 当前可接受状态

必须保持：

1. Tab 优先接受 edit suggestion。
2. Mod/Ctrl+ArrowRight 只接受 continuation。
3. Escape 清除 suggestion。
4. 输入、点击、光标移动、选区变化、IME composition 或文档版本变化使 preview 失效。
5. 确认前不修改真实 Markdown 或 history。
6. original 不匹配、跨块、code block、rich inline 或几何信息不足时 fail closed。
7. 接受操作通过一个 CM6 transaction 修改文档并进入 undo history。

验收以 [`ai_edit_replacement_preview_spec.md`](../specs/ai_edit_replacement_preview_spec.md) 为准；迁移时更新其中 ProseMirror 专用措辞，但不得删除行为契约。

AI provider 仍只返回纯 suggestion 数据，不接触 CM6 selection 或 decoration。

## 9. 技术 Spike 与 Go/No-Go

S1 是切换到 CM6 单一编辑器路径前的硬门槛。G007 已完成旧编辑器删除和 E11/E12 自动化收口，G008 全仓自动化、cleaner、初轮复核修复后的重验、非交互 Tauri 启动冒烟和清洁独立复核也已通过；2026-07-18 测试规范要求的原生人工验收完成且产品确认无问题，因此 S1/M0 已达到 beta 可用门槛。S2-S6 继续在 CM6 单一实现上验证，不建立双运行时。历史提交和文档只作为行为对照，不再接收兼容性修改。

### S1：单实例与数据同步

验证：

- 一个 CM6 `EditorView` 切换两种模式。
- undo history、selection、scroll 在模式切换后保持。
- CM6 transaction 与 `DocumentState` 单向同步无 echo loop。
- 打开新文件正确重置 history，普通 React render 不重置 history。
- 保存输出统一 LF。
- Desktop 最小主链路已切换到 CM6，Milkdown 表面和仅服务旧解析/序列化链路的代码已删除，且不存在用户可见 editor engine toggle。

### S2：核心显隐与选择

最小 fixture 同时包含：

- 常驻行内 marker
- 活动标题行 marker
- 隐藏列表 marker
- 活动链接源码
- 图片源码展开
- 分割线原子选择
- 脚注、引用式链接、自动链接和 Setext 标题等未单列语法的自动可视化

验证键盘移动、鼠标点击、跨块拖选、Backspace / Delete、copy / paste、多选区和 IME；未定义专用编辑器的语法只能通过全局源码模式修改。

### S3：代码块

验证同一 CM6 文档中的 fence 隐藏、混合语言高亮、语言修改、行号、复制、Tab 和 undo，不创建嵌套编辑器。

### S4：可视化表格

先完成成熟开源表格引擎评估，再验证：

- GFM parse / serialize
- 非 GFM 表格不会进入网格编辑或被 GFM serializer 改写
- 多单元格选择
- Tab 和行列操作
- 编辑 transaction 与主 history
- Widget focus 与 Mod-Z
- 大表格滚动和主题

如果没有满足许可、可访问性和受控状态要求的成熟方案，不允许手写完整表格引擎后直接进入主迁移；应回报并重新裁剪表格范围。

### S5：Frontmatter、HTML、MDX

验证：

- Frontmatter 不再被误判为 HR / Setext heading。
- YAML 元数据面板可编辑且未编辑源码保持不变。
- HTML 白名单标签 children 可编辑，最内层活动节点原位显示完整标签和属性，危险行为只从渲染 DOM 移除。
- 官方 MDX 真实渲染、选中描边、后代交互拦截和整块删除。
- 未注册、语法错误、不支持 expression 和渲染异常进入占位块。
- React root 滚动进出视口无泄漏和明显闪烁。

S5 必须分开记账：`S5-FM` 是只验证 Frontmatter 的独立子 spike，并同时作为 M1-FM 的实现证据；它不得携带 HTML/MDX 工作，也不得把通过写成整个 S5 完成。当前 S5-FM 的单元与完整 Chromium 已通过，macOS Tauri/WebKit N08 仍待人工验收；S5 HTML/MDX 仍未开始。

### S6：性能基线

仓库没有在删除 Milkdown 前固化可复现的量化大文件结果；这个历史基线缺口不能从当前运行时补造。S6 必须建立 CM6 自身的 fixture、环境说明和结果，并在可获得的历史提交上做明确标注环境差异的对照：

- 首次打开耗时
- 连续输入延迟
- selection 移动耗时
- 快速滚动稳定性
- 模式切换耗时
- 峰值内存
- Widget mount / unmount 数量

完整迁移条件是 CM6 达到后续确定的产品性能门槛，并且 selection 变化不会触发全量 decoration 重建。缺失历史同环境对照不阻止当前功能体验 beta 可用，但必须作为 S6 风险记录，不能进入稳定发布或标记迁移完成。

## 10. 迁移里程碑

按以下顺序实施。S1 先行；其余 spike 与对应里程碑可以迭代推进，不要求为了保留 Milkdown 而等待全部 spike 结束：

| 里程碑 | 内容 | 完成证据 |
|---|---|---|
| M0 | 新建 `renderer-codemirror`；接入单一 EditorView、DocumentState、mode StateField；Desktop 切换到 CM6 并删除 Milkdown 编辑器路径 | S1 自动化回归 + 最小打开/编辑/保存 smoke |
| M1 | 行内 marker、标题、引用、列表、任务项、链接、图片、分割线、Frontmatter | S2 + selection / IME 测试 |
| M2 | 代码块完整交互 | S3 + 现有 code-block 回归 |
| M3 | 可视化表格完整交互 | S4 + table e2e |
| M4 | 基础 HTML 与官方 MDX | S5 + sanitizer / lifecycle 测试 |
| M5 | AI suggestion、搜索、大纲、图片粘贴、链接打开、滚动同步、主题与可访问性 | 现有 specs 和功能矩阵全绿 |
| M6 | 完成功能矩阵、性能、可访问性和发布收口，清理迁移期临时代码 | 全仓 typecheck、test、lint、build、手动验收 |

迁移不实现 Milkdown / CM6 功能开关、双运行时或双向翻译层。需要回退时使用 Git 分支或历史 commit，不在产品代码中维护第二套编辑器。

M0 通过后可以发布功能体验 beta。Beta 允许后续里程碑尚未完成，但必须列出缺失功能、安全降级、测试状态和已知风险。只有 M1-M5 功能矩阵及全部发布门槛通过后，才能完成 M6 并宣称迁移完成。

### 10.1 当前 CM6-only Beta 已知缺口

- M1 core / S2：核心 projection 与 G011 图片/编辑面修正已实现，renderer 122/122 与完整 Chromium 31/31 已通过；macOS Tauri/WebKit N01-N10 未取得人工结果前，不标记 M1/S2 完成。
- M1-FM / S5-FM-only：Frontmatter panel、YAML highlight/error、range-only edit、source copy 与 undo 已实现；原生 N08 待验。该结论不包括 HTML/MDX。
- M2 / S3：代码块语言选择、高亮工具栏、行号、复制和完整键盘交互尚未迁移。
- M3 / S4：GFM 可视化表格引擎选型、单元格直接编辑、多选、Tab、行列操作和主 history 接入尚未实现。
- M4 / S5：基础 HTML 白名单渲染、最内层标签展开、官方 MDX 真实渲染、原子选择和错误占位尚未实现；MDX 命令当前明确返回 typed unsupported。
- M5：AI suggestion、图片粘贴/拖放、链接打开、搜索 parity、完整大纲/主题/可访问性仍未迁移；AI 命令当前明确返回 typed unsupported。
- S6：删除旧引擎前没有留下可复现的同环境量化基线；CM6 大文件、输入延迟、滚动、内存和 Widget 生命周期数据仍待建立。
- 原生验收：2026-07-18 在 macOS 26.5（build 25F71）、系统 WebKit 21624、`tauri-cli 2.11.2` 环境完成；系统中文 IME、Save/Save As、settings 原生窗口隔离、asset preview、文档边界和真实文件 LF 均由产品验收确认无问题。
- 发布状态：G008 全量 typecheck/test/lint/build/Rust/browser、changed-file cleaner、初轮复核修复后的全量重验、非交互 Tauri 启动冒烟、清洁独立复核和必需原生人工证据均已通过；S1/M0 标记为 beta 可用。后续缺口仍阻止 M6 和稳定迁移完成声明。

## 11. 测试与验收

### 11.1 Parser / model 单测

- CommonMark / GFM 节点与精确源码范围。
- Frontmatter 优先级和错误降级。
- 链接 label / destination 分段。
- 图片、分割线、代码块、表格源码范围。
- MDX AST、literal props、children 和错误分类。
- HTML allowlist 与 sanitizer。
- GFM table parse / canonical serialize。
- 非 GFM 表格识别与源码保留。
- 未单列 CommonMark / GFM 节点的可视化默认规则和源码模式编辑回退。
- LF 输出规范。

### 11.2 Renderer 状态测试

- decoration 随 transaction 正确映射。
- selection 只重算旧、新活动范围。
- mode 切换不改变 doc / history / selection。
- 图片源码与实时预览并存、键盘进入图片时的源码内光标、链接展开、标题活动行。
- HTML 最内层活动节点展开和属性编辑。
- 分割线和 MDX 原子选择、整块删除。
- MDX 后代交互拦截。
- Widget `eq` / `updateDOM` / `destroy`。
- 表格编辑进入 CM6 history。
- AI preview 展示、失效、接受和取消。

### 11.3 浏览器 / Tauri E2E

S1 已建立 `apps/desktop/playwright.config.ts`、`test:browser` / `dev:e2e` 和 LF 严格的内存文件 fixture。E2E 模式运行真实 desktop `App` 与内存平台 adapter；`window.__MD_EDITOR_E2E__` 只在 Vite `e2e` mode 动态加载，暴露只读诊断和受控产品命令。独立 `CodeMirrorEditor` bridge harness 仍用于更窄的 React lifecycle 验证，两者都不进入 production bundle。

G005 bridge harness、G006 产品 Chromium 测试与 G007 E11 共同验证 S1 单实例主链路。M1/S2 与 M1-FM 当前 renderer 14 files / 122 tests、完整 Chromium 31/31 通过：验证 panel 位于唯一 `.cm-editor` / `.cm-content`、无 nested editor/input、隐藏 exact fences、YAML token/error、range edit、composition、undo、完整源码 clipboard、mode、stable view identity、selection-independent 更新和 invalid/unterminated 降级，并覆盖任务项、链接多选激活、活动图片源码与实时预览并存、成功/失败图片的横向和纵向键盘进入、`---` / `***` / `___` 的双向纵向原子选择、窄窗口长行自动换行且无横向滚动、失败占位、图片/分割线原子语义、跨块正反拖选、多选区及解析修复。macOS Tauri/WebKit N01-N10 仍是完成门槛。

S1 原生人工验收已覆盖系统中文 IME、Save/Save As、settings 原生窗口隔离、asset preview、文档边界和真实文件 LF；环境与逐项结论记录在 [`codemirror_renderer_migration_status.md`](../status/codemirror_renderer_migration_status.md)。下列后续 spike 行为仍必须逐项补齐：

- 跨段、列表、引用、图片和 Widget 拖选。
- 键盘-only 操作和 focus 顺序。
- 亮色、暗色和自定义主题。
- 本地相对图片路径。
- 代码块语言菜单、行号和复制。
- 表格多选、Tab、行列操作、undo / redo。
- MDX / HTML Widget 的点击、删除和错误占位。
- 大文件 fixture 性能。

### 11.4 全仓验证

每个实现里程碑至少运行对应 targeted tests。M6 前必须运行：

```bash
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

若 Tauri 环境可用，再运行 Rust tests 和桌面手动 smoke。

### 11.5 文档与 Beta 状态验收

- 每个 spike 和里程碑必须在同一变更中更新 [`codemirror_renderer_migration_status.md`](../status/codemirror_renderer_migration_status.md)。
- 状态只能使用“未开始”“进行中”“beta 可用”“已验证”“阻塞”，并附对应代码或验证证据。
- Beta 发布说明必须列出尚未完成的里程碑、用户可见缺口、安全降级和未运行的验证。
- 本文、产品需求、MDX 架构和状态文档发生冲突时，以本文已确认的产品契约为准，并立即逐项修订冲突章节。
- 不得因为目标方案已确认就把未实现能力写成当前能力，也不得因为 beta 可体验就标记完整迁移完成。

## 12. 退休与保留清单

### 12.1 G007 已退休

- Milkdown / ProseMirror 编辑器表面和依赖。
- `inlineMarkerPreset.ts`。
- `inlineSyntaxDecorationPlugin.ts`。
- Milkdown serializer / parser 专用的 raw preview rewrite 链路。
- Milkdown / CM6 双引擎切换所需的 serialize / restore adapter；迁移后不再保留该运行时路径。

### 12.2 必须保留或迁移

- `DocumentState`、commands、keymaps、features 和 runtime。
- Frontmatter、图片地址和 LF 规范化测试。
- `mdx-component-registry` 与 `mdx-plugins`。
- 图片粘贴和路径解析。
- 搜索、大纲、滚动同步和链接打开策略。
- AI suggestion 全部行为规范与测试。
- selection integrity 和中文 IME 规范。
- 当前代码块视觉和交互能力。

`markdown-fidelity` 可以在职责迁移完成后缩小或重命名，但不能因为“文本模型天然保真”而整包删除。

## 13. No-Go 与降级

- 单实例模式切换无法稳定保留 history / selection / scroll：停止完整迁移，先修复状态所有权。
- 图片、链接、分割线或 MDX 的 selection 行为破坏跨块拖选或 IME：停止进入下一里程碑。
- 可视化表格没有符合要求的成熟方案：回报并重新裁剪表格范围，不自行实现大型表格引擎。
- MDX parser 或 React Widget 生命周期不稳定：官方组件暂时降级为原子占位块，但源码保真和删除行为必须可用。
- HTML 可编辑 children 与安全白名单无法同时成立：HTML 降级为安全 raw block，不放宽脚本或事件权限。
- 大文件基线明显劣于已固化的 Milkdown 基准：beta 中如实记录并限制稳定发布，修复增量索引和 Widget 策略后重新评估。

任何降级必须更新本文、对应产品需求和测试规格，不得只在实现中静默改变行为。

## 14. 当前决策状态

已确认的产品决策：

- CM6 文本模型作为目标底座。
- 行内强调 marker 始终可见。
- 标题 marker 仅活动行显示。
- 引用、列表和任务 marker 在 WYSIWYG 中始终隐藏。
- 链接仅活动时显示完整源码。
- 图片非活动时由 Widget 替换源码；活动或选中时同时显示完整源码和实时图片预览。
- 分割线始终渲染并整块删除。
- 代码块直接编辑，支持语言、高亮、行号和复制。
- 表格可视化直接编辑，支持多单元格选择和行列操作。
- 可视化表格只支持标准 GFM 管道表格，其他表格语法保留源码。
- Frontmatter 使用无卡片标题的可编辑 YAML 元数据块，仅在异常时显示简短状态。
- 基础 HTML 白名单直接渲染；最内层活动节点原位显示完整标签和属性，控件默认行为不执行。
- MDX 仅支持官方内置组件，WYSIWYG 中原子选择和整块删除，后代交互统一拦截。
- 未单列的标准 CommonMark / GFM 语法默认可视化，没有专用交互时只能在全局源码模式修改。
- 模式切换保持同一 history、selection 和 scroll。
- 保存统一 LF。
- AI continuation / edit preview 完整保持。
- 首版不提供通用第三方插件或用户导入 MDX 组件。
- 迁移分支只维护 CM6 编辑器，不提供 Milkdown / CM6 切换；允许发布如实记录缺口的 beta。
- Beta 可用不等于迁移完成；只有 M6 验收通过才能宣称稳定迁移完成。
- 文档、实现和验证状态必须实时一致。

尚待技术验证而非产品确认的事项：

- 可视化表格开源引擎选型。
- 基础 HTML 可编辑 children 的 CM6 DOM / IME 稳定性。
- MDX AST 增量解析成本。
- block widget 全文索引与大文件性能。

G007 已完成 CM6-only 代码切换和自动化移除门禁，G008 自动化质量门禁、cleaner、初轮复核修复后的全量重验、非交互 Tauri 启动冒烟和清洁独立复核也已通过；2026-07-18 测试规范要求的原生人工证据完成，因此 S1/M0 标记为“beta 可用”。S2-S6 或 M1-M5 未完成时仍不得标记 M6 完成或宣称稳定迁移完成。
