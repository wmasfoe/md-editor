# WYSIWYG Chinese IME composition layout spec

## 用途

记录 WYSIWYG 中文/CJK 输入法 composition 期间和结束后的布局稳定性契约。修改 Milkdown/ProseMirror 交互、图片节点选择、IME guard、`ProseMirror-trailingBreak` 或 `ProseMirror-separator` 相关逻辑前，先读本规范，避免再次引入中文输入行高被撑开或输入结束后必须额外输入字符才能恢复的问题。

## 背景

用户在中文输入法下观察到，所见即所得模式输入中文时，光标所在行高度会从正常约 `41px` 变成约 `82px`。早期表现为中文输入结束后仍保持撑开状态，必须再输入英文字符、标点或数字才会恢复。

DevTools 证据显示，中文 composition 后段落 DOM 可能出现：

```html
<p>
  这是输入的文案
  <img class="ProseMirror-separator" alt="" draggable="false" contenteditable="false" data-md-editor-image="true">
  <br class="ProseMirror-trailingBreak">
</p>
```

英文输入或中文后继续输入非中文内容时，最终 DOM 会恢复为普通文本段落：

```html
<p>这是输入的文案1</p>
```

## 必须保持的行为

1. 中文/CJK 输入法 composition 过程中，当前行不能被 `br.ProseMirror-trailingBreak` 临时撑高。
2. 中文/CJK 输入法 composition 结束后，段落必须自动恢复正常行高，不需要再输入英文、标点或数字触发恢复。
3. 取消或删除未选词的拼音时，光标不能跳到当前行最右侧。
4. `img.ProseMirror-separator` 是 ProseMirror 内部 DOM，不能被当作编辑器图片节点处理。
5. `br.ProseMirror-trailingBreak` 是 ProseMirror 内部 DOM，不能全局隐藏；只能在明确的 IME composition scope 下处理。
6. 修复不得改变 source 模式、Markdown 保存/序列化、MDX/raw fidelity 或新增依赖。

## 当前实现契约

### Separator image

`packages/editor-ui/src/utils/image-selection.ts` 只处理真实图片节点：

- `prepareImageDom()` 遇到 `img.ProseMirror-separator` 时必须跳过，并清理旧逻辑可能写上的 `data-md-editor-image`、`draggable`、`contenteditable` 和选中 class。
- `findImageElement()` 不能命中 `img.ProseMirror-separator`。
- `hasProseMirrorSeparatorImageClass()` 是 separator class 判断的测试入口。

`packages/editor-ui/src/components/MilkdownEditor.css` 中正文图片样式必须排除 separator：

```css
.milkdown .ProseMirror img:not(.ProseMirror-separator) { ... }
```

### Trailing break during IME

输入过程中允许 scoped CSS 隐藏 trailing break：

```css
.milkdown-host--ime-composing .milkdown .ProseMirror br.ProseMirror-trailingBreak {
  display: none;
}
```

禁止添加全局规则：

```css
.milkdown .ProseMirror br.ProseMirror-trailingBreak {
  display: none;
}
```

全局隐藏会影响空段落光标、placeholder 和 ProseMirror 自身 trailing hack，属于高风险 workaround。

### Composition settle

`packages/editor-ui/src/utils/ime-composition-guard.ts` 在 composition settle 后必须保持三段式修复：

1. `forceCompositionDomFlush(view)`：主动 flush ProseMirror DOM observer。
2. `refreshCompositionDom(view)`：派发 `docChanged=false`、`addToHistory=false` 的 no-op transaction，让 ProseMirror view 重算 stale DOM hack。
3. `restoreCancelledCompositionSelection(...)`：仅当文档未变化、composition 起止都是折叠选区且选区漂移时，恢复 composition 起点光标。

这条链路只修 DOM/layout/caret 状态，不应改文档内容或历史记录。

## 回归测试入口

- `packages/editor-ui/src/tests/ime-composition-guard.test.ts`
  - hardbreak cleanup
  - composition DOM flush
  - no-op refresh transaction 不改文档、不进历史
  - 取消拼音时的 selection restore 条件
- `packages/editor-ui/src/tests/image-selection.test.ts`
  - separator image class 识别
  - 图片节点选中和跨块文本选区完整性
- `packages/editor-ui/src/tests/selection-policy.test.ts`
  - 正文图片样式排除 `ProseMirror-separator`
  - 禁止全局隐藏 `br.ProseMirror-trailingBreak`
  - 仅允许 `.milkdown-host--ime-composing` scope 下隐藏 trailing break
  - IME composition 期间不重写 editor content

## 手动验收场景

1. 在 WYSIWYG 普通段落中输入中文拼音，保持候选态时当前行不应被撑高。
2. 选词提交中文后，当前行保持或恢复正常高度。
3. 连续提交多个中文词，不需要英文、标点或数字触发恢复。
4. 输入拼音后删除/取消，不选词，光标停留在原编辑位置。
5. 删除/取消后继续中文输入并提交，行高和光标仍稳定。

## 禁止做法

- 不要全局隐藏 `.ProseMirror-trailingBreak`。
- 不要把 `.ProseMirror-separator` 当作普通图片节点加 `data-md-editor-image`。
- 不要通过保存/序列化层过滤该问题；它是 WYSIWYG DOM composition 生命周期问题。
- 不要为了这个问题新增依赖或引入全局 EditorRuntime 重构。

## 已知限制

当前自动化测试覆盖 helper 和策略边界，但不能完整模拟真实操作系统中文输入法、候选窗口和 WebView composition 时序。若后续引入浏览器级 E2E 测试，应优先补一个中文 IME composition smoke test，断言输入中和输入结束后的行高稳定性。
