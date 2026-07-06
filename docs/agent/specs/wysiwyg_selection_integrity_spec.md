# WYSIWYG selection integrity spec

## 用途

记录 WYSIWYG 编辑器选区相关的回归用例和实现边界，防止图片伪选中、空白区域点击、代码块交互等修复再次误清合法文本选区。

## 必须保持的行为

1. 普通段落拖选到不同类型块，例如 `paragraph -> blockquote`，选中状态必须保留。
2. 图片点击可以进入图片节点选中状态，但图片伪选中清理只能作用于图片点击后的短暂 guard 窗口。
3. 用户已经形成非折叠原生选区时，任何空白区域点击/拖拽兜底逻辑都不能把光标移动到文档末尾。
4. `Command+A` / `Ctrl+A` 的默认文档全选和 ProseMirror 自身跨块选区必须继续由 ProseMirror 默认选择逻辑接管；唯一例外是普通代码块内部的光标或选区，此时 `Command+A` / `Ctrl+A` 只全选当前代码块文本。
5. 不允许再通过给整个 `.ProseMirror` 添加 `user-select: none` 之类的全局锁来解决图片问题。
6. 普通代码块获得编辑焦点时，应和 hover 状态一样显示代码块焦点描边；该状态必须来自当前 ProseMirror 选区范围，不能依赖全局 DOM focus 锁。

## 已知回归场景

### 普通段落拖选到引用块后选区消失

复现文档：

```markdown
普通文本第一行用于跨块选择

> 引用文本第二行用于跨类型选择
```

操作：

1. 在 WYSIWYG 模式，从普通段落文本开始拖选。
2. 一直拖到引用块内部文本。
3. 松开鼠标后，跨块选区应保持可见，不能折叠到 `.ProseMirror` 根节点。

根因边界：

- 不能把所有落在 `.ProseMirror` 根节点上的 `mousedown/click` 都当成空白面点击。
- 如果 `window.getSelection()` 已经存在非折叠 Range，空白面兜底逻辑必须让出控制权。

当前测试入口：

- `packages/editor-ui/src/tests/editor-surface.test.ts`
  - `does not move the cursor to the end while a native cross-block selection is active`
- `packages/editor-ui/src/tests/image-selection.test.ts`
  - `allows a cross-block text selection to replace image node selection`
- `packages/editor-ui/src/tests/selection-policy.test.ts`
  - `never disables native selection on the whole ProseMirror surface`

## 实现约束

- 图片选中策略属于 `packages/editor-ui/src/utils/image-selection.ts`。
- 空白面点击策略属于 `packages/editor-ui/src/utils/editor-surface.ts`。
- 代码块内 `Command+A` / `Ctrl+A` 和 active code block 描边属于 `packages/editor-ui/src/utils/code-block-tools.ts`。
- React 组件只负责绑定 DOM 事件，不应内联复杂选区策略。
- 新增 selection 相关修复时，先加回归测试，再改实现。

## 后续重构方向

如果 selection 相关问题继续增加，应考虑把 WYSIWYG 交互策略收敛为一个独立模块，例如 `wysiwyg-interaction-policy.ts`：

- image node selection policy
- blank surface cursor policy
- native selection preservation policy
- block/node view interaction policy

重构前提：

- 保留上述测试。
- 不引入新依赖。
- 不改 Markdown 保存/还原链路。
