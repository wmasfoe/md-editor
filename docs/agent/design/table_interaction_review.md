# 表格交互整体梳理（2026-08-02，已实施）

> 用途：在用户反馈"整体交互方式还不够优雅"后，对 M3 表格（`TableGridWidget` 可编辑网格）当前交互做全量梳理：交互地图、不优雅点（含根因与代码位置）、改进方案分级。供后续实施与产品验收使用。
>
> 涉及代码：`packages/renderer-codemirror/src/wysiwyg/widgets/table-widget.ts`、`atom-selection.ts`、`markdown-commands.ts`、`change-protection.ts`、`projection-state.ts`、`table-editing.ts`、`CodeMirrorEditor.css`。
>
> **实施状态（2026-08-02 同日）**：第 5 节三项决策已确认并全部实施——末尾 Enter 退出续写段落（P0-A）、Notion 式固定块手柄 + 菜单（P1-D）、列数 > 1 均可删（P1-C，删除项恒提供、下限由 `deleteTableColumn` 兜底）；P0-B（恰好相等选区替换放行）一并落地；P2-E（危险态红色菜单项）随菜单实现。见第 3 节分级标注。剩余：P2-F（选中态操作提示）、P2-G/M3-C（对齐切换、多单元格拖选）。

## 1. 当前交互地图

| 场景 | 当前行为 | 入口 |
| --- | --- | --- |
| 进入单元格编辑 | 左键单击单元格直接编辑（pointerdown 不拦截） | `table-widget.ts` keydown/pointerdown |
| 整表选中态进入编辑 | Tab / Enter 进入最近编辑单元格（记忆 `lastEditingCellByRecordId`，无记忆聚焦首表头） | `markdown-commands.ts` keymap |
| 单元格内编辑 | Enter 下移、Tab 右移、Shift-Tab 左移、Escape 取消（恢复源码）、blur 提交 | `table-widget.ts` keydown |
| 增行 | 行块手柄（每行首列左缘 ⋮⋮）弹出菜单：在上方插入 / 在下方插入 / 删除本行 | `table-widget.ts` `createRowHandle`/`openTableMenu` |
| 删行 | 同一菜单的删除本行（danger 红色项），点击即删、undo 可恢复 | 同上 |
| 增列 | 列块手柄（每列表头右缘 ⋮⋮）弹出菜单：在左侧插入 / 在右侧插入 / 删除本列 | `createColumnHandle`/`openTableMenu` |
| 删列 | 同一菜单的删除本列（danger 红色项），末列也可删（列数>1 下限由 `deleteTableColumn` 兜底） | 同上 |
| 整表原子选中 | 点击表格空白/边框；ArrowUp/ArrowDown 从上下方对称进入；单元格内 Cmd+A | `table-widget.ts` pointerdown / `atom-selection.ts` `verticalMoveHitsAtom` |
| 整表删除 | 整表选中态 Backspace/Delete 一次删除，undo 可恢复 | `atom-selection.ts` `deleteExactlySelectedAtoms` |
| 全文选中 | 单元格内 Cmd+A 渐进（先整表→CM6 selectAll 全文）；整表选中态 Cmd+A 直接全文 | `table-widget.ts` keydown Mod+a |
| 复制 | 单元格内原生复制；整表选中态复制得到 GFM 源码 | CM6 默认 + contenteditable |
| 退出表格 | 表格末尾（最后一行 body）Enter 先提交编辑再退出表格、下方新增段落续写正文（已有空行仅移动光标）；Escape 只取消编辑；也可鼠标点击表格外 | `table-editing.ts` `exitTableWithParagraph` |

## 2. 不优雅点清单（按影响分级）

### P0 交互硬伤（用户会被卡住）

1. **无法从表格键盘退出/续写正文**。Enter 在最后一行停在原地（`moveCellFocus` 用 `Math.min` 截断），Tab 在最后单元格同样停住，Escape 只取消当前编辑。用户写完表格无法用键盘继续写表格后的段落，必须摸鼠标。对照：Typora 表格末尾 Enter 分表/退出，Notion 行内 Enter 新增块。
2. **整表选中态直接打字被静默拒绝**。表格 fullRange 恒为 protected range（`table-projection.ts:69` `getTableProtectedRanges` → `[record.fullRange]`）；`change-protection.ts:66-72` 的宽选区放行条件是 `selection.from < from || selection.to > to`，而整表原子选中恰好等于 fullRange，不满足 → transaction 被拒且无任何反馈（`protectedWysiwygChangeRejectedEffect` 仅在部分路径消费）。用户"选中整表后想直接替换"会以为编辑器坏了。Delete/Backspace 走命令授权路径正常。

### P1 功能缺口与一致性

3. **末列无法删除**。设计上"最右列不提供删除"（`createColumnHandle` 的 `colIndex < columnCount - 1` 分支），用户增删列时一旦想删最右列就无路可走（除非先在右侧再加一列）。"可增删行列"需求下应放宽为"列数 > 1 时可删任意列"。
4. **悬停手柄可发现性差且位置错位**。当前实现是整表 hover 时**所有**行/列手柄同时可见（CSS `.cm-md-table-widget:hover .cm-md-table-widget__handle`），且手柄贴在本行第一列顶部 / 表头右缘，并不跟随鼠标所在分隔线。用户悬停第 3 行第 3 列的边界，看到的是别处一组 +/− 小按钮（1.15rem），对应关系要靠猜。首次使用几乎不可能发现"悬停分隔线可以增删"。
5. **"点击空白选中整表"几乎不可达**。表格 `width: fit-content` + 单元格填满，可点"空白"只有 1px 边框与 0.35rem margin，误触率极高；单元格点击直接进入编辑，与"选中整表"的点击语义冲突。

### P2 打磨项

6. **删除无确认、无危险提示**。悬停手柄的 "−" 按钮点击即删行/删列，误触代价大；hover 无变红等危险反馈。
7. **表格末尾 Tab 循环/退出语义缺失**（与 P0-1 一并设计）。
8. **整表选中态缺少操作提示**：选中后没有"Delete 删除 / Tab 编辑 / Cmd+C 复制"的可见暗示（对新手可发现性差）。
9. **对齐切换未实现**（已知缺口，M3-C 遗留）：无入口，需随"列操作"统一设计（如列右键菜单或列手柄菜单）。
10. **多单元格拖选未实现**（已知缺口）：单元格级复制目前只能单格，跨格选择只能靠源码模式。

## 3. 改进方案（分级）

### P0 修复（建议立即实施）

- **A.（已实施 2026-08-02）表格末尾 Enter 退出表格并续写段落**：最后一行 body 的 Enter 先提交当前编辑，再经 `table-editing.ts` `exitTableWithParagraph` 在表格之后新增段落并将光标移入（受保护 transaction，undo 可整体撤销；已有空行分隔时仅移动光标）。中间行 Enter 保持"下移一格"。
- **B.（已实施 2026-08-02）允许"恰好等于整表"的选区替换**：`change-protection.ts` 放行条件扩展为 `selection.from <= from && selection.to >= to`（恰好覆盖 protected range 的宽选区同样放行），使"整表选中后直接打字/粘贴"等价于先 Delete 再输入，消除静默失败。

### P1 一致性（建议随后实施）

- **C.（已实施 2026-08-02）末列可删除**：菜单删除项恒提供（含最右列），仅当 `columnCount <= 1` 时由 `deleteTableColumn` 拒绝；移除"最右列不提供删除"分支。
- **D.（已实施 2026-08-02，按用户选择落地为 Notion 式）行/列固定块手柄 + 操作菜单**：每行首列左缘 ⋮⋮ 行手柄、每列表头右缘 ⋮⋮ 列手柄，整表 hover 显隐（`__handle` 默认透明）；点击弹出菜单——行：在上方插入 / 在下方插入 / 删除本行（danger 红色项）；列：在左侧插入 / 在右侧插入 / 删除本列（danger 红色项）。菜单定位在手柄附近，点击表格外 / 执行菜单项 / widget 销毁均关闭并释放 document 级监听（capture 阶段处理，先于 wrapper 内 bubble）。

### P2 打磨（低优先级）

- **E.（已实施 2026-08-02）删除项危险态**：菜单删除项带 `--menu-item--danger` 类，hover 变红。
- **F. 整表选中态操作提示**：可在选中时给 wrapper 增加 `aria-label`/tooltip 或在底部状态栏提示可操作项。
- **G. 对齐切换与列宽**：随列菜单统一设计（对齐左/中/右 + 列宽自适应），留待专项。

## 4. 对照参考（成熟产品行为）

- **Typora 表格**：表格末尾 Enter 退出表格新增段落；表格内 Enter 分表；行/列手柄显式可见。
- **Notion 表格**：单元格 Enter 新增行、表格末尾 Enter 退出；块手柄（左侧 `⋮⋮`）悬停显隐；列菜单（表头右缘）提供插入/删除/对齐。
- **Google Docs 表格**：右键菜单 + 表头悬停三角手柄提供列操作。

## 5. 待用户确认的设计决策（均已确认并实施）

1. 表格末尾 Enter：**退出表格新增段落**（已确认；Typora 分表/Notion 新增行已否决）。
2. 手柄形态：**行首/表头固定块手柄（Notion 式）**（已确认；跟随分隔线显隐已否决）。
3. 末列删除：**放宽为"列数 > 1 时可删"**（已确认）。
