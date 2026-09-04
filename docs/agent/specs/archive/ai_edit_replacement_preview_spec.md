# AI edit replacement preview spec

## 用途

记录 AI 修复建议 replacement preview 的展示规范、实现边界和回归验收点。修改 `packages/editor-ui/src/utils/ai-suggestion.ts`、`packages/editor-ui/src/components/MilkdownEditor.css` 或 AI suggestion 接受/取消逻辑前，先读本规范。

这是编辑器核心交互：预览必须让用户准确判断 Tab 后会发生什么。确认前不得改变真实 Markdown、ProseMirror doc、历史记录或选区；只有新增-only 预览可以作为未确认 decoration/widget 参与文档流，把后续原文向下推。

## 背景

AI edit suggestion 使用结构化结果：

- `original`：模型认为需要替换的原文。
- `replacement`：模型建议替换后的文本。

早期问题是 replacement 浮层使用自己的宽度和换行规则，导致它在多行文本中独立换行，和原文行盒不贴合。新的方向是按 diff 形态拆分交互：

- 只有删除：直接在原文要删除的片段上应用现有删除样式。
- 只有新增：在插入点直接展示新增内容，并应用现有 AI 建议绿色样式；新增内容参与正常文档流，可以把后面的原文本向下推。
- 同时有删除和新增：暂时保持现有 replacement preview 交互，不切到新增-only 的文档流预览。

## 必须保持的行为

1. 展示 AI 修复建议时，真实 Markdown 文档、ProseMirror doc 和历史记录都不能改变。
2. Tab 是唯一确认 edit suggestion 的入口；按 Tab 后才把 anchored `original` 替换为 `replacement`。
3. 如果用户没有通过 Tab 接受 suggestion，而是输入、点击、移动光标、改变选区、触发 IME composition 或导致文档版本变化，必须取消当前 preview 样式和可接受状态。
4. 删除-only suggestion 只在原文待删除片段上应用 `.md-ai-edit-original` 的现有删除样式，不渲染 replacement overlay。
5. 新增-only suggestion 在插入点渲染新增内容，使用现有 AI 建议绿色样式；该预览是未确认 decoration/widget，可以参与正常文档流并把后续原文向下推，但不能写入真实 doc。
6. 混合 suggestion 同时包含删除和新增时，暂时保持现有交互：原文标删除样式，replacement 走当前 preview/mirror 展示，不把新增内容拆到文档流里。
7. mixed preview 必须按原 textblock 的内容盒宽度、字体、行高、字距、对齐方式和 tab size 渲染，不能使用独立浮层宽度产生另一套换行。
8. preview 元素必须 `pointer-events: none` 且不可选中，不能干扰文本选择、拖选、IME composition 或编辑器点击。
9. geometry 缺失、内容宽度无效、rich inline、code block、跨 textblock 或 original 不匹配时必须 fail closed：不展示可接受的 edit suggestion。
10. 同一轮同时存在 edit 和 continuation 时，Tab 优先接受 edit；`Command/Ctrl + ArrowRight` 只接受 continuation；Esc 清除 suggestion。

## 实现契约

### 预览模型

`createAiEditPreviewModel()` 只为纯文本 textblock 生成 preview model，并必须把 `original` / `replacement` 的差异归类为：

- `delete-only`：只删除原文片段，没有新增片段。
- `insert-only`：只新增片段，没有删除原文片段。
- `mixed`：同时存在删除和新增。

基础安全边界：

- `edit.from` / `edit.to` 必须在同一个 textblock 内。
- textblock 不能是 code block。
- textblock 内部必须是无 mark 的纯文本。
- `text.slice(fromOffset, toOffset)` 必须严格等于规范化后的 `original`。
- `original` 和 `replacement` 不能为空，且不能相同。

不满足条件时返回 `null`。这不是降级体验问题，而是安全边界：不支持的场景不能留下一个用户可按 Tab 接受的隐藏修改。

### 删除-only 预览

删除-only 预览只装饰原文中将被删除的 offset 范围：

- 待删除片段使用 `.md-ai-edit-original`。
- 未删除的原文字面保持普通正文样式。
- 不创建 replacement mirror，也不插入绿色新增文本。
- 按 Tab 时仍通过同一个 accept edit 路径把完整 `original` 替换为 `replacement`，不要按局部 offset 手写删除逻辑。

示例：`今天会下雨` -> `今天下雨`，只给 `会` 加删除样式。

### 新增-only 预览

新增-only 预览在原文插入点创建未确认 inline preview：

- 新增文本使用现有 AI 建议绿色样式，可以复用 `.md-ai-edit-preview-replacement` 的颜色语义，但必须适配 inline flow。
- 新增文本参与 textblock 正常文档流；换行和推开后续正文是预期行为。
- 预览节点不能进入 ProseMirror doc，不能被复制、选中或编辑，不能响应鼠标事件。
- 光标离开原 suggestion anchor、selection 变化、用户继续输入、IME composition 开始或文档版本变化时，立即清除新增样式和可接受状态。
- 按 Tab 时才把完整 `original` 替换为 `replacement`。

示例：`今天下雨` -> `今天会下雨`，在 `今天` 后插入绿色的 `会`，并让后面的 `下雨` 按文档流后移。

### 混合预览

`createAiEditPreviewAnchor()` 在 `edit.from` 位置放一个零尺寸 widget anchor。anchor 内部创建 `.md-ai-edit-preview-mirror`：

- `before` 和 `after` 用 `.md-ai-edit-preview-placeholder` 渲染为透明文本。
- `replacement` 用 `.md-ai-edit-preview-replacement` 渲染为绿色提示文本。
- 透明的 `before` / `after` 参与正常文本流宽度计算，让 replacement 处在和原文相同的行盒位置。

mirror 是 mixed suggestion 的 absolute overlay，只负责视觉预览。它不能改变 ProseMirror 文档，也不能影响原文布局。

### 定位和换行

`calculateAiEditPreviewMirrorPlacement()` 只服务 mixed preview，从 anchor 和 textblock DOM 几何信息计算 mirror 位置：

- `left = textblock.left + paddingLeft - anchor.left`
- `width = textblock.width - paddingLeft - paddingRight`
- 字体相关属性来自 textblock computed style：`font`、`lineHeight`、`letterSpacing`、`textAlign`、`tabSize`

垂直位置按当前 textblock 的行高上移：

- numeric `line-height`：`lineHeight * 0.75`
- `line-height: normal`：`fontSize * 1.2 * 0.75`

这个比例的目标是让 mixed replacement 靠近原文本上方，而不是压在原文本正中或离得过远。后续调整必须继续使用当前块文本指标计算，不能改成固定像素。

### 样式

当前 CSS 契约：

- `.md-ai-edit-original` 用淡橙色背景、半透明正文色和删除线标出将被替换的原文。
- `.md-ai-edit-preview-mirror` 使用 `white-space: pre-wrap` 和 `overflow-wrap: anywhere`，并继承定位函数写入的 textblock 文本指标。
- `.md-ai-edit-preview-placeholder` 透明但保留文本流占位。
- `.md-ai-edit-preview-replacement` 使用半透明绿色背景、绿色文本、`box-decoration-break: clone` 和小圆角，让多行 replacement 每行都有可读背景。
- 新增-only 的 inline preview 必须沿用绿色 AI 建议语义，但样式不能依赖 absolute overlay、固定宽度或固定 px 偏移。

## 禁止做法

- 不要在确认前把 replacement 或新增文本写入真实 ProseMirror doc 来模拟预览。
- 不要用独立弹层、tooltip、固定宽度浮层或 portal 重新排版 replacement。
- 不要把 mixed suggestion 拆成文档流里的删除和新增；混合场景暂时保持现有 preview 交互。
- 不要用固定 px 偏移解决标题、正文、列表等不同字号的垂直贴合问题。
- 不要为了支持 rich inline、跨块替换或 code block 而绕过 `createAiEditPreviewModel()` 的 fail-closed 边界。
- 不要让 preview 元素响应鼠标事件或进入原生选区。
- 不要修改 provider/request 层来承担编辑器 preview 语义；AI 层只提供 suggestion 数据，编辑器层负责展示、接受、取消和失效。

## 回归测试入口

修改 AI edit preview 后至少运行：

```bash
./node_modules/.bin/vitest run packages/editor-ui/src/tests/selection-policy.test.ts packages/editor-ui/src/tests/ai-suggestion.test.ts
./node_modules/.bin/vitest run packages/editor-ui/src/tests/image-selection.test.ts packages/editor-ui/src/tests/ime-composition-guard.test.ts packages/editor-ui/src/tests/editor-surface.test.ts
./node_modules/.bin/tsc -p packages/editor-ui/tsconfig.json --noEmit
git diff --check
```

重点关注：

- `packages/editor-ui/src/tests/ai-suggestion.test.ts`
  - 不移动真实 editor selection。
  - Tab 接受 edit 时才替换 anchored original。
  - 纯文本 textblock 能生成 scoped preview model，并正确归类 delete-only、insert-only、mixed。
  - delete-only 只装饰待删除原文片段。
  - insert-only 只创建 inline flow preview，Tab 前不写入真实 doc。
  - 光标位置变化、selection 变化或新输入会取消 insert-only preview。
  - mixed suggestion 保持现有 preview/mirror 交互。
  - rich inline edit preview fail closed。
  - geometry 缺失或 content width 无效时 fail closed。
  - mixed mirror placement 使用 textblock content box 和 line-height/font-size-derived vertical offset。
- `packages/editor-ui/src/tests/selection-policy.test.ts`
  - preview / selection CSS 不能破坏全局选区策略。
- `packages/editor-ui/src/tests/ime-composition-guard.test.ts`
  - preview 改动不能重新引入 IME composition 行高或 caret 回归。

## 手动验收场景

1. 删除-only suggestion 中，只给要删除的原文字加删除样式，不显示额外 replacement 文本。
2. 新增-only suggestion 中，新增文字直接出现在插入点，使用绿色 AI 建议样式，并按文档流推开后续原文。
3. 新增-only suggestion 未按 Tab 时，点击别处、移动光标、继续输入或触发 IME composition 都会取消绿色样式和可接受状态。
4. 混合 suggestion 中，继续使用现有 replacement preview；不要把新增部分插入文档流。
5. 普通段落中触发 mixed replacement，确认 replacement 跟随原段落宽度换行，允许视觉覆盖后续正文，但不改变真实正文布局。
6. 在一级标题和普通正文分别触发 mixed replacement，确认垂直距离按各自字号/行高变化，不出现标题合适但正文过高或正文合适但标题压住的问题。
7. 多行段落中触发 mixed replacement，确认它跟随原文行盒，而不是在自己的浮层里独立换行。
8. 按 Tab 后才发生真实替换；按 Esc 后 preview 和 original 标记消失，正文保持原样。
9. 对带 link/emphasis 等 mark 的原文触发 edit suggestion 时，不应留下可按 Tab 接受的 edit preview。
10. 中文输入法 composition 期间或结束后，AI preview 不能破坏当前光标位置或选区。

## 已知限制

当前自动化测试覆盖 preview model、fail-closed 边界和定位数学，但 JSDOM 不能完整验证真实浏览器排版、字体渲染和换行像素效果。涉及视觉贴合的调整必须结合截图或本地浏览器手动验收，并保留上述自动化回归。
