# AI edit replacement preview spec

## 用途

记录 AI 修复建议 replacement preview 的展示规范、实现边界和回归验收点。修改 `packages/editor-ui/src/utils/ai-suggestion.ts`、`packages/editor-ui/src/components/MilkdownEditor.css` 或 AI suggestion 接受/取消逻辑前，先读本规范。

这是编辑器核心交互：预览必须让用户准确判断 Tab 后会发生什么，同时不能在确认前改变正文、布局、选区或历史记录。

## 背景

AI edit suggestion 使用结构化结果：

- `original`：模型认为需要替换的原文。
- `replacement`：模型建议替换后的文本。

早期问题是 replacement 浮层使用自己的宽度和换行规则，导致它在多行文本中独立换行，和原文行盒不贴合。正确方向是：replacement 预览应跟随原始 textblock 的内容宽度、字体、行高和换行位置，只把 replacement 视觉叠加在原文上方。

## 必须保持的行为

1. 展示 AI 修复建议时，真实 Markdown 文档、ProseMirror doc、历史记录和正文布局都不能改变。
2. replacement 只能作为 preview overlay 显示，用户按 Tab 接受后才写入真实文档。
3. preview 必须按原 textblock 的内容盒宽度、字体、行高、字距、对齐方式和 tab size 渲染，不能使用独立浮层宽度产生另一套换行。
4. 如果原文换行，replacement 应跟随原文行盒位置换行。
5. 如果 replacement 比 original 更长，可以视觉覆盖后续正文，但不能推开、移动或重排正文。
6. replacement 应显示在原文本上方，并紧贴原文本；垂直位置必须跟随当前块的 `line-height` / `font-size`，不能写固定 px 适配某一种字号。
7. preview 元素必须 `pointer-events: none` 且不可选中，不能干扰文本选择、拖选、IME composition 或编辑器点击。
8. geometry 缺失、内容宽度无效、rich inline、code block、跨 textblock 或 original 不匹配时必须 fail closed：不展示可接受的 edit suggestion。
9. 同一轮同时存在 edit 和 continuation 时，Tab 优先接受 edit；`Command/Ctrl + ArrowRight` 只接受 continuation；Esc 清除 suggestion。

## 当前实现契约

### 预览模型

`createAiEditPreviewModel()` 只为纯文本 textblock 生成 preview model：

- `edit.from` / `edit.to` 必须在同一个 textblock 内。
- textblock 不能是 code block。
- textblock 内部必须是无 mark 的纯文本。
- `text.slice(fromOffset, toOffset)` 必须严格等于规范化后的 `original`。
- `original` 和 `replacement` 不能为空，且不能相同。

不满足条件时返回 `null`。这不是降级体验问题，而是安全边界：不支持的场景不能留下一个用户可按 Tab 接受的隐藏修改。

### 镜像 overlay

`createAiEditPreviewAnchor()` 在 `edit.from` 位置放一个零尺寸 widget anchor。anchor 内部创建 `.md-ai-edit-preview-mirror`：

- `before` 和 `after` 用 `.md-ai-edit-preview-placeholder` 渲染为透明文本。
- `replacement` 用 `.md-ai-edit-preview-replacement` 渲染为绿色提示文本。
- 透明的 `before` / `after` 参与正常文本流宽度计算，让 replacement 处在和原文相同的行盒位置。

mirror 是 absolute overlay，只负责视觉预览。它不能改变 ProseMirror 文档，也不能影响原文布局。

### 定位和换行

`calculateAiEditPreviewMirrorPlacement()` 从 anchor 和 textblock DOM 几何信息计算 mirror 位置：

- `left = textblock.left + paddingLeft - anchor.left`
- `width = textblock.width - paddingLeft - paddingRight`
- 字体相关属性来自 textblock computed style：`font`、`lineHeight`、`letterSpacing`、`textAlign`、`tabSize`

垂直位置按当前 textblock 的行高上移：

- numeric `line-height`：`lineHeight * 0.75`
- `line-height: normal`：`fontSize * 1.2 * 0.75`

这个比例的目标是让 replacement 靠近原文本上方，而不是压在原文本正中或离得过远。后续调整必须继续使用当前块文本指标计算，不能改成固定像素。

### 样式

当前 CSS 契约：

- `.md-ai-edit-original` 用淡橙色背景、半透明正文色和删除线标出将被替换的原文。
- `.md-ai-edit-preview-mirror` 使用 `white-space: pre-wrap` 和 `overflow-wrap: anywhere`，并继承定位函数写入的 textblock 文本指标。
- `.md-ai-edit-preview-placeholder` 透明但保留文本流占位。
- `.md-ai-edit-preview-replacement` 使用半透明绿色背景、绿色文本、`box-decoration-break: clone` 和小圆角，让多行 replacement 每行都有可读背景。

## 禁止做法

- 不要在确认前把 replacement 插入真实文档来模拟预览。
- 不要用独立弹层、tooltip、固定宽度浮层或 portal 重新排版 replacement。
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
  - 纯文本 textblock 能生成 scoped preview model。
  - rich inline edit preview fail closed。
  - geometry 缺失或 content width 无效时 fail closed。
  - mirror placement 使用 textblock content box 和 line-height/font-size-derived vertical offset。
- `packages/editor-ui/src/tests/selection-policy.test.ts`
  - preview / selection CSS 不能破坏全局选区策略。
- `packages/editor-ui/src/tests/ime-composition-guard.test.ts`
  - preview 改动不能重新引入 IME composition 行高或 caret 回归。

## 手动验收场景

1. 普通段落中触发短 replacement，确认 replacement 在原文上方贴近显示，正文没有被推开。
2. 普通段落中触发比 original 更长的 replacement，确认 replacement 跟随原段落宽度换行，允许视觉覆盖后续正文，但不改变真实正文布局。
3. 在一级标题和普通正文分别触发 replacement，确认垂直距离按各自字号/行高变化，不出现标题合适但正文过高或正文合适但标题压住的问题。
4. 多行段落中触发 replacement，确认它跟随原文行盒，而不是在自己的浮层里独立换行。
5. 按 Tab 后才发生真实替换；按 Esc 后 preview 和 original 标记消失，正文保持原样。
6. 对带 link/emphasis 等 mark 的原文触发 edit suggestion 时，不应留下可按 Tab 接受的 edit preview。
7. 中文输入法 composition 期间或结束后，AI preview 不能影响当前行行高、光标位置或选区。

## 已知限制

当前自动化测试覆盖 preview model、fail-closed 边界和定位数学，但 JSDOM 不能完整验证真实浏览器排版、字体渲染和换行像素效果。涉及视觉贴合的调整必须结合截图或本地浏览器手动验收，并保留上述自动化回归。
