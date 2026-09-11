# WYSIWYG 表格编辑与生命周期数据同步规范

> 状态：CodeMirror 6 当前契约。v0.10.1 验证通过（PR #57）；解耦单元格 DOM 编辑器与原子手柄，建立 cell 级失焦提交与 `flushPendingEdits` 强制同步契约。

## 用途

记录 WYSIWYG 模式下 GFM 表格 Widget 渲染架构、单元格输入交互、焦点状态机以及与桌面端应用层（模式切换、文件保存、命令分发）的数据同步契约。修改 `TableGridWidget`、表格投影、`renderer.flushPendingEdits` 或文档生命周期控制器前，必须先读本规范。

---

## 核心不变量

### 1. DOM 结构与 contenteditable 物理隔离不变量

- 单元格（`<th>` / `<td>`）内部必须嵌套独立的可编辑容器 `.cm-md-table-widget__cell-editor`，其声明 `contenteditable="plaintext-only"`。
- 表格控制手柄（行手柄 `.cm-md-table-widget__handle--row`、列手柄 `.cm-md-table-widget__handle--col`、对齐菜单等）声明为 `contenteditable="false"`。
- **兄弟节点隔离**：控制手柄必须作为 `<th>` / `<td>` 的直接子节点，与 `.cm-md-table-widget__cell-editor` 互为平级兄弟节点。
- **严禁嵌套**：严禁将任何 `contenteditable="false"` 的原子子节点放置于 `.cm-md-table-widget__cell-editor` 内部。在 WebKit 与 Chromium 内核中，若空可编辑容器内部存在不可编辑子元素，渲染引擎将拒绝向空容器内分发光标并阻止键盘输入（历史缺陷：导致新建表格首行和首列完全不可编辑）。

```html
<!-- 正确的 DOM 层次结构 -->
<th class="cm-md-table-widget__cell" data-col="0">
  <div class="cm-md-table-widget__cell-editor" contenteditable="plaintext-only">表头内容</div>
  <button class="cm-md-table-widget__handle--col" contenteditable="false">···</button>
</th>
```

### 2. 单元格粒度失焦提交不变量 (Cell-level Blur Commit)

- 表格单元格的编辑提交边界严格收敛在单个 cell（`<th>` 或 `<td>`）级别，不得以整个 `TableGridWidget` 外层容器作为失焦判定条件。
- 当用户在表格内通过 Tab、Enter、方向键或鼠标点击在不同单元格之间移动焦点时，前一个单元格接收到 `focusout` 事件，即使 `relatedTarget` 仍然位于同一个表格 wrapper 内，也必须立即触发该单元格的 `commitCellEdit`，将其即时写入底层 Markdown 状态。

### 3. 生命周期主动刷新契约 (`flushPendingEdits`)

- 编辑器渲染层（`CodeMirrorRenderer`）必须暴露 `flushPendingEdits(): boolean` 同步 API。
- 应用接入层控制器（`useDocumentActionsController.ts`）在触发下列任何离开或持久化当前视图状态的操作前，**必须首先**调用 `access.ports.flushPendingEdits?.()`：
  1. **切换渲染模式 (`switchMode`)**：从 WYSIWYG 切换到 Source 模式前，强制刷新未失焦的单元格内容，杜绝切换后用户刚输入的内容丢失；
  2. **文档保存 (`saveDocument`)**：在快捷键 `Cmd+S` / `Ctrl+S` 或点击保存时，将当前正在输入的未失焦字符即时刷入底层 Markdown 后再写盘；
  3. **命令分发 (`dispatchCommand`)**：在执行代码格式化或外部命令前，保证底层 Markdown 拥有最新的完整基线。
- `flushPendingEdits` 必须具备幂等性与防御性：无活动编辑时安全返回 `false`；在 Renderer 实例已销毁时不产生任何副作用。

### 4. 源码转义与安全授权修改

- 单元格修改必须通过 `commitTableCell` 函数派发带有安全授权标记（`wysiwygChangeProtection`）的 CM6 Transaction，禁止通过未授权的底层 Transaction 直接窜改受保护表格区间。
- 单元格内容中输入的竖线字符 `|` 必须被自动转义为 `\|`，防止用户输入破坏 GFM 表格的行列定界。
