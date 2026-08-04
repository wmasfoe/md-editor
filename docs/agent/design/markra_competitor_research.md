# Markra 竞品调研:渲染器实现方案与排版设计

> 调研日期:2026-08-04
> 调研对象:GitHub 仓库 `https://github.com/markrahq/markra`(本地克隆于 `/tmp/markra-research`,commit `bd17942`,tag v2.5.4,发布于 2026-08-04,AGPL-3.0 全开源)+ 官网 `https://markra.app`(web_extract 抓取于 2026-08-04)
> 结论性质:全部重要结论均基于源码/官网证据,出处已标注;无编造内容。
> 与 md-editor 的关系:Markra 与我们同为 **Tauri 2 + React + pnpm monorepo + CodeMirror 6 路线的本地优先 WYSIWYG Markdown 桌面编辑器**,且其核心渲染方案(语法树 → 装饰/widget)与我们自研的三层渲染器同构,是最直接、最有参考价值的竞品。

---

## 0. 项目概况(证据:README.md、root package.json、CHANGELOG.md)

- **定位**:local-first 的 WYSIWYG Markdown 桌面编辑器 + 原生 AI 工作流("quiet, local-first WYSIWYG Markdown editor with AI built into the writing workflow",PRODUCT.md)。
- **形态**:桌面端 Tauri 2(`apps/desktop`,package.json 依赖 `@tauri-apps/api@2.11.0` 及 dialog/log/os/process/store/updater 插件)+ Web 端(`apps/web`,`editor.markra.app`)。
- **仓库规模**:pnpm monorepo,`packages/`: `editor`(编辑器内核)、`editor-react`(React 桥)、`markdown`(unified/remark 辅助管线)、`app`(应用层 UI)、`ai`、`providers`、`ui`、`shared`。编辑器内核 `packages/editor/src/codemirror/` 下有 80 个 TS 文件、约 2.7 万行,含大量单测。
- **活跃度**:v2.5.4 于 2026-08-04(即调研当天)发布,CHANGELOG 显示近几日持续修复「live preview 输入延迟」「空行高度抖动」「代码块交互」等,非常活跃。
- **商业模式**:免费 + AGPL-3.0,与我们的产品定位(本地优先、源码透明)高度重合,可放心深挖其实现。

---

## A. 技术栈与渲染架构

### A.1 一句话概括

> **Markra = CodeMirror 6(编辑器宿主)+ @lezer/markdown(官方增量解析器,GFM 扩展)+ 自研 livePreview 装饰层(遍历语法树、按节点名派发到 renderer registry、输出 replace/mark/line/widget 装饰)+ 源码即文档(无独立 AST/序列化)。**

### A.2 依赖证据(packages/editor/package.json)

- 编辑核心:`@codemirror/state/view/commands/language/search`、`@lezer/markdown@1.6.3`、`@lezer/highlight`、`@codemirror/lang-markdown@6.5.0`
- 富渲染:`katex@0.16.45`(公式)、`lowlight@3.3.0`(代码高亮,highlight.js 的 AST 版)、`mermaid@11.15.0`(图表)、`turndown@7.2.4`(HTML→Markdown,用于粘贴/剪贴板)
- 辅助:`remark-frontmatter`、`remark-math`(编辑器内核内)、`@replit/codemirror-vim`(Vim 模式)、`cspell-trie-lib`(拼写检查)、`lucide`(图标)
- `packages/markdown/package.json`:`unified@11` + `remark-parse@11` + `remark-gfm` + `remark-math` + `mdast-util-to-string` —— **unified 管线只用于大纲提取、字数统计、标题清洗等辅助功能(见 `packages/markdown/src/markdown.ts`),不是主编辑引擎**。
- `packages/app/package.json`:`@dnd-kit/core+sortable`(文件树/面板拖拽)、`@tanstack/react-virtual`(虚拟列表)、`react-markdown`(导出/渲染辅助)、`codemirror`(minimalSetup 组装,见 CodeMirrorPaperSurface.tsx)。

### A.3 渲染管线(核心证据:packages/editor/src/codemirror/preview.ts、renderers.ts、plugin.ts、index.ts)

完整链路:

```
CM6 EditorState.doc(就是 Markdown 源码文本,无独立文档模型)
  → @lezer/markdown 增量解析(syntaxTree(state),GFM + 自定义 markraHighlight 扩展)
  → livePreview ViewPlugin(preview.ts):按 view.visibleRanges 局部遍历语法树
      ├─ 基础装饰:块级 class(Paragraph/Blockquote)、行内 class(Strong/Emphasis/InlineCode/Link...)、
      │   aria 语义(role=heading + aria-level)、列表行属性(data-list-depth/kind/marker)
      ├─ renderer registry 派发(renderers.ts):按 lezer 节点名查注册的 MarkraRenderer,执行 render()
      │   → 渲染器通过 context.add() 追加 Decoration(block/widget 预览),返回 false 表示"认领该节点"
      │   → scope 分两级:"visible-range"(每可见区间都跑)/ "node"(只跑一次)
      ├─ 语法标记隐藏:HIDEABLE_MARKS(HeaderMark/EmphasisMark/CodeMark/QuoteMark/LinkMark/
      │   ListMark/LinkTitle/HighlightMark)在"未 reveal"时用 Decoration.replace 隐藏(源码→富渲染)
      └─ 输出 Decoration.set(ranges, true) 交给 CM6 绘制
```

- **"源码即真理"**:文档模型就是 Markdown 文本,不需要序列化回 Markdown(导出 HTML/PDF 另走 DOM 管线,见 `packages/app/src/lib/document-export.ts`)。这与 ProseMirror 路线(JSON 文档模型 + 序列化)本质不同,与我们的自研 CM6 渲染器路线一致。
- **reveal 策略(核心交互概念)**:`policy.ts` 的 `revealActiveLine` + preview.ts 中 `isRevealed()` —— 光标所在行/节点显示 Markdown 源码标记(可编辑),光标远离时隐藏语法标记、展示富渲染。细化点:
  - 链接的 LinkMark 按"节点边界(node-boundary)"成对 reveal(`preview.ts` LINK_SYNTAX 分支),避免只显示一半 `[]()`。
  - 成对内联标记(Emphasis/Strong/InlineCode 等)整体 reveal(`INLINE_WRAPPER_MARKS` 分支)。
  - `typedBoundary`:刚键入完成的节点保留闭合符显示,防止"刚打完 `**text**` 立即消失"。
  - 标题标记可选 `hideHeadingMarkersOnFocus`(聚焦时也隐藏 #,进入标题行才显示源码)。
  - `pushHiddenRange()` 按行切分隐藏区间,避免跨行 replace 破坏 CM6 约束,并兼容第三方 parser 组合。
- **性能策略(直接可抄)**:只遍历 `visibleRanges`;纯文本输入且光标在顶层段落时直接 `decorations.map(changes)` 不重建(plainTextInputCanMapDecorations);IME composition 期间只 map 不重建(注释明确说明重建会取消输入法);CHANGELOG 显示近期持续优化输入延迟(#638 deferred rendering)。
- **插件/命令注册表(`plugin.ts`)**:`MarkraPlugin = { id, extension, commands, ui }`;命令带 `isActive/isEnabled/run + keybindings`,UI contribution 声明 `placement`(toolbar/selection-toolbar/slash-menu/context-menu)与 `when`;工具栏、选区工具栏、斜杠菜单、右键菜单统一从 registry 拉取(`listMarkraUi/searchMarkraUi`)。这是"编辑器内核 + 应用层命令"的干净解耦,值得借鉴。

### A.4 编辑模式

- **默认 WYSIWYG(即时渲染)**,Markdown 语法在光标处"浮现"——Typora 式混合模式,非源码编辑器、也非 Notion 式纯块编辑器。
- **一键源码模式**:README 明确 "full source mode one click away";`styles.css` 有 `.markdown-source-paper` 独立样式(源码模式下语法字符用低强调色 `--editor-markdown-syntax-color`)。
- 没有 ProseMirror、没有 Milkdown、没有 markdown-it、没有 unified 主渲染——**全部编辑渲染都在 CM6 装饰层完成**,与我们的技术判断一致。

---

## B. 排版设计

### B.1 设计 token 系统(证据:DESIGN.md,仓库根目录,含完整 YAML token)

- **字体栈**:`"Noto Sans SC Variable", "Noto Sans SC", "Noto Sans CJK SC", sans-serif`(全部文本,含编辑器正文;中文优先的设计,`@fontsource-variable/noto-sans-sc` 打进包里)。
- **正文 editor-body**:16px / weight 400 / line-height **1.65** / letter-spacing 0。
- **标题**:editor-h1 **44px / 760 / 1.15**;h2 31px / 760 / 1.22;h3 24px / 760 / 1.28(760 是非标准字重,配合 Variable 字体)。
- **UI 文本**:ui-body 13px/520、ui-label 12px/560、ui-control 12px/620。
- **间距**:editor-block 18px(块间距)、editor-section 36px(节间距)、panel-width 384px(侧栏宽)。
- **颜色**:ink-black 主色 `#1A1C1E`(交互/焦点/选中,不泛滥);文本 `#555555`、强文本 `#333333`、弱文本 `#999999`;**markdown-syntax `#D7D5D5`(极低对比的语法色)**;边框 `#EEEEEE`/`#DDDDDD`;多层 surface(#FAFAFA→#F5F5F5)。
- 设计原则(PRODUCT.md / DESIGN.md):"Writing First,界面让位于文档";light/neutral/editorial,禁装饰性品牌元素。

### B.2 编辑器"纸面"与阅读宽度

- 编辑器为**居中单栏 paper**(截图证据:assets/screenshots/editor-workspace.png,内容区约占屏宽 60-70%,两侧留白)。
- 宽度**可拖拽调整**:`EditorWidthResizer.tsx`(min 480px 起,clamp 到 max,拖拽时 col-resize + 禁选)。
- 字号、行高、宽度均可设置(README "Adjustable writing width, font size, and line height")。
- CM6 集成:`paperTheme`(`CodeMirrorPaperSurface.tsx`)隐藏 gutter、`overflow: visible`、`.cm-content` 透明背景,由外层 CSS 控制纸面宽度与行高(styles.css `.markdown-paper`)。

### B.3 各元素视觉与交互(证据:theme.ts、各 preview 插件、截图)

| 元素 | 方案 | 关键实现 |
|---|---|---|
| 标题 | 仅字号+字重区分层级,**无 # 标记、无 H 徽章**(截图证据);h1 约 1.8em/700/1.35 | theme.ts `.cm-markra-h1..h6`;aria:role=heading + aria-level(preview.ts) |
| 段落 | 空行本身保持稳定高度(不折叠,避免打字跳动,CHANGELOG #637);相邻块时加 `cm-markra-paragraph-end` 内边距 | preview.ts 空行 line 装饰 + blank-lines.ts |
| 引用块 | 左侧 0.2em 半透明竖线 + 文字淡化 72% | theme.ts `.cm-markra-blockquote` |
| 行内代码 | 圆角 0.3em、`currentColor 9%` 混合底、等宽字体、0.08/0.28em 内边距 | theme.ts |
| 链接 | 蓝色 #2563eb + 下划线偏移 0.16em;渲染为真 `<a href>`(draggable=false);链接图标 widget 提示可点 | theme.ts、preview.ts LinkIconWidget |
| 高亮 `==text==` | 自定义 lezer 节点(Highlight/HighlightMark)+ 黄底 38% 混合 | highlight.ts(自写 parseInline delimiter)、markdown.ts(remark 插件同步支持) |
| 任务列表 | 真 checkbox 装饰(accentColor #2563eb,1em,点击切换);列表 marker 用伪元素 `•`,data-list-depth/kind 驱动缩进 | tasks.ts、preview.ts listLineAttributes |
| 分割线 | 整行替换为 `<hr>` widget(1px 半透明、1.25em 上下距),点击落回源码位置 | horizontal-rule.ts |
| 代码块 | **整块替换为 widget 渲染**:顶部 12px gap、header 行(语言下拉 select + 一键复制按钮)、内容行浅色底 + 左右细边框 + **行号(伪元素 `::before` + data-code-line-number,min-width 2ch,可开关)**、闭合围栏行 3.5em 高 + 整体圆角 | code-block.ts(1510 行) |
| 代码高亮 | **lowlight(highlight.js AST)**:解析代码块为带 className 的 span 区间,映射到 `cm-markra-code-highlight-*` 类;40+ 语言菜单(含自定义语言值) | code-support.ts |
| Mermaid | ` ```mermaid ` 围栏直接渲染为 SVG(异步,主题从元素读取,错误提示),预览模式铺满整行 | code-block.ts + mermaid.ts |
| 表格 | **可视化表格**:源码行替换为真 `<table>`;hover 显示行/列操作(增删行、增删列、对齐、宽度模式 auto/even、8×10 尺寸选择器);编辑单元格用 caret-host + ZERO WIDTH SPACE 占位符回写源码 | table.ts(1897 行) |
| 图片 | 替换为 `<img>` widget,支持点击放大(media-viewer)、拖放粘贴落盘(clipboard-assets);`resolveSafeImageSource` 校验 scheme(data:image 白名单) | image.ts、media-viewer.ts |
| 公式 | **KaTeX**(renderToString,htmlAndMathml,throwOnError:false);支持 `$$`、`\[ \]`、`$`、`\( \)`(Hugo 风格)+ 宏定义;光标进入显示源码 | math-preview.ts、math-render.ts、hugo-math.ts |
| Callout | GitHub 风格 `> [!NOTE/TIP/WARNING/CAUTION/IMPORTANT]` → 带图标+标签的提示块(截图:浅蓝底 Note 框,圆角) | callout-preview.ts、blocks.ts |
| 脚注 | 定义处/引用处悬浮预览 | footnote-preview.ts |
| Frontmatter | YAML 头预览为属性面板 | frontmatter-preview.ts |
| 原始 HTML | **白名单渲染**:允许 28 个标签(a/div/pre/img/span...),丢弃 script/iframe/svg/form 等;属性白名单 + src 解析钩子;渲染块可一键切回源码编辑 | raw-html-preview.ts、raw-html-sanitize.ts |

### B.4 主题与导出

- 内置多主题(默认/github-dark/night/one-dark/one-dark-pro/solarized-dark/nord/catppuccin-mocha,styles.css `[data-editor-theme=...]` 证据)+ **用户自定义 scoped CSS**(导入/导出/重置,README)。
- 导出 HTML/PDF:独立 DOM 渲染管线(document-export.ts),默认导出衬线字体栈(ui-serif/Georgia/Noto Serif CJK SC),PDF 可配页面尺寸/边距/页眉页脚/H1 分页,KaTeX CSS 内联;docx/epub/latex 走 Pandoc(可选配置)。

---

## C. 交互模型

- **光标/选区**:常规 CM6 选区;reveal 策略联动(见 A.3);IME 处理细致(composition 期间隐藏选区背景防闪烁 `data-markra-composing`、不重建装饰——theme.ts 与 preview.ts)。
- **块级操作**:
  - 块拖拽(`block-drag.ts`,823 行):行首拖拽手柄,自定义 MIME `application/x-markra-codemirror-block` 跨块拖放(before/after),列表项按深度递归识别,frontmatter 可整块拖。
  - 斜杠菜单(`slash-menu.ts`):`/` 触发,命令注册表驱动,中英文关键词搜索。
  - **标题级别控件**(`heading-level.ts`):光标在标题行时行首显示 `H1..H6 + Paragraph` 下拉控件(WidgetType,contentEditable=false),点击即改级——类似 Notion 的块类型切换。
  - 块命令快捷键:`Mod-Alt-1..6` 标题、`Mod-Shift-7/8` 列表、`Mod-Shift-b` 引用、`Mod-Alt-c` 代码块等(blocks.ts,键位可关)。
- **格式化**:bold/italic/strikethrough/code/highlight 命令(格式化时选区精确映射,把用户内容留在选区、语法移出选区,blocks.ts dispatchLineChanges)。
- **快捷键系统**:全局可自定义(`markdown-shortcuts.ts` + `@markra/shared` 的 KeyboardShortcutMap);Alt-only 快捷键用 keydown 物理码匹配(避开 macOS Option 组合字符)。
- **大纲**:标题列表导航,跳转 + 当前项高亮,deferred 渲染(CHANGELOG #640);标题锚点由 controller.ts 维护(readCodeMirrorHeadingAnchors)。
- **文件组织**:单文件或**文件夹工作区**(文件树:创建/重命名/移动/删除/排序/reveal/多选)、标签页、**side-by-side 双栏分栏**、quick open、工作区搜索、`[[双链]]` 补全(document-links.ts,基于工作区文件索引)、字数统计、自动保存与标签恢复(README、MarkdownFileTreeDrawer.tsx)。
- **其他**:Vim 模式(@replit/codemirror-vim)、打字机模式(typewriter.ts:滚动居中 + 上下 padding 填充)、代码折叠(折叠标题/列表项)、拼写检查(cspell 自管理词典,按需下载语言包,`Ctrl/Cmd+.` 建议菜单,个人词典)。
- **AI 交互(非本次重点,但交互范式值得记)**:行内命令/选区 AI/右侧 agent 面板;AI 编辑先渲染为**预览 diff**,确认后才应用(ai-preview.ts:showCodeMirrorAiPreview → confirm,含 selection-hold 防止预览期间选区漂移)。

---

## D. 与 md-editor 的差异对照

对照基准:md-editor = Tauri 2 + React 19 + pnpm monorepo;自研 CM6 渲染器 `packages/renderer-codemirror`,三层:range-index parser → projection-state → widgets;M0-M3 已完成(主链路/基础 Markdown/代码块/GFM 表格),M4(基础 HTML + 官方 MDX)进行中。

### D.1 渲染方案对照表

| 维度 | Markra | md-editor(现状) | 判断 |
|---|---|---|---|
| 解析引擎 | @lezer/markdown(CM6 官方增量解析,GFM+自写扩展) | 自研 range-index parser | **同构不同源**。Markra 用社区成熟解析器,我们用自研以获得 MDX/可控性;两者都落在"CM6 装饰层渲染"这一路线上,大方向互相印证 |
| 中间态 | lezer 语法树(节点即区间)+ 按节点名派发 renderer registry | range-index → projection-state(自有结构化投影) | 我们更"结构化",Markra 更"贴近解析器"。Markra 的 **renderer registry + scope(node/visible-range)+ 认领(返回 false 阻止基础装饰重叠)** 机制可直接借鉴到我们的 projection-state 层 |
| 渲染输出 | Decoration.replace/mark/line/widget 一次性 Decoration.set | widgets(与 Markra 相同宿主) | 一致 |
| 序列化 | 无(源码即文档);导出走独立 DOM 管线 | M4 需处理 HTML/MDX 双向,序列化是显式问题 | 我们更复杂(MDX 编译产物需回写源码);Markra 模式对纯 Markdown 省事,对 HTML 内联场景它也是"预览块+源码编辑"而非双向编译 |
| 文档模型 | 无独立模型 | 有 projection-state 语义层 | 我们保留语义层的收益在 MDX/结构化操作(M4+)上会体现 |
| 编辑模式 | WYSIWYG 即时渲染 + 一键源码 | 同为 Typora 式 | 一致 |

### D.2 能力对照表(★ = 值得借鉴 / ✓ = 我们已有或更优 / ✗ = 我们缺失)

| 能力 | Markra | md-editor | 备注 |
|---|---|---|---|
| reveal 策略(光标处显源码) | ★ 细节丰富:typedBoundary、成对分隔符、heading marker 可配置、IME 兼容 | ✓ 主链路已实现 | 细节可对照补齐 |
| 性能策略 | ★ visibleRanges 局部遍历 + 纯文本输入 map 不重建 + composition 不重建 + deferred | 部分 ✓ | 输入延迟优化是长期痛点,值得抄 |
| renderer registry | ★ 按节点名注册、两级 scope、认领语义 | 我们的 projection-state 已覆盖部分 | 可引入"认领"概念统一 widget 与基础装饰的边界 |
| 代码块 chrome | ★ 语言下拉 + 复制 + 行号伪元素 + 圆角容器 + mermaid | ✓ M2 已做代码块 | 行号伪元素方案轻量,可对比 |
| 表格 | ★ 可视化编辑:行列增删/对齐/宽度模式/尺寸选择器/caret-host 回写 | ✓ M3 已做 GFM 表格(方式待对比) | Markra 的编辑交互深度是标杆;其 caret-host + ZWSP 回写技巧值得看 |
| 原始 HTML(M4 相关) | ★ 白名单标签渲染(28 标签)+ 属性白名单 + 预览/源码切换 | M4 进行中(sanitize-html + MDX parser) | 我们的安全边界(webview/CSP)更严;Markra 的方案可作白名单范围参考 |
| 公式 | ✗ KaTeX 多定界符 + 宏(我们缺失) | — | 若产品要支持数学写作,直接对标 |
| 块拖拽 / 斜杠菜单 / 标题级别控件 | ★ 三者齐全 | ✗ 缺失 | 块交互三件套,建议进路线图 |
| 大纲 / 双栏分栏 / 文件树工作区 | ✓ 有(但属应用层,代码量大) | 视产品范围 | 编辑器内核阶段可不做,但"标题锚点 API"值得预留 |
| 拼写检查 / Vim / 打字机 / 折叠 | ✓ 有 | ✗ 缺失 | 优先级低,可按需 |
| Mermaid / Callout / 脚注 / frontmatter 预览 | ✓ 有 | 部分(按里程碑) | Callout 语法与 GFM 一致,成本低 |
| 主题系统 | ✓ token 化设计系统 + 自定义 CSS | ✓ 应有主题 | DESIGN.md 的 token 写法可参考 |
| 设计纪律 | ★ DESIGN.md 完整 token(字体 44/31/24/16px、行高 1.65、块距 18px、空行稳定) | 可参考 | 中文 Noto Sans SC 字体栈 + 760 字重方案直接可用 |

### D.3 我们已有的优势(不必妄自菲薄)

1. **自研三层渲染器对 MDX 的掌控力**:Markra 的 lezer 路线做 MDX 需要换/扩 parser(其仓库未做 MDX),我们的 range-index parser 可把 MDX 的 JSX 节点纳入自有语义层,M4+ 路线更清晰。
2. **无重型渲染依赖**:Markra 内置 katex/lowlight/mermaid/turndown/cspell 等大依赖;我们按里程碑渐进引入,包体与维护面更可控。
3. **聚焦**:Markra 同时承担文件树、AI、同步、拼写等应用层负担(代码量 2.7 万行仅编辑器内核),我们当前聚焦渲染器内核,架构演进空间更干净。
4. **安全边界意识**:M4 的 sanitize-html + webview 端点 + CSP 评审(m4_html_mdx_security_review.md)比 Markra 的纯前端白名单更系统。

---

## E. 可借鉴清单(按优先级)

1. **[P0] reveal 策略细节**:typedBoundary(刚输入的闭合符保留)、成对内联标记整体 reveal、链接节点边界成对 reveal、`hideHeadingMarkersOnFocus` 可配置。→ 对照我们主链路补齐。
2. **[P0] 渲染性能三板斧**:仅遍历 visibleRanges;纯文本输入时 decorations.map 不重建;IME composition 期间不重建、结束后空事务触发一次重建。→ 直接移植到 projection-state 更新循环。
3. **[P1] renderer "认领"语义**:渲染器替换整节点后声明认领,基础标记装饰不再与其重叠(preview.ts rendererClaimedNodes)。→ 解决 widget 与行内装饰打架的经典问题。
4. **[P1] 代码块 chrome 细节**:行号用 `::before` + data 属性(不引入 gutter)、顶部 gap + header 行(语言下拉 + 复制)、闭合行高保持可点、整体圆角。
5. **[P1] 可视化表格编辑交互**:行列增删/对齐/宽度模式/尺寸选择器;单元格编辑用 caret-host + ZWSP 占位符回写(table.ts 的 createVisualTableCaretHost 与 replaceVisualTableCell)。
6. **[P2] 块交互三件套**:块拖拽手柄(自定义 MIME + 深度感知列表)、斜杠菜单(命令注册表驱动)、标题级别控件(H1-H6 下拉)。
7. **[P2] M4 参考**:raw HTML 白名单标签集合(28 标签)与属性白名单粒度;HTML 预览块 + 源码切换的交互模型。
8. **[P2] KaTeX 公式**:多定界符($$ / \[ \] / $ / \( \)) + 宏定义 + 光标进入显示源码 —— 若产品需数学写作。
9. **[P3] 排版 token**:正文 16px/1.65、H1 44px、块距 18px、markdown-syntax 极低对比色、Noto Sans SC 字体栈;空行高度稳定策略(#637)。
10. **[P3] 命令注册表架构**:`MarkraPlugin{extension, commands, ui}` 统一驱动工具栏/选区工具栏/斜杠菜单/右键菜单 —— 应用层 UI 多了以后收益大。

---

## 附:证据索引

- 渲染管线:`packages/editor/src/codemirror/preview.ts`(941 行,核心)、`renderers.ts`、`policy.ts`、`index.ts`(liveMarkdown 组装)、`plugin.ts`(命令注册表)
- 块级交互:`blocks.ts`、`block-drag.ts`、`slash-menu.ts`、`heading-level.ts`、`formatting.ts`、`markdown-shortcuts.ts`
- 各元素渲染:`code-block.ts`、`code-support.ts`、`table.ts`、`image.ts`、`math-preview.ts`、`math-render.ts`、`horizontal-rule.ts`、`tasks.ts`、`callout-preview.ts`、`footnote-preview.ts`、`frontmatter-preview.ts`、`raw-html-preview.ts`、`raw-html-sanitize.ts`、`highlight.ts`(==高亮 lezer 扩展)、`theme.ts`
- 应用层:`packages/app/src/components/CodeMirrorPaperSurface.tsx`(插件总装清单)、`EditorWidthResizer.tsx`、`styles.css`、`packages/app/src/lib/document-export.ts`(导出管线)
- 辅助管线:`packages/markdown/src/markdown.ts`(unified/remark:大纲、字数)
- 设计规范:仓库根 `DESIGN.md`(完整 token)、`PRODUCT.md`;官网 https://markra.app(抓取于 2026-08-04);截图 `assets/screenshots/editor-workspace.png`(仓库内,已做视觉分析)
