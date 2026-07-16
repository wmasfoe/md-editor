# 自研 Markdown 渲染器架构方案（CodeMirror 6 底座）

> 面向接手实施的 AI Agent 与人类评审。本文自包含：读完即可理解方案全貌与取舍。
> 状态：**方案已定，可开工**。所有设计决策已锁定，无开口项。
> 关联：替换现有 [`inline_syntax_markers_and_visual_refresh.md`](./inline_syntax_markers_and_visual_refresh.md)（路线 D，Milkdown 底座）与 [`mdx_component_plugin_architecture.md`](./mdx_component_plugin_architecture.md)。

## 0. 一句话背景

现在编辑器 WYSIWYG 模式用 Milkdown（ProseMirror 底座），源码模式用 CodeMirror 6。核心痛点是「WYSIWYG 下显示部分源码」——Typora 式的「光标所在处露出 `**` 等语法标记」——在 ProseMirror 的**树模型**里是逆天而行，导致 `inlineMarkerPreset.ts`（~408 行）+ `inlineSyntaxDecorationPlugin.ts` 这套「对抗框架」的实现。

本方案：**自研渲染器，底座换成 CodeMirror 6（CM6）**，让「显示部分源码」从「对抗框架」变成「框架的工作方式本身」。API 不兼容 Milkdown，重构为自有的、可插拔的插件协议。

---

## 1. 为什么是 CM6：两种文档模型的根本分岔

所有网页富文本编辑器，底层分两个家族。这是**唯一真正决定成败的那根轴**。

### 家族 A · 树模型（存树，丢源码）
代表：ProseMirror、**Milkdown**、Tiptap、Lexical、Slate。

文档存成一棵结构树。`**你好**` 解析后变成「文字『你好』+ 加粗 mark」，**那两对 `**` 在解析时就被吃掉了，模型里不存在**。

- 编辑 = 改树；保存 = 把树序列化回 markdown 文本（重新生成 `**`）；屏幕 = 渲染这棵树。
- 想「显示源码」，必须**反向重造**已经不存在的标记 → 这就是路线 D 那 408 行的由来。

### 家族 B · 文本模型（存文本，贴贴纸）
代表：**CodeMirror 6**（Obsidian Live Preview 的底座）。

文档就是 markdown 文本本身，一个字不动。`**你好**` 在内存里就是实打实的 8 个字符。CM6 用 Lezer 解析出一棵语法树，但**文本才是真相，树只是「指着文本告诉你每段是什么」的导游**。

- WYSIWYG = 往文本上贴「装饰（decoration）」：把 `**` 用隐藏贴纸盖住、给「你好」贴加粗样式。
- 光标移进来 = 撕掉隐藏贴纸，`**` 立刻露出。**文本全程没被改过。**

### 结论
| 需求 | 家族 A（Milkdown 现状） | 家族 B（CM6） |
|------|------|------|
| 光标处显示源码 | 逆天而行，需凭空重造标记 | **天然，只是决定藏不藏已有标记** |
| markdown 保真（frontmatter/LF/图片路径） | 靠序列化还原，易出错 | **免费，文本即真相，无序列化环节** |
| 大文件性能 | 重建整棵树，吃力 | Lezer 增量解析 + 视口虚拟化，极强 |
| 内联渲染 React 组件（MDX） | 强（NodeView 亲生） | 能做，但 widget 挂 React 属「外挂」，需管生命周期 |

> Milkdown → Tiptap 是**横向平移**（同为 ProseMirror 包装），痛点一个不解决，已排除。
> Lexical 是家族 A，「显源码」与 Milkdown 同坑，会把逃离 Milkdown 的题重做一遍，已排除。

### 产品重心裁决（已定）
用户确认：**MDX 组件是「点缀」而非「核心灵魂」**。因此优化「日常写作那 99%」（用 CM6 把显源码做丝滑），MDX 组件作为「较难但少见」的 widget 外挂处理。选型指向 **CM6**。

---

## 2. CM6 如何做「所见即所得」（核心机制，三个零件）

心智模型：**文本是原文，一直都在；WYSIWYG 是盖在上面的一层贴纸，随光标位置贴/撕。**

### 零件 1 · Lezer 解析器（永远在线的导游）
`@codemirror/lang-markdown` 内置。读文本，画「语法地图」。对 `**你好** 世界`：

```
0-2  加粗开始标记 (**)
2-4  加粗正文 (你好)
4-6  加粗结束标记 (**)
6-9  普通文字 ( 世界)
```

文本一字不动，Lezer 只是标注每段是什么。**增量解析**：改第 100 行只重画附近，故大文件不卡。

### 零件 2 · Decoration（四种贴纸）
| 类型 | 作用 | 例子 |
|------|------|------|
| Mark | 给一段文字加 CSS 样式 | 「你好」加粗 |
| Replace | 视觉隐藏或替换一段文字 | 把 `**` 设为不可见 |
| Widget | 在某位置插入自定义 DOM | 图片位置显示真图、MDX 渲染成组件 |
| Line | 给整行加属性 | 标题行加大字号 |

`**你好**` 的 WYSIWYG 效果 = 首尾 `**` 贴 Replace 隐藏 + 「你好」贴 Mark 加粗。眼睛看到粗体无星号，文本里星号一个没少。

### 零件 3 · 光标感知（决定何时撕贴纸）
CM6 里光标位置（selection）是状态的一部分，**光标一动就重算 decoration**。规则：

> 光标不在这个加粗块内 → 贴隐藏贴纸（藏 `**`）；光标移进来 → 撕掉（露 `**`，可直接编辑）。

这就是 Typora/Obsidian 手感的灵魂，也正是 Milkdown 做不到、逼出 408 行的那件事。

### 块级同理
- `# 标题` → 平时藏 `# ` + 整行大字号；光标进则 `# ` 露出。
- `> 引用`、`- 列表` → `>` / `-` 一直可见，套引用/列表样式；不做光标感知。
- 代码块、表格 → **直接显示 markdown 源码 + 语法高亮**，不做渲染/隐藏，两个模式下外观相同。
- 图片、链接、分割线、MDX 组件 → 平时渲染成最终样子（真图/真横线/真组件），光标进入则露出 `![]()` / `---` / `<Callout>` 源码。

---

## 3. 分层架构（中等偏薄抽象，已定）

用户确认抽象层级 **中等偏薄**：服务好 markdown 这一个场景，不为「万一换引擎」过度设计；但对外不直接裸露 CM6 类型，让「加特性」变成「填一张表」。

```
┌───────────────────────────────────────────────┐
│  editor-core（已有包，引擎无关，原样复用）              │
│  DocumentState / CommandRegistry / KeymapRegistry │
│  FeatureRegistry / EditorRuntime / 模式切换           │
├───────────────────────────────────────────────┤
│  renderer-core（新包，本方案主角 ★）                   │
│  定义「一个 markdown 特性插件长什么样」                  │
│  内部用 CM6 实现，对外暴露语义化协议，不漏 CM6 类型        │
├───────────────────────────────────────────────┤
│  CodeMirror 6（底层引擎，被藏在下面）                   │
└───────────────────────────────────────────────┘
```

`renderer-core` 对外的插件协议（**你的词汇，非 CM6 词汇**）：

- **InlineMarkerRule（行内标记规则）**：加粗/斜体/行内代码/删除线，以及引用 `>`、列表 `-`/`1.`。行为固定：标记符**永远可见但淡化**，内容区**应用对应样式**。光标位置不影响显示，不涉及 atomic ranges。实现最简单。
- **BlockMarkerRule（块级标记规则）**：**仅标题 `#`**。行为：`# ` 默认隐藏（Replace decoration），**仅当光标在本行时显示**；隐藏时标记区为 atomic range，方向键整体跳过。
- **Decorator（装饰器）**：图片、链接、分割线、MDX 组件。平时渲染成最终样子（Widget），光标进入则撕掉 Widget 露出源码。图片/分割线是纯 DOM widget；MDX 组件挂真实 React 组件（见 §5）。
- **SourceHighlightRule（源码高亮规则）**：代码块、表格。WYSIWYG 下就是带语法高亮的源码，不做任何隐藏/渲染切换。
- **InputRule / Command / Keymap**：输入 `**` 自动配对、`Cmd+B` 加粗等行为。
- **序列化钩子（可选，通常为空）**：CM6 里文本即真相，多数特性不需要——这一项常年空着，本身就是家族 B 的红利证明。

内置特性（加粗/标题/引用……）与第三方插件走**完全相同**的接口，才叫真可插拔。

---

## 4. 重大简化：两个模式收敛成一个引擎

现状是「两个模式 = 两个引擎 = 切换时互译」。CM6 下换成：

> **只有一个 CM6 编辑器，永远编辑同一份文本。「模式」只是一个开关，控制贴纸贴不贴。**

- WYSIWYG 模式 = 开关开 = 「行内标记（`**`/`_`）**永远可见但淡化、内容加样式**；块级标记（`# ` 等）**默认隐藏，光标进该行才显示**」。
- 源码模式 = 开关关 = 「不贴任何装饰，露出全部原始文本，仅保留语法高亮」。
- 切换 = 翻转一个 Extension/StateField，**瞬间完成，无序列化、无翻译、无重解析**（同一份文本、同一个引擎）。

直接消灭的复杂度：
- `switchEditorModeSafely` 的 `beforeSwitch` 序列化逻辑 → 几乎退休。
- 模式切换「丢稿」风险 → 基本消失（无翻译即无翻译丢失）。

---

## 4.5 WYSIWYG 元素显示策略（四档，全部锁定）

| 档 | 元素 | WYSIWYG 行为 | 需要 atomic? |
|----|------|------------|-------------|
| **1 · 标记常驻+样式** | 加粗 `**`、斜体 `_`、行内代码 `` ` ``、删除线 `~~`、引用 `>`、列表 `-`/`1.` | 标记符淡色常驻可见；内容套对应样式（粗/斜/等宽/删除线/缩进） | 否 |
| **2 · 光标行才显标记** | 标题 `#` | `# ` 默认隐藏+大字号；光标进该行才显 `#` | 是（行首 `# `）|
| **3 · 渲染成最终样子，光标进才露源码** | 图片 `![]()` 、链接 `[]()`、分割线 `---`、MDX 组件 `<Callout>` | 平时真图/真横线/真组件；光标进该块露出源码 | 是（隐藏的源码区）|
| **4 · 源码常驻+高亮** | 代码块 ` ``` `、表格 `\|` | 直接显示 markdown 源码，带语法高亮；两个模式外观基本相同 | 否 |

> atomic ranges 只在第 2、3 档需要，范围小且清晰。第 1、4 档完全不涉及。

---

## 5. MDX 组件方案（真实挂载 React 组件，已定）

用户确认：**需要在 WYSIWYG 模式实时看到 Callout 等组件的真实渲染效果**，因此采用在 Widget decoration 里挂载真实 React 组件的方案。

**流程：**

1. Lezer 或自有识别逻辑（复用现有 `isLikelyMdxBlock`）在文本里认出 `<Callout type="warning">...</Callout>`。
2. 平时（光标不在该块）：Widget 把该块视觉替换成容器 `<div>`，`toDOM()` 里挂 React root，从文本解析 JSX 属性，渲染 `mdx-component-registry` 里注册的真实组件。用户看到和浏览器最终渲染一样的效果。
3. 光标进入该块 → 撕掉 Widget → 露出原始 `<Callout type="warning">...` 源码文本，直接编辑属性和内容。
4. 光标移走 → 重新解析属性 → `eq()` 判断 props 是否变化 → 按需重渲染。
5. 保存到磁盘：文本原封不动，零变形。

**为什么比预期容易**：Callout/Warning/Note 这类展示型组件是**无内部状态**的——输出完全由 props 决定。这消解了最难的那坨（组件内部状态在 widget 重建时丢失），剩下的挂载/卸载和 `eq()` 复用是有标准解法的（见 §7）。

**可直接复用资产**：`isLikelyMdxBlock`；`mdx-component-registry`（组件名 → React 组件注册表，正好喂给 widget 渲染层）。

---

## 6. 现有代码去留清单

### 原样复用（引擎无关）

- `editor-core` 整包（DocumentState / CommandRegistry / KeymapRegistry / FeatureRegistry / EditorRuntime）。
- `mdx-component-registry`、`mdx-plugins`。
- `file-system`、`recent-files`、图片粘贴路径计算。

### 退休（被 CM6 模型天然解决）

- `markdown-fidelity` 的 `rewriteRawBlocksForPreview` / `restoreRawBlocksFromPreview`（骗过 ProseMirror 的黑魔法，CM6 不需要）。
- `switchEditorModeSafely` 的序列化翻译逻辑。
- `inlineMarkerPreset.ts`（~408 行）+ `inlineSyntaxDecorationPlugin.ts` —— 整个作废，其使命（树模型里硬造源码）在文本模型里不存在。
- CLAUDE.md 强调的「markdown 保真」原则 —— 从「需小心维护」降级为「不用管的事实」。

### 改造（换更稳的来源）

- `extractHeadingOutline`：从「扫 ProseMirror DOM 的 h1~h6」改为「读 Lezer 语法树」。可扔掉现有「Milkdown 不给稳定 heading id、只能靠 DOM 顺序猜」的将就做法。
- 搜索（改用官方 `@codemirror/search`）、滚动同步、AI 续写、图片渲染 —— 在 CM6 里重接；源码模式已跑在 CM6 上，有现成经验。

---

## 6.5 AI 功能支持

两个 AI 功能需在 `renderer-core` 层提供对应接口，语义与现有 Milkdown 实现一致，仅底层 API 从 ProseMirror 换成 CM6。

### AI 修复建议 / Ghost Text 预览

现有：`aiSuggestionPlugin`（ProseMirror decoration 在光标处插入灰色预览文字），Tab 接受、Escape 拒绝。

CM6 实现：

- `StateField` 存储「建议内容 + 光标位置 + 请求 id」。
- `ViewPlugin` 在光标处插 Widget decoration 渲染 ghost text（灰色、不可选）。
- Keymap 绑定 Tab（接受 → 插入文本）、Escape（拒绝 → 清空 StateField）。
- `renderer-core` 对外暴露接口：`showGhostText(suggestion)` / `clearGhostText()` / `acceptGhostText()`。

现有 `MilkdownEditorPrimitiveProps` 里的 `onAiSuggestionRequest` / `onAiSuggestionRequestHandled` / `isAiSuggestionPending` 可直接对应到新接口，上层调用方不需要改。

### AI 续写（在光标处插入文本）

现有：`aiAutoSuggestionsEnabled` 触发定时请求，`getAiCompletionContext` 取光标前上下文。

CM6 实现：

- `getAiCompletionContext`：从 `view.state` 读取光标前 N 字符 + 当前行/段落上下文，语义与 ProseMirror 版一致，API 重写一遍。
- 插入逻辑：标准 CM6 `transaction`，在光标位置 `insert` 文本。
- `renderer-core` 对外暴露：`getCompletionContext()` / `insertAtCursor(text)`。

两个功能都归在 M5（补齐阶段），对外接口形状不变，上层 `useEditorUi` 和 `useMdxAiController` 改动最小。

---

## 7. 两个技术难点的解法（已定）

### Widget 里的 React 生命周期（第 3 档 Decorator）

CM6 会因滚动或文档变化随时销毁/重建 widget。标准解法：

- **挂载**：`toDOM()` 里 `createRoot(div).render(<Component />)`，把 root 存在 DOM 上（`(dom as any).__reactRoot = root`）。
- **卸载**：`destroy(dom)` 里取出 root 调 `unmount()`，避免内存泄漏。
- **eq() 复用**：比较组件名 + 解析出的 JSX props，未变则返回 true，CM6 复用已有 DOM，React root 不重建。对展示型无状态组件（Callout/Warning/Note）此条件易满足。
- **有状态组件**（将来）：内部状态需外提到 CM6 StateField 或文本本身，不能依赖 React `useState`。

对当前展示型 MDX 组件集，此问题可控，有标准解法，M3 里程碑实施。

### 原子区域（atomic ranges，第 2 / 3 档）

**适用范围**：仅第 2 档（标题 `#`）和第 3 档（图片/链接/MDX 源码区）。第 1、4 档不涉及。

**设计**：隐藏贴纸（Replace decoration）和 atomic range 由同一 StateField 驱动，永远同步——贴了隐藏贴纸的区域同时是 atomic，撕掉贴纸则取消 atomic。

**边界（宽松策略）**：光标停在内容左边缘（紧贴隐藏标记右侧）时，算作「在内容里」，立即露出标记源码，此时标记不是 atomic。按左方向键从内容左边缘跳到标记前，整体跳过隐藏字符。与 Typora 行为一致。

**删除**：不特殊处理，退格逐字符删，markdown 失效后 decoration 自动消失。

---

## 8. 迁移策略（一步到位替换，内部切里程碑）

用户选「一步到位重写」（**不双引擎并存** —— 双引擎的翻译层正是当前痛苦来源）。为化解用户自列顾虑「出问题难定位是新引擎还是迁移」，重写过程内部切成可独立验证的里程碑，每步只引入一类新东西：

| 里程碑 | 内容 | 验证重点 |
|--------|------|---------|
| **M0 地基** | CM6 裸接入 + `renderer-core` 骨架 + 对接 `DocumentState` | 数据流通、保真对不对（此时只是带高亮的源码编辑器）|
| **M1 行内 WYSIWYG** | 加粗/斜体/行内代码/删除线标记淡化+内容加样式；引用 `>` / 列表 `-` 标记常驻+样式 | InlineMarkerRule 正确渲染，不影响光标移动 |
| **M2 块级** | 标题 `#` 光标行显隐 + atomic 穿越；图片/链接/分割线 Decorator widget；代码块/表格带高亮源码 | 第 2/3/4 档全部到位，atomic 边界行为正确 |
| **M3 Widget+React 打通** | 图片/分割线 widget 验证 `toDOM`/`destroy`/`eq()` 基本实现 | widget 不因滚动频繁重建；为 M4 铺底 |
| **M4 MDX 组件** | 真渲染 React 组件 + 光标展开源码 | 建立在 M3 已验证的生命周期之上 |
| **M5 补齐+拆除** | 搜索/大纲/AI 续写/图片粘贴/滚动同步；删 Milkdown 与退休代码 | 全功能回归、typecheck+test 全绿 |

每个里程碑跑通并验证后再进下一个。出问题永远只在「最近引入的那类东西」里找原因。既满足「一步到位、不双引擎」，又摁住「难定位」风险。

---

## 9. 诚实的坑清单

1. **Widget React 生命周期** —— 第 3 档 Decorator 的标准解法已在 §7 定义，M3 实施。
2. **原子区域** —— 仅第 2/3 档，设计已在 §7 定义，边界策略宽松，M2 实施。
3. **输入法（IME）** —— 中文输入在 CM6 上需专测，尤其叠加光标敏感贴纸。已有 `imeCompositionGuardPlugin` 经验可迁移。
4. **「所见」丰富度上限** —— CM6 的 WYSIWYG 本质是「文本 + 贴纸」，做不到 Notion 式任意拖拽块/块内复杂嵌套。对 markdown 文件编辑器足够，要清楚天花板在哪。

---

## 10. No-Go 回退

- **MDX 组件降级** —— 若 React 生命周期在真实场景无法稳定 → 降级为静态占位块（显示组件名标签，不挂 React），光标进露出源码；或延后，先交付纯 markdown WYSIWYG。
- **atomic 光标穿越体验不达标** → 第 2/3 档退回「光标进整行才切换」的粗粒度策略，牺牲部分丝滑换稳定。
- **CM6 WYSIWYG 综合体验不及预期** → M1 是最小可验证切片，回退成本最低（尚未拆 Milkdown），M1 后可设 Go/No-Go 检查点。
- 触发任何回退前先回报用户。

---

## 11. 开工前确认（已全部到位）

所有设计决策已在本文锁定，无待对齐项。可直接按里程碑 M0 → M5 依序开工。

| 项目 | 状态 |
|------|------|
| 底层引擎 → CodeMirror 6 | ✅ |
| 两模式收敛，同一 CM6 实例 | ✅ |
| 抽象层级 → 中等偏薄，`packages/renderer-core` | ✅ |
| 四档显示策略（§4.5） | ✅ |
| MDX 组件 → 真实挂载 React，光标进露源码 | ✅ |
| Widget React 生命周期解法（§7） | ✅ |
| Atomic 范围 + 边界策略（§7） | ✅ |
| AI ghost text + 续写接口（§6.5） | ✅ |
