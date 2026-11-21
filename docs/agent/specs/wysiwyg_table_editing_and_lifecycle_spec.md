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
- **仅在存在未提交输入时才回写源码**（`hasUncommittedCellInput`）：单元格 DOM 文本与已提交文本一致时，`focusout` 只更新“最近编辑单元格”记忆，**不得**派发文档变更。否则 `buildCellReplacement` 会对整行重序列化（padded 行 `|  a  | b |` 被静默规范化为 `| a | b |`），破坏“零文本变更”契约，并因文档变更清掉待处理的 AI 建议（D-1 PM-4 硬闸门 E18/T2：注入建议时的 `view.focus()` 会把焦点从单元格移到编辑器，触发此路径）。
  - 回归锁：`packages/editor/tests/wysiwyg/widgets/widget-lifecycle.test.ts`（失焦无输入 ⇒ 文档逐字节不变；有输入 ⇒ 该行按既有语义回写）。

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

### 5. 宽度与横向溢出不变量

表格是唯一能突破正文列宽的块级 widget，其宽度策略必须满足三条同时成立：

1. **编辑区（`.cm-scroller`）永不出页面级横向滚动条**。
   表格溢出只能由表格自身承接。历史缺陷：`.cm-md-table-widget__grid` 使用 `width: max-content`
   按最宽单元格撑开表格，而 `.cm-md-table-widget` 的 `max-width: 100%` 只约束 wrapper
   自身盒模型、**不约束 table 子元素的溢出**，溢出直接穿透到 `.cm-scroller`（`overflow: auto`）。
2. **宽度策略是混合式**：默认 `width: 100%` + `table-layout: auto`，列宽按内容比例分配、
   长文本单元格内换行（常规表格零滚动）；单元格有可读下限，当「列数 × 下限」超出可用宽度时，
   表格 min-content 撑破容器，由内层 `.cm-md-table-widget__viewport` 承接横向滚动。
3. **行/列手柄与列宽拖动手柄在任何状态下都可点**：
   - 滚动层必须是内层 `__viewport` 而非 wrapper —— 手柄与行操作菜单故意溢出到表格外侧
     （`left: -1.35rem` / `right: -0.65rem`），wrapper 一旦成为滚动容器就会把它们裁掉；
   - `overflow-x: auto` 即使内容不溢出也会建立裁剪盒，因此溢出与否由
     `overflow.ts` 的 ResizeObserver 写入 `data-table-overflow` 属性，按状态切换两套几何；
   - 列手柄不得骑在列右边界上（曾用 `right: -0.65rem`），否则会盖住 `right: -3px` 的
     列宽拖动手柄（z-index 更低），使列宽拖动完全失效。

判定溢出时必须比较**表格自身布局宽度**与视口内容宽度，禁止用 `viewport.scrollWidth`：
列宽拖动手柄（`right: -3px`）永远溢出表格 2px，会让每张表（含 2 列小表）都被误判为溢出。

回归锁：
- 单测 `packages/editor/tests/wysiwyg/widgets/table-overflow.test.ts`（判定口径与状态同步）；
- e2e `apps/desktop/e2e/codemirror-m3-table-overflow.spec.ts`（编辑区无横向滚动、手柄可点、
  列宽拖拽生效且不写源码、窗口变窄后状态切换）。
